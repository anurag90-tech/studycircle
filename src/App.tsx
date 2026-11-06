import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  Camera, CameraOff, Copy, LogOut, MessageCircle, Mic, MicOff,
  Play, Pause, RotateCcw, Send, Users, Video, X
} from "lucide-react";

type Person = { id: string; name: string; camera: boolean; mic: boolean };
type ChatMessage = { id: string; name: string; text: string; time: string };
type Signal = {
  from: string; to: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const makeId = () => crypto.randomUUID();
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase();

function VideoTile({ person, stream, muted = false }: {
  person: Person; stream?: MediaStream; muted?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream ?? null;
  }, [stream]);
  return (
    <div className="video-tile">
      {person.camera && stream
        ? <video ref={videoRef} autoPlay playsInline muted={muted} />
        : <div className="avatar"><span>{initials(person.name) || "?"}</span></div>}
      <div className="tile-label">
        <span>{person.name}{person.id === "self" ? " (You)" : ""}</span>
        {!person.mic && <MicOff size={14} />}
      </div>
    </div>
  );
}

export default function App() {
  const [name, setName] = useState(localStorage.getItem("sc-name") || "");
  const [roomInput, setRoomInput] = useState("");
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream>();
  const [camera, setCamera] = useState(false);
  const [mic, setMic] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [seconds, setSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"Focus" | "Break">("Focus");
  const [chatOpen, setChatOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const myId = useRef(makeId());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const localStreamRef = useRef<MediaStream>();
  const peopleRef = useRef<Person[]>([]);
  const nameRef = useRef(name);
  const joinedRef = useRef(false);

  useEffect(() => { nameRef.current = name; }, [name]);
  useEffect(() => { peopleRef.current = people; }, [people]);

  const updateSelfPresence = useCallback(async (cam = camera, microphone = mic) => {
    const channel = channelRef.current;
    if (!channel || !joinedRef.current) return;
    await channel.track({ id: myId.current, name: nameRef.current, camera: cam, mic: microphone });
  }, [camera, mic]);

  const sendSignal = useCallback((signal: Signal) => {
    channelRef.current?.send({ type: "broadcast", event: "signal", payload: signal });
  }, []);

  const createPeer = useCallback((peerId: string) => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    const stream = localStreamRef.current;
    (['audio', 'video'] as const).forEach(kind => {
      const transceiver = pc.addTransceiver(kind, { direction: 'sendrecv' });
      const track = stream?.getTracks().find(item => item.kind === kind);
      if (track) void transceiver.sender.replaceTrack(track);
    });
    pc.onicecandidate = event => {
      if (event.candidate) sendSignal({
        from: myId.current, to: peerId, candidate: event.candidate.toJSON()
      });
    };
    pc.ontrack = event => {
      const remote = event.streams[0] || new MediaStream([event.track]);
      remoteStreamsRef.current.set(peerId, remote);
      setRemoteStreams(new Map(remoteStreamsRef.current));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        remoteStreamsRef.current.delete(peerId);
        setRemoteStreams(new Map(remoteStreamsRef.current));
      }
    };
    peersRef.current.set(peerId, pc);
    return pc;
  }, [sendSignal]);

  const replacePeerTrack = async (kind: 'audio' | 'video', track: MediaStreamTrack | null) => {
    await Promise.all([...peersRef.current.values()].map(pc => {
      const sender = pc.getTransceivers().find(item => item.receiver.track.kind === kind)?.sender;
      return sender?.replaceTrack(track);
    }));
  };

  const startCall = useCallback(async (peerId: string) => {
    const pc = createPeer(peerId);
    if (pc.signalingState !== "stable") return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({ from: myId.current, to: peerId, description: pc.localDescription?.toJSON() });
    } catch (e) { console.warn("Could not start peer connection", e); }
  }, [createPeer, sendSignal]);

  const handleSignal = useCallback(async (signal: Signal) => {
    if (signal.to !== myId.current) return;
    const pc = createPeer(signal.from);
    try {
      if (signal.description) {
        await pc.setRemoteDescription(signal.description);
        if (signal.description.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ from: myId.current, to: signal.from, description: pc.localDescription?.toJSON() });
        }
      }
      if (signal.candidate) await pc.addIceCandidate(signal.candidate);
    } catch (e) { console.warn("WebRTC signaling error", e); }
  }, [createPeer, sendSignal]);

  const joinRoom = async (requestedRoom?: string) => {
    setError("");
    if (!supabase) {
      setError("Add your Supabase URL and anon key to .env.local, then restart the app.");
      return;
    }
    if (!name.trim()) { setError("Enter a display name first."); return; }
    const id = (requestedRoom || roomInput || makeId().slice(0, 8)).trim().toLowerCase();
    if (!/^[a-z0-9-]{3,32}$/.test(id)) {
      setError("Room codes must be 3–32 characters: letters, numbers or hyphens.");
      return;
    }
    myId.current = makeId();
    setRoomId(id);
    localStorage.setItem("sc-name", name.trim());
    const channel = supabase.channel(`study-room:${id}`, {
      config: { presence: { key: myId.current }, broadcast: { self: false } }
    });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<Person>();
      const list = Object.values(state).flat().filter(p => p.id !== myId.current);
      setPeople(list);
      list.forEach(person => {
        // A single deterministic caller avoids both clients creating offers at once.
        if (myId.current < person.id && !peersRef.current.has(person.id)) void startCall(person.id);
      });
    });
    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      void handleSignal(payload as Signal);
    });
    channel.on("broadcast", { event: "chat" }, ({ payload }) => {
      const msg = payload as ChatMessage;
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg].slice(-100));
    });
    channel.on("broadcast", { event: "timer" }, ({ payload }) => {
      const data = payload as { seconds: number; running: boolean; mode: "Focus" | "Break" };
      setSeconds(data.seconds); setRunning(data.running); setMode(data.mode);
    });
    channel.subscribe(async status => {
      if (status === "SUBSCRIBED") {
        channelRef.current = channel;
        joinedRef.current = true;
        await channel.track({ id: myId.current, name: name.trim(), camera: false, mic: false });
        setJoined(true);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setError("Could not connect to the room. Check your Supabase settings and internet connection.");
      }
    });
  };

  const leaveRoom = useCallback(() => {
    joinedRef.current = false;
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    remoteStreamsRef.current.clear();
    setRemoteStreams(new Map());
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop());
    localStreamRef.current = undefined;
    setLocalStream(undefined); setCamera(false); setMic(false);
    if (channelRef.current) void supabase?.removeChannel(channelRef.current);
    channelRef.current = null;
    setPeople([]); setJoined(false); setRoomId(""); setRunning(false);
  }, []);

  useEffect(() => () => {
    peersRef.current.forEach(pc => pc.close());
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    if (channelRef.current) void supabase?.removeChannel(channelRef.current);
  }, []);

  const toggleCamera = async () => {
    if (camera) {
      await replacePeerTrack('video', null);
      localStreamRef.current?.getVideoTracks().forEach(t => { t.stop(); localStreamRef.current?.removeTrack(t); });
      setCamera(false); await updateSelfPresence(false, mic); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const videoTracks = stream.getVideoTracks();
      if (!localStreamRef.current) localStreamRef.current = new MediaStream();
      videoTracks.forEach(t => localStreamRef.current?.addTrack(t));
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      await replacePeerTrack('video', videoTracks[0] ?? null);
      setCamera(true); await updateSelfPresence(true, mic);
    } catch { setError("Camera permission was denied or no camera is available."); }
  };

  const toggleMic = async () => {
    if (mic) {
      await replacePeerTrack('audio', null);
      localStreamRef.current?.getAudioTracks().forEach(t => { t.stop(); localStreamRef.current?.removeTrack(t); });
      setMic(false); await updateSelfPresence(camera, false); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tracks = stream.getAudioTracks();
      if (!localStreamRef.current) localStreamRef.current = new MediaStream();
      tracks.forEach(t => localStreamRef.current?.addTrack(t));
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      await replacePeerTrack('audio', tracks[0] ?? null);
      setMic(true); await updateSelfPresence(camera, true);
    } catch { setError("Microphone permission was denied or no microphone is available."); }
  };

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text || !channelRef.current) return;
    const msg = { id: makeId(), name: nameRef.current, text: text.slice(0, 500), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    setMessages(prev => [...prev, msg].slice(-100));
    channelRef.current.send({ type: "broadcast", event: "chat", payload: msg });
    setChatInput("");
  };

  const broadcastTimer = (nextSeconds: number, nextRunning: boolean, nextMode = mode) => {
    setSeconds(nextSeconds); setRunning(nextRunning); setMode(nextMode);
    channelRef.current?.send({ type: "broadcast", event: "timer", payload: { seconds: nextSeconds, running: nextRunning, mode: nextMode } });
  };

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSeconds(s => {
      if (s <= 1) {
        window.clearInterval(timer);
        setRunning(false);
        channelRef.current?.send({ type: "broadcast", event: "timer", payload: { seconds: 0, running: false, mode } });
        return 0;
      }
      return s - 1;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [running, mode]);

  const copyRoom = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}?room=${roomId}`);
    setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  };

  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get("room");
    if (invite) setRoomInput(invite);
  }, []);

  if (!joined) return (
    <main className="landing">
      <div className="brand"><div className="brand-mark"><Video size={21} /></div><span>study<span className="accent">circle</span></span></div>
      <section className="welcome">
        <div className="eyebrow">FOCUS BETTER, TOGETHER</div>
        <h1>Your study space.<br /><span>Shared with others.</span></h1>
        <p>Join a quiet virtual study room, work alongside other students, and keep each other focused.</p>
        <div className="join-card">
          <label>Your display name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Anurag" maxLength={30} />
          <label>Room code <small>Optional — leave blank to create one</small></label>
          <input value={roomInput} onChange={e => setRoomInput(e.target.value)} placeholder="e.g. biology-night-study" maxLength={32} />
          <button className="primary wide" onClick={() => void joinRoom()}>Enter study room <span>→</span></button>
          {error && <div className="error">{error}</div>}
          {!supabase && <div className="hint">Setup needed: configure Supabase first. See README.</div>}
        </div>
        <div className="privacy-note"><span className="privacy-dot" /> Your camera and microphone start OFF. You control when to share.</div>
      </section>
      <footer>STUDY CIRCLE <span>·</span> MADE FOR FOCUSED SESSIONS</footer>
    </main>
  );

  const self: Person = { id: "self", name, camera, mic };
  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const allPeople = [self, ...people];
  const currentRoomUrl = `${window.location.origin}?room=${roomId}`;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Video size={19} /></div><span>study<span className="accent">circle</span></span></div>
        <div className="room-pill"><span className="live-dot" /> ROOM <b>{roomId}</b></div>
        <div className="top-actions">
          <button className="icon-button" onClick={() => void copyRoom()} title="Copy invite link"><Copy size={17} /> <span>{copied ? "Copied" : "Invite"}</span></button>
          <button className="leave-button" onClick={leaveRoom}><LogOut size={16} /> Leave</button>
        </div>
      </header>

      <div className="workspace">
        <section className="main-column">
          <div className="section-heading">
            <div><div className="eyebrow">YOUR SESSION</div><h2>Study room</h2></div>
            <div className="people-count"><Users size={16} /> {allPeople.length} studying</div>
          </div>

          <div className={`video-grid count-${Math.min(allPeople.length, 4)}`}>
            <VideoTile person={self} stream={localStream} muted />
            {people.map(p => <VideoTile key={p.id} person={p} stream={remoteStreams.get(p.id)} />)}
          </div>

          <div className="media-controls">
            <button className={camera ? "control active" : "control"} onClick={() => void toggleCamera()}>{camera ? <Camera size={19} /> : <CameraOff size={19} />}<span>{camera ? "Camera on" : "Camera off"}</span></button>
            <button className={mic ? "control active" : "control"} onClick={() => void toggleMic()}>{mic ? <Mic size={19} /> : <MicOff size={19} />}<span>{mic ? "Mic on" : "Mic off"}</span></button>
            <div className="control-note">Video is peer-to-peer. Keep your camera off whenever you prefer.</div>
          </div>

          <section className="timer-card">
            <div className="timer-top"><div><div className="eyebrow">ROOM FOCUS TIMER</div><h3>{mode} session</h3></div><div className="timer-mode"><button className={mode === "Focus" ? "selected" : ""} onClick={() => broadcastTimer(25*60, false, "Focus")}>Focus</button><button className={mode === "Break" ? "selected" : ""} onClick={() => broadcastTimer(5*60, false, "Break")}>Break</button></div></div>
            <div className="timer-display">{formatTime(seconds)}</div>
            <div className="timer-actions">
              <button className="primary" onClick={() => broadcastTimer(seconds || (mode === "Focus" ? 25*60 : 5*60), !running)}>{running ? <Pause size={17} /> : <Play size={17} />}{running ? "Pause" : "Start focus"}</button>
              <button className="reset-button" onClick={() => broadcastTimer(mode === "Focus" ? 25*60 : 5*60, false)}><RotateCcw size={16} /> Reset</button>
            </div>
            <div className="timer-caption">Timer changes are shared with everyone in this room.</div>
          </section>
        </section>

        <aside className={`chat-panel ${chatOpen ? "" : "collapsed"}`}>
          <div className="chat-header"><div><MessageCircle size={17} /><b>Room chat</b></div><button className="icon-button mobile-chat-close" onClick={() => setChatOpen(false)}><X size={17} /></button></div>
          <div className="chat-messages">
            {messages.length === 0 && <div className="chat-empty"><MessageCircle size={24} /><b>Keep it focused</b><span>Say hello or share a study goal.</span></div>}
            {messages.map(m => <div className="message" key={m.id}><div className="message-meta"><b>{m.name}</b><time>{m.time}</time></div><p>{m.text}</p></div>)}
          </div>
          <form className="chat-compose" onSubmit={e => { e.preventDefault(); sendChat(); }}>
            <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Message the room…" maxLength={500} />
            <button type="submit" disabled={!chatInput.trim()}><Send size={17} /></button>
          </form>
          <div className="chat-footnote">Be respectful. Don't share personal contact details.</div>
        </aside>
        {!chatOpen && <button className="chat-reopen" onClick={() => setChatOpen(true)}><MessageCircle size={17} /> Open chat</button>}
      </div>
      {error && <div className="toast-error" onClick={() => setError("")}>{error} <X size={14} /></div>}
    </main>
  );
}
