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
