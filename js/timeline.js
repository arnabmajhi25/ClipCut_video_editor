// Multi-track timeline: ruler, playhead, drag/move/trim clips, snapping, drop targets, zoom.
import {
  store, on, emit, TRACKS, getClip, select, setTime, clipKind, clipMediaType, clipEnd,
  checkpoint, commit, softChange, projectDuration, transitionDuration, splitClip, deleteClip,
  duplicateClip, closeGaps, makeMediaClip, makeTextClip, addClip, trackEnd, trackKind, clamp, mutate,
} from './state.js';
import { h, $, toast } from './ui.js';
import { importFiles } from './media.js';

let scroll, content, ruler, playhead, snapLine, zoomInput;
const trackEls = {};
const MEDIA_MIME = 'application/x-clipforge-media';
let draggingId = null;

// ---------- public helpers ----------
export function addMediaToTimeline(media, trackId, start) {
  const wantKind = media.type === 'audio' ? 'audio' : 'video';
  if (!trackId || trackKind(trackId) !== wantKind) trackId = wantKind === 'audio' ? 'A1' : 'V1';
  if (start === undefined) start = wantKind === 'audio' ? store.time : trackEnd(trackId);
  const clip = makeMediaClip(media, trackId, Math.max(0, start));
  addClip(clip);
  return clip;
}

export function addTextAtPlayhead(text = 'Your caption here', style = {}, anim = 'fade', duration = 3) {
  return addClip(makeTextClip(text, store.time, duration, style, anim));
}

export function zoomToFit() {
  const d = Math.max(projectDuration(), 5);
  setZoom((scroll.clientWidth - 60) / d);
  scroll.scrollLeft = 0;
}

// ---------- init ----------
export function initTimeline(root) {
  root.innerHTML = '';
  const tb = h('div', { class: 'tl-toolbar' },
    h('button', { class: 'icon-btn', title: 'Split at playhead (S)', onclick: splitSelected }, '✂ Split'),
    h('button', { class: 'icon-btn', title: 'Delete selected (Del)', onclick: () => store.selected && deleteClip(store.selected) }, '🗑'),
    h('button', { class: 'icon-btn', title: 'Duplicate (Ctrl+D)', onclick: () => store.selected && duplicateClip(store.selected) }, '⧉'),
    h('button', { class: 'icon-btn', title: 'Close gaps on the main video track', onclick: () => { closeGaps('V1'); toast('Gaps closed on main track'); } }, '⇤ Close gaps'),
    h('div', { class: 'sep' }),
    h('button', { class: 'icon-btn', title: 'Add caption at playhead (T)', onclick: () => addTextAtPlayhead() }, 'T+ Text'),
    h('div', { class: 'sep' }),
    h('button', { class: 'icon-btn on', id: 'snapBtn', title: 'Toggle snapping', onclick: (e) => { store.snap = !store.snap; e.currentTarget.classList.toggle('on', store.snap); } }, '🧲 Snap'),
    h('div', { class: 'spacer' }),
    h('div', { class: 'zoom' },
      h('button', { class: 'icon-btn', title: 'Zoom out', onclick: () => setZoom(store.zoom / 1.3) }, '−'),
      (zoomInput = h('input', { type: 'range', min: 4, max: 400, step: 1, value: store.zoom, oninput: (e) => setZoom(+e.target.value) })),
      h('button', { class: 'icon-btn', title: 'Zoom in', onclick: () => setZoom(store.zoom * 1.3) }, '+')
    ),
    h('button', { class: 'icon-btn', title: 'Zoom to fit', onclick: zoomToFit }, '↔ Fit')
  );

  const heads = h('div', { class: 'tl-heads' }, h('div', { class: 'tl-head-ruler' }));
  for (const t of TRACKS) {
    const head = h('div', { class: 'tl-head', 'data-kind': t.kind },
      h('div', { class: 'row' },
        h('span', {}, t.id),
        t.kind !== 'text' ? h('button', {
          class: 'chip mute-btn', 'data-track': t.id, title: 'Mute track',
          style: { marginLeft: 'auto', padding: '0 5px' },
          onclick: () => mutate((p) => {
            const s = new Set(p.mutedTracks || []);
            s.has(t.id) ? s.delete(t.id) : s.add(t.id);
            p.mutedTracks = [...s];
          }),
        }, '🔊') : null
      ),
      h('small', {}, t.label)
    );
    heads.append(head);
  }

  ruler = h('canvas', { class: 'tl-ruler' });
  playhead = h('div', { class: 'tl-playhead' }, h('div', { class: 'ph-head' }));
  snapLine = h('div', { class: 'tl-snapline' });
  content = h('div', { class: 'tl-content' }, ruler);
  for (const t of TRACKS) {
    const el = h('div', { class: 'tl-track', 'data-track': t.id, 'data-kind': t.kind });
    setupDrop(el, t);
    trackEls[t.id] = el;
    content.append(el);
  }
  content.append(playhead, snapLine);
  scroll = h('div', { class: 'tl-scroll' }, content);
  root.append(tb, h('div', { class: 'tl-main' }, heads, scroll));

  content.addEventListener('pointerdown', onPointerDown);
  scroll.addEventListener('scroll', drawRuler);
  scroll.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(store.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX);
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      scroll.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });
  new ResizeObserver(() => { updateWidth(); drawRuler(); }).observe(scroll);

  on('change', renderAll);
  on('media', renderAll);
  on('select', renderAll);
  on('time', onTime);
  renderAll();
}

function splitSelected() {
  const c = store.selected && getClip(store.selected);
  const target = c && store.time > c.start && store.time < clipEnd(c)
    ? c
    : store.project.clips.find((x) => x.track === 'V1' && store.time > x.start && store.time < clipEnd(x));
  if (!target || !splitClip(target.id, store.time)) toast('Place the playhead over a clip to split it');
}
export { splitSelected };

// ---------- rendering ----------
function renderAll() {
  for (const t of TRACKS) trackEls[t.id].replaceChildren();
  for (const c of store.project.clips) trackEls[c.track]?.append(clipEl(c));
  const muted = new Set(store.project.mutedTracks || []);
  document.querySelectorAll('.mute-btn').forEach((b) => {
    const m = muted.has(b.dataset.track);
    b.textContent = m ? '🔇' : '🔊';
    b.classList.toggle('active', m);
  });
  updateWidth();
  onTime();
}

function clipEl(c) {
  const kind = clipMediaType(c);
  const z = store.zoom;
  const w = Math.max(3, c.duration * z);
  const el = h('div', {
    class: `clip k-${kind}${c.id === store.selected ? ' selected' : ''}${c.id === draggingId ? ' dragging' : ''}`,
    'data-id': c.id,
    style: { left: `${c.start * z}px`, width: `${w}px` },
  });
  const media = c.type === 'media' ? store.media.get(c.mediaId) : null;
  if (kind === 'video' && media?.thumbs?.length) {
    const box = h('div', { class: 'thumbs' });
    const tileW = (media.thumbW || 114) * (52 / 64);
    const n = Math.min(80, Math.ceil(w / tileW));
    for (let i = 0; i < n; i++) {
      const tt = c.in + ((i * tileW) / z) * (c.speed || 1);
      const idx = clamp(Math.floor((tt / media.duration) * media.thumbs.length), 0, media.thumbs.length - 1);
      box.append(h('img', { src: media.thumbs[idx], style: { width: `${tileW}px` } }));
    }
    el.append(box);
  } else if (kind === 'image' && media) {
    el.append(h('div', { class: 'thumbs', style: { backgroundImage: `url(${media.url})`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' } }));
  } else if (kind === 'color') {
    el.style.background = c.color;
  }
  if (kind === 'audio' && media?.peaks) el.append(waveCanvas(c, media, w, 40));

  let label = c.type === 'text' ? c.text : c.name || media?.name || 'Missing media';
  if (c.speed && c.speed !== 1) label += ` · ${c.speed}×`;
  if (c.muted) label = '🔇 ' + label;
  el.append(h('div', { class: 'label', title: label }, label));

  const td = transitionDuration(c);
  if (td) el.append(h('div', { class: 'tr-badge', style: { width: `${td * z}px` }, title: `Transition: ${c.transition.type}` }));
  if (c.fadeIn) el.append(h('div', { class: 'fade in', style: { width: `${c.fadeIn * z}px` } }));
  if (c.fadeOut) el.append(h('div', { class: 'fade out', style: { width: `${c.fadeOut * z}px` } }));
  const hasFx = (c.preset && c.preset !== 'none') || (c.motion && c.motion !== 'none') ||
    (c.fx && Object.entries(c.fx).some(([k, v]) => v !== (['brightness', 'contrast', 'saturate'].includes(k) ? 100 : 0)));
  if (hasFx) el.append(h('div', { class: 'fx-badge', title: 'Has effects' }, '✦'));
  el.append(h('div', { class: 'handle l', title: 'Trim start' }), h('div', { class: 'handle r', title: 'Trim end' }));
  return el;
}

function waveCanvas(c, media, w, hgt) {
  const cw = Math.min(Math.ceil(w), 4000);
  const cv = h('canvas', { class: 'wave', width: cw, height: hgt, style: { width: `${w}px` } });
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(61, 220, 151, 0.85)';
  const pps = media.peaksPerSec;
  const span = c.duration * (c.speed || 1);
  for (let x = 0; x < cw; x++) {
    const t = c.in + (x / cw) * span;
    const v = media.peaks[Math.min(media.peaks.length - 1, Math.floor(t * pps))] || 0;
    const bh = Math.max(1, v * (hgt - 6) * (c.muted ? 0.2 : Math.min(1.5, c.volume ?? 1)));
    ctx.fillRect(x, (hgt - bh) / 2, 1, bh);
  }
  return cv;
}

function updateWidth() {
  if (!scroll) return;
  const d = Math.max(projectDuration() + 30, scroll.clientWidth / store.zoom);
  content.style.width = `${d * store.zoom}px`;
  drawRuler();
}

function drawRuler() {
  const w = scroll.clientWidth;
  const dpr = window.devicePixelRatio || 1;
  ruler.width = w * dpr;
  ruler.height = 26 * dpr;
  ruler.style.width = `${w}px`;
  const ctx = ruler.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, 26);
  const z = store.zoom;
  const t0 = scroll.scrollLeft / z;
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const major = steps.find((s) => s * z >= 80) || 600;
  const minor = major / 5;
  ctx.font = '10px Inter, Segoe UI, sans-serif';
  ctx.textBaseline = 'top';
  const start = Math.floor(t0 / minor) * minor;
  for (let t = start; (t - t0) * z < w; t += minor) {
    const x = Math.round((t - t0) * z) + 0.5;
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ctx.strokeStyle = isMajor ? '#59607a' : '#353a4a';
    ctx.beginPath();
    ctx.moveTo(x, isMajor ? 12 : 19);
    ctx.lineTo(x, 26);
    ctx.stroke();
    if (isMajor) {
      ctx.fillStyle = '#8a90a2';
      const m = Math.floor(t / 60);
      const s = t % 60;
      ctx.fillText(major < 1 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.round(s)).padStart(2, '0')}`, x + 3, 2);
    }
  }
}

function onTime() {
  if (!scroll) return;
  const x = store.time * store.zoom;
  playhead.style.left = `${x}px`;
  if (store.playing) {
    if (x > scroll.scrollLeft + scroll.clientWidth - 40 || x < scroll.scrollLeft) scroll.scrollLeft = x - 40;
  }
}

function setZoom(z, anchorClientX) {
  z = clamp(z, 4, 400);
  const rect = scroll.getBoundingClientRect();
  const ax = anchorClientX ?? rect.left + (store.time * store.zoom - scroll.scrollLeft);
  const tAt = (scroll.scrollLeft + ax - rect.left) / store.zoom;
  store.zoom = z;
  zoomInput.value = z;
  renderAll();
  scroll.scrollLeft = tAt * z - (ax - rect.left);
  drawRuler();
}

// ---------- interaction ----------
const xToTime = (clientX) => (clientX - content.getBoundingClientRect().left) / store.zoom;

function dragLoop(onMove, onUp) {
  const move = (ev) => onMove(ev);
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    onUp?.(ev);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  const node = e.target.closest('.clip');
  if (node) return startClipDrag(e, node);
  emit('scrub');
  if (!e.target.closest('.tl-ruler')) select(null);
  const move = (ev) => setTime(Math.max(0, xToTime(ev.clientX)));
  move(e);
  dragLoop(move);
}

function snapPoints(excludeId) {
  const pts = [0, store.time];
  for (const c of store.project.clips) if (c.id !== excludeId) pts.push(c.start, clipEnd(c));
  return pts;
}
function snap(t, pts) {
  if (!store.snap) return { hit: false, t };
  const thr = 8 / store.zoom;
  let best = null;
  for (const p of pts) { const d = Math.abs(p - t); if (d < thr && (!best || d < best.d)) best = { t: p, d }; }
  return best ? { hit: true, t: best.t, d: best.d } : { hit: false, t };
}
function showSnap(t) { snapLine.style.display = 'block'; snapLine.style.left = `${t * store.zoom}px`; }
function hideSnap() { snapLine.style.display = 'none'; }

function startClipDrag(e, node) {
  const c = getClip(node.dataset.id);
  if (!c) return;
  select(c.id);
  const cls = e.target.classList;
  const mode = cls.contains('l') ? 'l' : cls.contains('r') ? 'r' : 'move';
  const x0 = e.clientX;
  const o = { start: c.start, dur: c.duration, in: c.in || 0 };
  const media = c.type === 'media' ? store.media.get(c.mediaId) : null;
  const timed = media && (media.type === 'video' || media.type === 'audio');
  const speed = c.speed || 1;
  const kind = clipKind(c);
  const pts = snapPoints(c.id);
  let moved = false;
  checkpoint();

  dragLoop((ev) => {
    const dx = (ev.clientX - x0) / store.zoom;
    if (!moved && Math.abs(ev.clientX - x0) < 3) return;
    moved = true;
    draggingId = c.id;
    if (mode === 'move') {
      let ns = Math.max(0, o.start + dx);
      const s1 = snap(ns, pts);
      const s2 = snap(ns + o.dur, pts);
      if (s1.hit && (!s2.hit || s1.d <= s2.d)) { ns = s1.t; showSnap(s1.t); }
      else if (s2.hit) { ns = s2.t - o.dur; showSnap(s2.t); }
      else hideSnap();
      c.start = Math.max(0, ns);
      const tEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tl-track');
      if (tEl && tEl.dataset.kind === kind) c.track = tEl.dataset.track;
    } else if (mode === 'l') {
      const end = o.start + o.dur;
      let ns = o.start + dx;
      const s = snap(ns, pts);
      if (s.hit) { ns = s.t; showSnap(ns); } else hideSnap();
      if (timed) ns = Math.max(ns, o.start - o.in / speed);
      ns = clamp(ns, 0, end - 0.1);
      c.start = ns;
      c.duration = end - ns;
      if (timed) c.in = o.in + (ns - o.start) * speed;
    } else {
      let ne = o.start + o.dur + dx;
      const s = snap(ne, pts);
      if (s.hit) { ne = s.t; showSnap(ne); } else hideSnap();
      ne = Math.max(ne, c.start + 0.1);
      if (timed) ne = Math.min(ne, c.start + (media.duration - c.in) / speed);
      c.duration = ne - c.start;
    }
    softChange();
  }, () => {
    draggingId = null;
    hideSnap();
    commit();
    emit('change');
  });
}

function setupDrop(el, track) {
  el.addEventListener('dragover', (e) => {
    const types = [...e.dataTransfer.types];
    if (!types.includes(MEDIA_MIME) && !types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('drop');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drop');
    const time = Math.max(0, xToTime(e.clientX));
    const id = e.dataTransfer.getData(MEDIA_MIME);
    if (id) {
      const m = store.media.get(id);
      if (m) addMediaToTimeline(m, track.id, time);
      return;
    }
    if (e.dataTransfer.files.length) {
      const list = await importFiles([...e.dataTransfer.files], (err) => toast(err.message, 'error'));
      let t = time;
      for (const m of list) { const c = addMediaToTimeline(m, track.id, t); t = clipEnd(c); }
    }
  });
}

export { MEDIA_MIME };
