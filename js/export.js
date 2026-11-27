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

async function runExport(engine, opts) {
  const { renderer, player, applyPreviewSize } = engine;
  const mime = supported(opts.fmt);
  const dur = projectDuration();
  const [w, hgt] = sizeFor(opts.short);
  const fps = +store.project.fps || 30;
  const bppf = { low: 0.05, med: 0.09, high: 0.14 }[opts.quality];
  const vbr = Math.round(clamp(w * hgt * fps * bppf, 1e6, 40e6));

  let cancelled = false;
  const bar = h('div');
  const label = h('div', { class: 'muted' }, 'Preparing…');
  openModal(h('div', {},
    h('h2', {}, 'Exporting…'),
    h('div', { class: 'progress' }, bar),
    label,
    h('div', { class: 'actions' }, h('button', { class: 'btn danger', onclick: () => { cancelled = true; player.pause(); } }, 'Cancel'))
  ), { dismissable: false });

  player.pause();
  store.exporting = true;
  ensureAudio();
  const prevVol = audio.master.gain.value;
  if (opts.mute) audio.master.gain.value = 0;
  renderer.resize(w, hgt);

  // Pre-roll: seek to 0 and wait for the first frame to be decoded.
  player.seek(0);
  for (let i = 0; i < 60 && !renderer.framesReady(0); i++) { renderer.sync(0, false); await sleep(50); }
  renderer.render(0);

  const stream = new MediaStream([
    ...renderer.canvas.captureStream(fps).getVideoTracks(),
    ...audio.dest.stream.getAudioTracks(),
  ]);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: vbr, audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((r) => { rec.onstop = r; });

  let raf;
  const tick = () => {
    const p = Math.min(1, store.time / dur);
    bar.style.width = `${(p * 100).toFixed(1)}%`;
    label.textContent = `${formatTime(store.time)} / ${formatTime(dur)}  ·  ${w}×${hgt}  ·  ${opts.fmt.toUpperCase()}`;
    raf = requestAnimationFrame(tick);
  };
  tick();

  rec.start(500);
  await new Promise((resolve) => {
    player.onEnd = resolve;
    player.onPause = resolve; // cancel path
    player.play();
  });
  player.onEnd = player.onPause = null;
  await sleep(250); // let the last frames flush
  rec.stop();
  await stopped;
  stream.getVideoTracks().forEach((t) => t.stop());
  cancelAnimationFrame(raf);

  audio.master.gain.value = prevVol;
  store.exporting = false;
  applyPreviewSize();
  closeModal();

  if (cancelled) return toast('Export cancelled');
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  download(blob, `${opts.name}.${opts.fmt}`);
  toast(`Exported ${opts.name}.${opts.fmt} (${(blob.size / 1048576).toFixed(1)} MB)`, 'ok');
}
