// Real-time export: records the compositor canvas + mixed audio with MediaRecorder.
import { store, projectDuration, formatTime, clamp } from './state.js';
import { audio, ensureAudio } from './renderer.js';
import { h, openModal, closeModal, toast, download } from './ui.js';

const MIMES = [
  ['mp4', 'video/mp4;codecs=avc1.640028,mp4a.40.2'],
  ['mp4', 'video/mp4;codecs=avc1.4d0028,mp4a.40.2'],
  ['mp4', 'video/mp4;codecs=avc1,mp4a.40.2'],
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm;codecs=vp9,opus'],
  ['webm', 'video/webm;codecs=vp8,opus'],
  ['webm', 'video/webm'],
];
const supported = (fmt) => MIMES.find(([f, m]) => f === fmt && window.MediaRecorder && MediaRecorder.isTypeSupported(m))?.[1];

function sizeFor(shortSide) {
  const { width, height } = store.project;
  const k = shortSide / Math.min(width, height);
  const even = (v) => Math.round((v * k) / 2) * 2;
  return [even(width), even(height)];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param engine { renderer, player, applyPreviewSize }
 */
export function openExportDialog(engine) {
  const dur = projectDuration();
  if (dur <= 0) return toast('Add some clips to the timeline first');
  if (!window.MediaRecorder) return toast('This browser cannot record video. Use Chrome, Edge or Firefox.', 'error');

  const formats = ['mp4', 'webm'].filter(supported);
  const fmtSel = h('select', {}, formats.map((f) => h('option', { value: f }, f === 'mp4' ? 'MP4 (H.264 + AAC)' : 'WebM (VP9/VP8 + Opus)')));
  const resSel = h('select', {}, [[480, '480p'], [720, '720p HD'], [1080, '1080p Full HD'], [1440, '1440p QHD']].map(([v, l]) => h('option', { value: v, selected: v === 1080 }, l)));
  const qSel = h('select', {}, [['low', 'Smaller file'], ['med', 'Balanced'], ['high', 'High quality']].map(([v, l]) => h('option', { value: v, selected: v === 'high' }, l)));
  const muteChk = h('input', { type: 'checkbox', checked: true });
  const nameIn = h('input', { value: store.project.name || 'video' });

  const body = openModal(h('div', {},
    h('h2', {}, 'Export video'),
    h('div', { class: 'field wide' }, h('label', {}, 'File name'), nameIn),
    h('div', { class: 'field wide' }, h('label', {}, 'Format'), fmtSel),
    h('div', { class: 'field wide' }, h('label', {}, 'Resolution'), resSel),
    h('div', { class: 'field wide' }, h('label', {}, 'Quality'), qSel),
    h('div', { class: 'field wide' }, h('label', {}, 'Mute speakers'), h('div', {}, muteChk)),
    h('div', { class: 'note' },
      `Duration ${formatTime(dur)} · ${store.project.fps} fps. Export renders in real time, so it takes about as long as the video. `,
      h('b', {}, 'Keep this tab visible'), ' while exporting.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => { snapshot(engine); } }, '📷 Save frame (PNG)'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', {
        class: 'btn accent',
        onclick: () => runExport(engine, {
          fmt: fmtSel.value, short: +resSel.value, quality: qSel.value, mute: muteChk.checked,
          name: (nameIn.value || 'video').replace(/[\\/:*?"<>|]+/g, '_'),
        }),
      }, 'Export')
    )
  ));
  body.querySelector('.btn.accent').focus();
}

function snapshot(engine) {
  engine.renderer.render(store.time);
  engine.renderer.canvas.toBlob((b) => download(b, `${store.project.name || 'frame'}-${formatTime(store.time).replace(/[:.]/g, '-')}.png`), 'image/png');
}
