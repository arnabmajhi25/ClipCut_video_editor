// Right-hand properties panel for the selected clip (or the project when nothing is selected).
import {
  store, on, emit, selectedClip, checkpoint, commit, softChange, mutate, clipMediaType,
  DEFAULT_FX, DEFAULT_TRANSFORM, clamp, formatTime, deleteClip, prevAdjacent, projectDuration,
} from './state.js';
import { PRESETS, MOTIONS, TRANSITIONS, TEXT_ANIMS } from './effects.js';
import { h, toast } from './ui.js';

let root;
const openState = {}; // remembers which <details> sections are collapsed

export const FONTS = {
  'Inter, "Segoe UI", system-ui, sans-serif': 'Sans (System)',
  'Arial Black, Arial, sans-serif': 'Arial Black',
  'Impact, Haettenschweiler, sans-serif': 'Impact',
  'Georgia, serif': 'Georgia',
  '"Times New Roman", serif': 'Times',
  '"Trebuchet MS", sans-serif': 'Trebuchet',
  'Verdana, sans-serif': 'Verdana',
  '"Courier New", monospace': 'Courier (Mono)',
  '"Comic Sans MS", cursive': 'Comic',
  '"Brush Script MT", cursive': 'Brush Script',
};

const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setPath = (o, p, v) => {
  const ks = p.split('.');
  let a = o;
  for (const k of ks.slice(0, -1)) a = a[k] ||= {};
  a[ks.at(-1)] = v;
};
const finish = () => { commit(); emit('change'); };
