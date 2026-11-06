# Study Circle — source code

A small, browser-based virtual study room built with React, TypeScript, Vite and Supabase Realtime.

## Included

- Create or join a room using a shareable room code
- Participant presence
- Optional peer-to-peer camera and microphone (both OFF by default)
- Room chat
- Shared Pomodoro timer
- Responsive dark interface

## Requirements

- Node.js 20 or newer
- A free Supabase project
- A modern browser with WebRTC support

## Run locally

1. Install Node.js.
2. Extract this folder and open a terminal in it.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Copy `.env.example` to `.env.local`.
5. In [Supabase](https://supabase.com/), create a free project.
6. Open **Project Settings → API** and copy the Project URL and `anon` / publishable key into `.env.local`:

   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
   ```

7. Start the app:

   ```bash
   npm run dev
   ```

8. Open the local URL printed by Vite (usually http://localhost:5173).

For deployment, run `npm run build` and deploy the `dist` folder to a static host such as Cloudflare Pages, Netlify, or Vercel. Add the same two environment variables in that host's project settings.

## How rooms work

Room membership, chat and timer updates use Supabase Realtime channels. Camera/microphone media uses browser WebRTC peer-to-peer connections. No video is recorded or stored by this app.

## Important limitations of this starter

- The video mesh is intended for small rooms (roughly 2–4 people; performance varies by device/network). It is not an SFU-based large-room video platform.
- STUN-only connectivity may fail on some restrictive networks. A TURN relay is needed for more reliable connectivity; free TURN capacity is not guaranteed.
- Anyone who knows a room code may join. Treat room codes as public links. This starter does not include accounts, password-protected rooms, persistent chat, reporting, or moderator tools.
- The Pomodoro timer is broadcast as a shared display state, not a server-authoritative clock. It can drift slightly between devices.
- Browser camera/microphone access generally requires HTTPS, except on localhost.
- This is an MVP starter, not a hardened public service. Before opening it to the public, add authentication, room access controls, moderation/reporting, rate limits, and stronger abuse prevention.

## Privacy and safety

- Camera and microphone start OFF and require a user click plus browser permission.
- Leaving a room closes peer connections and stops local media tracks.
- Do not share your home address, phone number, school timetable, or other private information in room chat.
- Use a room code only with people you intend to invite.

## Troubleshooting

**“Add your Supabase URL…”** — `.env.local` is missing or has incorrect variable names. Restart `npm run dev` after changing it.

**Room does not connect** — check the Supabase URL/key and Realtime service status.

**Other participants do not see video** — both people must allow camera access. Some networks block direct peer-to-peer connections; TURN support may be required.

**TypeScript/build issue** — run `npm run build` and inspect the first error printed in the terminal.
