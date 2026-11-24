// Canvas compositor: syncs <video>/<audio> elements to the timeline clock,
// draws layers with transforms/effects/transitions and renders captions.
import {
  store, clipEnd, prevAdjacent, nextAdjacent, transitionDuration, clamp,
  DEFAULT_TRANSFORM, DEFAULT_TEXT_STYLE,
} from './state.js';
import { effectiveFx, filterString, compositeTransition } from './effects.js';

// ---------- audio graph ----------
// clip gains -> mix -> master (preview volume) -> speakers
//                  \-> dest (MediaStream for export, unaffected by preview volume)
export const audio = { ctx: null, mix: null, master: null, dest: null };
export function ensureAudio() {
  if (!audio.ctx) {
    audio.ctx = new AudioContext();
    audio.mix = audio.ctx.createGain();
    audio.master = audio.ctx.createGain();
    audio.dest = audio.ctx.createMediaStreamDestination();
    audio.mix.connect(audio.master).connect(audio.ctx.destination);
    audio.mix.connect(audio.dest);
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
  return audio;
}

function makeLayer() {
  const c = document.createElement('canvas');
  c.ctx = c.getContext('2d');
  return c;
}

const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeOutBack = (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.players = new Map(); // clipId -> { el, gain, src, mediaId }
    this.layerA = makeLayer();
    this.layerB = makeLayer();
    this.dirty = true;
  }

  resize(w, h) {
    for (const c of [this.canvas, this.layerA, this.layerB]) { c.width = w; c.height = h; }
    this.dirty = true;
  }

  getPlayer(clip, media) {
    let p = this.players.get(clip.id);
    if (p && p.mediaId === clip.mediaId) return p;
    if (p) this.destroyPlayer(clip.id);
    const a = ensureAudio();
    const el = document.createElement(media.type === 'audio' ? 'audio' : 'video');
    el.preload = 'auto';
    el.playsInline = true;
    el.src = media.url;
    const src = a.ctx.createMediaElementSource(el);
    const gain = a.ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(a.mix);
    const mark = () => { this.dirty = true; };
    el.addEventListener('seeked', mark);
    el.addEventListener('loadeddata', mark);
    el.addEventListener('canplay', mark);
    p = { el, gain, src, mediaId: clip.mediaId };
    this.players.set(clip.id, p);
    return p;
  }

  destroyPlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.el.pause();
    p.el.removeAttribute('src');
    p.el.load();
    try { p.src.disconnect(); p.gain.disconnect(); } catch { /* already gone */ }
    this.players.delete(id);
  }

  pauseAll() {
    for (const p of this.players.values()) if (!p.el.paused) p.el.pause();
  }

  gainAt(c, t, tail) {
    if (c.muted) return 0;
    let g = c.volume ?? 1;
    const local = t - c.start;
    const d = c.duration;
    if (c.fadeIn > 0 && local < c.fadeIn) g *= clamp(local / c.fadeIn, 0, 1);
    if (c.fadeOut > 0 && local <= d && local > d - c.fadeOut) g *= clamp((d - local) / c.fadeOut, 0, 1);
    if (local > d) g *= tail > 0 ? clamp(1 - (local - d) / tail, 0, 1) : 0;
    const td = transitionDuration(c);
    if (td && local < td && prevAdjacent(c)) g *= clamp(local / td, 0, 1);
    return g;
  }

  /** Bring every media element in line with timeline time `t`. */
  sync(t, playing) {
    const clips = store.project.clips;
    const muted = new Set(store.project.mutedTracks || []);
    const live = new Set();
    for (const c of clips) {
      if (c.type !== 'media') continue;
      const media = store.media.get(c.mediaId);
      if (!media || media.type === 'image') continue;
      live.add(c.id);
      const next = nextAdjacent(c, clips);
      const tail = next ? transitionDuration(next) : 0;
      const ws = c.start;
      const we = clipEnd(c) + tail;
      const active = t >= ws && t < we;
      const preroll = !active && t < ws && ws - t < 2;
      let p = this.players.get(c.id);
      if (!active && !preroll) {
        if (p) { if (!p.el.paused) p.el.pause(); p.gain.gain.value = 0; }
        continue;
      }
      p = this.getPlayer(c, media);
      const el = p.el;
      const speed = c.speed || 1;
      const local = clamp(c.in + (Math.max(t, ws) - c.start) * speed, 0, Math.max(0, media.duration - 0.04));
      if (el.playbackRate !== speed) el.playbackRate = speed;
      const atEnd = local >= media.duration - 0.06;
      if (active && playing && !atEnd) {
        if (Math.abs(el.currentTime - local) > 0.3 && !el.seeking) el.currentTime = local;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - local) > 0.02 && !el.seeking) el.currentTime = local;
      }
      const g = active && !muted.has(c.track) ? this.gainAt(c, t, tail) : 0;
      p.gain.gain.setTargetAtTime(g, audio.ctx.currentTime, 0.02);
    }
    for (const id of [...this.players.keys()]) if (!live.has(id)) this.destroyPlayer(id);
  }
}
