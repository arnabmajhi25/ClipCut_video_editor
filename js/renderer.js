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
}
