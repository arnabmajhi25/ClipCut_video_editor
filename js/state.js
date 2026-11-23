// Central project state, events and undo/redo history.

export const TRACKS = [
  { id: 'V2', kind: 'video', label: 'Overlay' },
  { id: 'V1', kind: 'video', label: 'Main video' },
  { id: 'T1', kind: 'text', label: 'Captions' },
  { id: 'A1', kind: 'audio', label: 'Music' },
  { id: 'A2', kind: 'audio', label: 'Audio 2' },
];

export const ASPECTS = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
};

export const DEFAULT_FX = {
  brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0,
  grayscale: 0, sepia: 0, invert: 0, vignette: 0,
};
export const DEFAULT_TRANSFORM = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, fit: 'contain', flipH: false };
export const DEFAULT_TEXT_STYLE = {
  font: 'Inter, "Segoe UI", system-ui, sans-serif', size: 64, color: '#ffffff', highlight: '#ffd400',
  stroke: '#000000', strokeWidth: 6, bg: '#000000', bgOpacity: 0, shadow: true,
  bold: true, italic: false, uppercase: false, pos: 'bottom', x: 0.5, y: 0.5, maxWidth: 0.86,
};

export const uid = (p = 'c') => p + Math.random().toString(36).slice(2, 10);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function newProject() {
  return { name: 'Untitled project', aspect: '16:9', width: 1920, height: 1080, fps: 30, background: '#000000', clips: [], mutedTracks: [] };
}

const visualDefaults = () => ({
  fadeIn: 0, fadeOut: 0,
  transition: { type: 'none', duration: 0.8 },
  fx: { ...DEFAULT_FX }, preset: 'none',
  transform: { ...DEFAULT_TRANSFORM }, motion: 'none',
});

export function makeMediaClip(media, track, start) {
  const duration = media.type === 'image' ? 5 : media.duration;
  return {
    id: uid(), type: 'media', mediaId: media.id, name: media.name, track, start, duration,
    in: 0, speed: 1, volume: 1, muted: false, ...visualDefaults(),
  };
}

export function makeColorClip(color, track, start, duration = 3) {
  return { id: uid(), type: 'color', color, name: 'Color ' + color, track, start, duration, in: 0, ...visualDefaults() };
}

export function makeTextClip(text, start, duration = 3, style = {}, anim = 'fade') {
  return {
    id: uid(), type: 'text', track: 'T1', name: text, text, start, duration, anim,
    style: { ...DEFAULT_TEXT_STYLE, ...style },
  };
}

// ---------- events ----------
const listeners = {};
export function on(ev, fn) { (listeners[ev] ||= []).push(fn); }
export function emit(ev, data) { (listeners[ev] || []).forEach((fn) => fn(data)); }

// ---------- store ----------
export const store = {
  project: newProject(),
  media: new Map(), // id -> media record (not serialized into project JSON)
  selected: null,
  time: 0,
  playing: false,
  zoom: 80, // px per second
  snap: true,
  exporting: false,
};

// ---------- history ----------
const undoStack = [];
const redoStack = [];
let pending = null;

export function checkpoint() {
  if (pending === null) pending = JSON.stringify(store.project);
}
export function commit() {
  if (pending === null) return;
  const now = JSON.stringify(store.project);
  if (now !== pending) {
    undoStack.push(pending);
    if (undoStack.length > 150) undoStack.shift();
    redoStack.length = 0;
  }
  pending = null;
  emit('history');
}
export function mutate(fn) {
  checkpoint();
  fn(store.project);
  commit();
  emit('change');
}
export function softChange() { emit('change', { soft: true }); }

function restore(json) {
  store.project = JSON.parse(json);
  if (store.selected && !getClip(store.selected)) store.selected = null;
  emit('change');
  emit('select');
  emit('history');
}
export function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(store.project));
  restore(undoStack.pop());
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(store.project));
  restore(redoStack.pop());
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function setProject(p) {
  store.project = { ...newProject(), ...p };
  undoStack.length = 0;
  redoStack.length = 0;
  store.selected = null;
  emit('change');
  emit('select');
  emit('history');
}

// ---------- queries ----------
export const getClip = (id) => store.project.clips.find((c) => c.id === id);
export const selectedClip = () => (store.selected ? getClip(store.selected) : null);
export const trackKind = (trackId) => TRACKS.find((t) => t.id === trackId)?.kind;
export const clipEnd = (c) => c.start + c.duration;
export const projectDuration = () => store.project.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);

export function clipKind(clip) {
  if (clip.type === 'text') return 'text';
  if (clip.type === 'color') return 'video';
  const m = store.media.get(clip.mediaId);
  return m?.type === 'audio' ? 'audio' : 'video';
}
export function clipMediaType(clip) {
  if (clip.type !== 'media') return clip.type;
  return store.media.get(clip.mediaId)?.type || 'missing';
}
export const isVisual = (clip) => clip.type === 'color' || (clip.type === 'media' && clipKind(clip) === 'video');

export function trackEnd(trackId) {
  return store.project.clips.filter((c) => c.track === trackId).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

export function select(id) {
  if (store.selected === id) return;
  store.selected = id;
  emit('select');
}
export function setTime(t) {
  store.time = Math.max(0, t);
  emit('time');
}

// ---------- operations ----------
export function addClip(clip) {
  mutate((p) => p.clips.push(clip));
  select(clip.id);
  return clip;
}

export function deleteClip(id) {
  if (!getClip(id)) return;
  mutate((p) => { p.clips = p.clips.filter((c) => c.id !== id); });
  if (store.selected === id) select(null);
}

export function splitClip(id, t) {
  const c = getClip(id);
  if (!c || t <= c.start + 0.05 || t >= clipEnd(c) - 0.05) return false;
  mutate((p) => {
    const off = t - c.start;
    const b = structuredClone(c);
    b.id = uid();
    b.start = t;
    b.duration = c.duration - off;
    if (c.type === 'media') b.in = c.in + off * (c.speed || 1);
    if (b.transition) b.transition = { type: 'none', duration: c.transition.duration };
    if ('fadeIn' in b) b.fadeIn = 0;
    if ('fadeOut' in c) c.fadeOut = 0;
    c.duration = off;
    p.clips.push(b);
  });
  return true;
}

export function duplicateClip(id) {
  const c = getClip(id);
  if (!c) return;
  const d = structuredClone(c);
  d.id = uid();
  d.start = trackEnd(c.track);
  if (d.transition) d.transition.type = 'none';
  addClip(d);
}

/** Remove empty gaps on a track by sliding clips left. */
export function closeGaps(trackId) {
  mutate((p) => {
    const clips = p.clips.filter((c) => c.track === trackId).sort((a, b) => a.start - b.start);
    let t = 0;
    for (const c of clips) {
      if (c.start > t) c.start = t;
      t = Math.max(t, c.start + c.duration);
    }
  });
}

/** Clips on the same track sorted by start time. */
export function trackClips(trackId, clips = store.project.clips) {
  return clips.filter((c) => c.track === trackId).sort((a, b) => a.start - b.start);
}

/** The clip on the same track that ends exactly where `clip` starts (for transitions). */
export function prevAdjacent(clip, clips = store.project.clips) {
  let best = null;
  for (const c of clips) {
    if (c === clip || c.track !== clip.track) continue;
    if (Math.abs(clipEnd(c) - clip.start) < 0.06 && (!best || c.start > best.start)) best = c;
  }
  return best;
}
export function nextAdjacent(clip, clips = store.project.clips) {
  for (const c of clips) {
    if (c !== clip && c.track === clip.track && Math.abs(c.start - clipEnd(clip)) < 0.06) return c;
  }
  return null;
}
export function transitionDuration(clip) {
  if (!clip.transition || clip.transition.type === 'none') return 0;
  return Math.min(clip.transition.duration, clip.duration * 0.9);
}

export function formatTime(t, withMs = true) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return withMs ? `${base}.${String(cs).padStart(2, '0')}` : base;
}
