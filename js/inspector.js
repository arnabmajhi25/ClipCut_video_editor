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

// ---------- shared field groups ----------
function maxDurationFor(clip) {
  if (clip.type !== 'media') return 3600;
  const m = store.media.get(clip.mediaId);
  if (!m || m.type === 'image') return 3600;
  return (m.duration - clip.in) / (clip.speed || 1);
}

function timingFields(clip) {
  return [
    numberField(clip, 'start', 'Start (s)', { max: 36000 }),
    numberField(clip, 'duration', 'Duration (s)', {
      min: 0.1, max: 36000,
      onSet: (c, v) => { c.duration = Math.min(v, maxDurationFor(c)); },
    }),
  ];
}

function setSpeed(c, v) {
  const old = c.speed || 1;
  c.speed = v;
  c.duration = Math.min((c.duration * old) / v, maxDurationFor(c));
}

function audioFields(clip, isVideo) {
  const fields = [];
  const m = store.media.get(clip.mediaId);
  if (m && m.type !== 'image') {
    fields.push(selectField(clip, 'speed', 'Speed', { 0.25: '0.25×', 0.5: '0.5× slow-mo', 0.75: '0.75×', 1: '1× normal', 1.25: '1.25×', 1.5: '1.5×', 2: '2× fast', 3: '3×', 4: '4×' }, { onSet: setSpeed, rerender: true }));
    if (!isVideo || m.hasAudio !== false) {
      fields.push(slider(clip, 'volume', 'Volume', 0, 2, 0.01, { fmt: (v) => `${Math.round(v * 100)}%`, def: 1 }));
      fields.push(checkField(clip, 'muted', 'Mute'));
    }
  }
  fields.push(slider(clip, 'fadeIn', 'Fade in', 0, 5, 0.1, { fmt: (v) => `${(+v).toFixed(1)}s`, def: 0 }));
  fields.push(slider(clip, 'fadeOut', 'Fade out', 0, 5, 0.1, { fmt: (v) => `${(+v).toFixed(1)}s`, def: 0 }));
  return fields;
}

function transformSection(clip) {
  return section('Transform & motion',
    selectField(clip, 'transform.fit', 'Fit', { contain: 'Fit (letterbox)', cover: 'Fill (crop)', stretch: 'Stretch' }),
    slider(clip, 'transform.scale', 'Scale', 0.1, 4, 0.01, { fmt: (v) => `${Math.round(v * 100)}%`, def: 1 }),
    slider(clip, 'transform.x', 'Position X', -1, 1, 0.005, { fmt: (v) => (+v).toFixed(2), def: 0 }),
    slider(clip, 'transform.y', 'Position Y', -1, 1, 0.005, { fmt: (v) => (+v).toFixed(2), def: 0 }),
    slider(clip, 'transform.rotation', 'Rotation', -180, 180, 1, { fmt: (v) => `${v}°`, def: 0 }),
    slider(clip, 'transform.opacity', 'Opacity', 0, 1, 0.01, { fmt: (v) => `${Math.round(v * 100)}%`, def: 1 }),
    checkField(clip, 'transform.flipH', 'Mirror'),
    selectField(clip, 'motion', 'Motion', MOTIONS),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => mutate(() => { clip.transform = { ...DEFAULT_TRANSFORM }; clip.motion = 'none'; }) || render() }, 'Reset transform'),
      h('button', { class: 'btn', title: 'Picture-in-picture corner preset', onclick: () => { mutate(() => Object.assign(clip.transform, { scale: 0.35, x: 0.3, y: -0.3 })); render(); } }, 'PiP corner')
    )
  );
}

function effectsSection(clip) {
  const chips = h('div', { class: 'chips' }, Object.entries(PRESETS).map(([k, p]) =>
    h('button', { class: `chip${clip.preset === k ? ' active' : ''}`, onclick: () => { mutate(() => { clip.preset = k; }); render(); } }, p.label)
  ));
  const pct = (v) => `${Math.round(v)}%`;
  return section('Color & effects',
    h('div', { class: 'panel-sub', style: { marginTop: 0 } }, 'Filter preset'), chips,
    h('div', { class: 'panel-sub' }, 'Adjustments'),
    slider(clip, 'fx.brightness', 'Brightness', 0, 200, 1, { fmt: pct, def: 100 }),
    slider(clip, 'fx.contrast', 'Contrast', 0, 200, 1, { fmt: pct, def: 100 }),
    slider(clip, 'fx.saturate', 'Saturation', 0, 300, 1, { fmt: pct, def: 100 }),
    slider(clip, 'fx.hue', 'Hue', -180, 180, 1, { fmt: (v) => `${v}°`, def: 0 }),
    slider(clip, 'fx.blur', 'Blur', 0, 20, 0.1, { fmt: (v) => (+v).toFixed(1), def: 0 }),
    slider(clip, 'fx.grayscale', 'Grayscale', 0, 100, 1, { fmt: pct, def: 0 }),
    slider(clip, 'fx.sepia', 'Sepia', 0, 100, 1, { fmt: pct, def: 0 }),
    slider(clip, 'fx.invert', 'Invert', 0, 100, 1, { fmt: pct, def: 0 }),
    slider(clip, 'fx.vignette', 'Vignette', 0, 100, 1, { fmt: pct, def: 0 }),
    h('button', { class: 'btn', onclick: () => { mutate(() => { clip.fx = { ...DEFAULT_FX }; clip.preset = 'none'; }); render(); } }, 'Reset effects')
  );
}

function transitionSection(clip) {
  const prev = prevAdjacent(clip);
  return section('Transition in',
    selectField(clip, 'transition.type', 'Type', TRANSITIONS, { rerender: true }),
    slider(clip, 'transition.duration', 'Duration', 0.2, 3, 0.05, { fmt: (v) => `${(+v).toFixed(2)}s`, def: 0.8 }),
    h('div', { class: 'note' }, prev
      ? h('span', {}, 'Blends from ', h('b', {}, prev.name || 'previous clip'), ' into this clip.')
      : 'No clip directly before this one on the track — the transition reveals it over the background. Butt clips together (snap) to blend between them.')
  );
}
