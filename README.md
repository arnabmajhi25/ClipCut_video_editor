# ClipCut — Video Editor

A compact video editor that runs entirely in the browser — no uploads, no installs.

> 🚧 Work in progress. Built step by step.

## Progress

- [x] Project state, undo/redo and IndexedDB storage
- [x] Media import with thumbnails and waveforms
- [x] Canvas renderer with effects, transitions and captions
- [x] Multi-track timeline: move, trim, split, snap and zoom
- [x] Inspector panel for clip properties
- [x] Sidebar panels: media, text, transitions and effects
- [x] Wire everything together (playback, shortcuts, autosave)
- [x] Music: Spotify search, uploads and generated loops
- [x] Export to MP4 / WebM
- [ ] AI Director: edit the video from a text prompt

## Spotify setup

1. Create an app at https://developer.spotify.com/dashboard (Web API).
2. Add the redirect URI `http://127.0.0.1:5173/` (Spotify rejects `localhost`).
3. Paste the Client ID in the **Music** tab and click **Connect Spotify**.

Spotify only provides 30-second previews (none for many tracks) — use **📎 File** to attach your own copy of a song.

## Run locally

```bash
npm start
```

Then open http://127.0.0.1:5173
