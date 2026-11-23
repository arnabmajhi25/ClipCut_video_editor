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
