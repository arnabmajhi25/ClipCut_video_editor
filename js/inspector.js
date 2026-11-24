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

// ---------- field builders ----------
function slider(clip, path, label, min, max, step, { fmt = (v) => v, def, onSet } = {}) {
  const val = getPath(clip, path) ?? def ?? 0;
  const out = h('span', { class: 'val' }, fmt(val));
  const input = h('input', { type: 'range', min, max, step, value: val, title: def !== undefined ? 'Double-click to reset' : '' });
  const apply = (v) => {
    checkpoint();
    onSet ? onSet(clip, v) : setPath(clip, path, v);
    out.textContent = fmt(v);
    softChange();
  };
  input.addEventListener('input', () => apply(+input.value));
  input.addEventListener('change', finish);
  if (def !== undefined) input.addEventListener('dblclick', () => { input.value = def; apply(def); finish(); });
  return h('div', { class: 'field' }, h('label', {}, label), input, out);
}

function selectField(clip, path, label, options, { onSet, rerender } = {}) {
  const val = getPath(clip, path);
  const sel = h('select', {}, Object.entries(options).map(([v, l]) => h('option', { value: v, selected: v === String(val) }, l)));
  sel.addEventListener('change', () => {
    checkpoint();
    const v = typeof val === 'number' ? +sel.value : sel.value;
    onSet ? onSet(clip, v) : setPath(clip, path, v);
    finish();
    if (rerender) render();
  });
  return h('div', { class: 'field wide' }, h('label', {}, label), sel);
}

function colorField(clip, path, label) {
  const input = h('input', { type: 'color', value: getPath(clip, path) || '#ffffff' });
  input.addEventListener('input', () => { checkpoint(); setPath(clip, path, input.value); softChange(); });
  input.addEventListener('change', finish);
  return h('div', { class: 'field wide' }, h('label', {}, label), h('div', {}, input));
}

function checkField(clip, path, label, onSet) {
  const input = h('input', { type: 'checkbox', checked: !!getPath(clip, path) });
  input.addEventListener('change', () => { checkpoint(); onSet ? onSet(clip, input.checked) : setPath(clip, path, input.checked); finish(); });
  return h('div', { class: 'field wide' }, h('label', {}, label), h('div', {}, input));
}

function numberField(clip, path, label, { min = 0, max = 1e6, step = 0.01, onSet } = {}) {
  const input = h('input', { type: 'number', min, max, step, value: (+getPath(clip, path) || 0).toFixed(2) });
  input.addEventListener('change', () => {
    checkpoint();
    const v = clamp(+input.value || 0, min, max);
    onSet ? onSet(clip, v) : setPath(clip, path, v);
    finish();
    render();
  });
  return h('div', { class: 'field wide' }, h('label', {}, label), input);
}

function section(title, ...children) {
  const d = h('details', { class: 'section', open: openState[title] !== false }, h('summary', {}, title), ...children);
  d.addEventListener('toggle', () => { openState[title] = d.open; });
  return d;
}
