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

  /** True when every video needed for time t has a decoded frame at the right position. */
  framesReady(t) {
    const clips = store.project.clips;
    for (const c of clips) {
      if (c.type !== 'media' || (c.track !== 'V1' && c.track !== 'V2')) continue;
      const m = store.media.get(c.mediaId);
      if (!m || m.type !== 'video') continue;
      const next = nextAdjacent(c, clips);
      const end = clipEnd(c) + (next ? transitionDuration(next) : 0);
      if (t < c.start || t >= end) continue;
      const p = this.players.get(c.id);
      if (!p || p.el.readyState < 2 || p.el.seeking) return false;
    }
    return true;
  }

  /** Draw frame at time t. Returns false if some video frame wasn't ready yet. */
  render(t) {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = store.project.background || '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const clips = store.project.clips;
    let ready = true;
    for (const trackId of ['V1', 'V2']) {
      const list = clips
        .filter((c) => c.track === trackId && c.type !== 'text' && t >= c.start && t < clipEnd(c))
        .sort((a, b) => a.start - b.start);
      for (const c of list) {
        const td = transitionDuration(c);
        if (td > 0 && t < c.start + td) {
          const prev = prevAdjacent(c, clips);
          for (const L of [this.layerA, this.layerB]) { L.ctx.setTransform(1, 0, 0, 1, 0, 0); L.ctx.clearRect(0, 0, W, H); }
          if (prev) ready = this.drawClip(this.layerA.ctx, prev, t, W, H) && ready;
          ready = this.drawClip(this.layerB.ctx, c, t, W, H) && ready;
          compositeTransition(ctx, prev ? this.layerA : null, this.layerB, c.transition.type, (t - c.start) / td, W, H);
        } else {
          ready = this.drawClip(ctx, c, t, W, H) && ready;
        }
      }
    }
    for (const c of clips) {
      if (c.type === 'text' && t >= c.start && t < clipEnd(c)) drawText(ctx, c, t, W, H);
    }
    return ready;
  }

  drawClip(ctx, c, t, W, H) {
    let src = null;
    let sw = W;
    let sh = H;
    let ready = true;
    if (c.type === 'media') {
      const m = store.media.get(c.mediaId);
      if (!m || m.type === 'audio') return true;
      if (m.type === 'image') {
        if (!m.img) return true;
        src = m.img; sw = m.width; sh = m.height;
      } else {
        const p = this.players.get(c.id);
        if (!p || p.el.readyState < 2) return false;
        src = p.el;
        sw = p.el.videoWidth || m.width;
        sh = p.el.videoHeight || m.height;
        if (p.el.seeking) ready = false;
      }
    }
    const local = clamp(t - c.start, 0, c.duration);
    const prog = c.duration > 0 ? local / c.duration : 0;
    const tr = { ...DEFAULT_TRANSFORM, ...c.transform };
    let alpha = tr.opacity;
    if (c.fadeIn > 0 && local < c.fadeIn) alpha *= local / c.fadeIn;
    if (c.fadeOut > 0 && local > c.duration - c.fadeOut) alpha *= Math.max(0, (c.duration - local) / c.fadeOut);
    if (alpha <= 0.001) return ready;

    let { x, y, scale, rotation } = tr;
    switch (c.motion) {
      case 'zoom-in': scale *= 1 + 0.25 * prog; break;
      case 'zoom-out': scale *= 1.25 - 0.25 * prog; break;
      case 'pan-left': scale *= 1.2; x += 0.08 - 0.16 * prog; break;
      case 'pan-right': scale *= 1.2; x += -0.08 + 0.16 * prog; break;
      case 'pulse': scale *= 1 + 0.035 * Math.sin(local * Math.PI * 2.4); break;
      case 'shake': scale *= 1.05; x += Math.sin(local * 47) * 0.006 + Math.sin(local * 23) * 0.004; y += Math.cos(local * 39) * 0.006; break;
      case 'spin': rotation += local * 25; break;
    }

    let dw = W;
    let dh = H;
    if (src) {
      const fit = tr.fit || 'contain';
      if (fit !== 'stretch') {
        const r = fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
        dw = sw * r;
        dh = sh * r;
      }
    }
    const e = effectiveFx(c);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2 + x * W, H / 2 + y * H);
    if (rotation) ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale * (tr.flipH ? -1 : 1), scale);
    ctx.filter = filterString(e, Math.min(W, H) / 1080);
    if (src) ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
    else { ctx.fillStyle = c.color || '#000'; ctx.fillRect(-dw / 2, -dh / 2, dw, dh); }
    ctx.filter = 'none';
    if (e.tint) { ctx.fillStyle = e.tint; ctx.fillRect(-dw / 2, -dh / 2, dw, dh); }
    if (e.vignette > 0) {
      const r = Math.max(dw, dh);
      const g = ctx.createRadialGradient(0, 0, r * 0.25, 0, 0, r * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${Math.min(1, e.vignette / 100)})`);
      ctx.fillStyle = g;
      ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
    }
    ctx.restore();
    return ready;
  }
}

// ---------- text / captions ----------
function wrapText(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = [];
    for (const w of words) {
      const test = [...line, w].join(' ');
      if (line.length && ctx.measureText(test).width > maxW) { lines.push(line); line = [w]; }
      else line.push(w);
    }
    lines.push(line);
  }
  return lines;
}

export function drawText(ctx, c, t, W, H) {
  const s = { ...DEFAULT_TEXT_STYLE, ...c.style };
  const k = Math.min(W, H) / 1080;
  const local = t - c.start;
  const d = c.duration;
  const text = s.uppercase ? String(c.text).toUpperCase() : String(c.text);
  const size = s.size * k;
  ctx.save();
  ctx.font = `${s.italic ? 'italic ' : ''}${s.bold ? 800 : 500} ${size}px ${s.font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const lines = wrapText(ctx, text, W * s.maxWidth);
  const lh = size * 1.28;
  const blockH = lines.length * lh;
  let cx = W / 2;
  let cy;
  if (s.pos === 'top') cy = H * 0.1 + blockH / 2;
  else if (s.pos === 'center') cy = H / 2;
  else if (s.pos === 'custom') { cx = s.x * W; cy = s.y * H; }
  else cy = H * 0.9 - blockH / 2;

  const totalWords = lines.reduce((n, l) => n + l.length, 0);
  const totalChars = lines.reduce((n, l) => n + l.join(' ').length + 1, 0);
  const inD = Math.min(0.35, d / 3);
  const pin = clamp(local / inD, 0, 1);
  const pout = clamp((d - local) / inD, 0, 1);
  let alpha = 1, scale = 1, dy = 0, charLimit = Infinity, wordIdx = -1, wordLimit = Infinity;
  switch (c.anim) {
    case 'fade': alpha = Math.min(pin, pout); break;
    case 'pop': scale = Math.max(0.01, easeOutBack(pin)); alpha = Math.min(1, pin * 2) * pout; break;
    case 'slide': dy = (1 - easeOut(pin)) * 50 * k; alpha = Math.min(pin, pout); break;
    case 'typewriter': charLimit = Math.floor(totalChars * clamp(local / (d * 0.7), 0, 1)); alpha = pout; break;
    case 'highlight': wordIdx = Math.floor(totalWords * clamp(local / d, 0, 0.9999)); break;
    case 'wordpop': wordLimit = Math.floor(totalWords * clamp(local / (d * 0.8), 0, 1)) + 1; alpha = pout; break;
  }
  if (alpha <= 0.001) { ctx.restore(); return; }
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy + dy);
  ctx.scale(scale, scale);
  const space = ctx.measureText(' ').width;
  let wi = 0;
  let ci = 0;
  lines.forEach((words, li) => {
    const y = -blockH / 2 + lh * (li + 0.5);
    const lw = ctx.measureText(words.join(' ')).width;
    if (s.bgOpacity > 0 && words.length) {
      ctx.save();
      ctx.globalAlpha = alpha * s.bgOpacity;
      ctx.fillStyle = s.bg;
      ctx.beginPath();
      ctx.roundRect(-lw / 2 - size * 0.3, y - lh / 2, lw + size * 0.6, lh, size * 0.18);
      ctx.fill();
      ctx.restore();
    }
    let x = -lw / 2;
    for (const w of words) {
      let word = w;
      if (ci >= charLimit) word = '';
      else if (ci + w.length > charLimit) word = w.slice(0, charLimit - ci);
      ci += w.length + 1;
      if (word && wi < wordLimit) {
        if (s.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 12 * k; ctx.shadowOffsetY = 3 * k; }
        if (s.strokeWidth > 0) {
          ctx.lineJoin = 'round';
          ctx.lineWidth = s.strokeWidth * k * 2;
          ctx.strokeStyle = s.stroke;
          ctx.strokeText(word, x, y);
          ctx.shadowColor = 'transparent';
        }
        ctx.fillStyle = wi === wordIdx ? s.highlight : s.color;
        ctx.fillText(word, x, y);
        ctx.shadowColor = 'transparent';
      }
      x += ctx.measureText(w).width + space;
      wi++;
    }
  });
  ctx.restore();
}
