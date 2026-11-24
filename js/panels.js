// Left sidebar panels: Media, Text, Transitions, Effects. (Music lives in spotify.js.)
import {
  store, on, mutate, selectedClip, isVisual, makeColorClip, addClip, trackEnd, formatTime, select, emit,
} from './state.js';
import { PRESETS, MOTIONS, TRANSITIONS, TEXT_ANIMS } from './effects.js';
import { h, $, $$, toast, confirmDialog, pickFiles, download } from './ui.js';
import { importFiles, removeMedia } from './media.js';
import { addMediaToTimeline, addTextAtPlayhead, MEDIA_MIME } from './timeline.js';
import { parseSubtitles, addCaptions, exportSRT, transcriptToCaptions } from './captions.js';

export function initPanels() {
  $$('.side-tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      $$('.side-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $$('.side-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === b.dataset.tab));
    })
  );
  initMediaPanel($('[data-panel="media"]'));
  initTextPanel($('[data-panel="text"]'));
  initTransitionsPanel($('[data-panel="transitions"]'));
  initEffectsPanel($('[data-panel="effects"]'));
}

const reportErr = (e) => toast(e.message || String(e), 'error');

// ---------- Media ----------
function initMediaPanel(el) {
  const grid = h('div', { class: 'media-grid' });
  const drop = h('div', { class: 'dropzone' }, 'Drag & drop files here', h('br'), h('small', {}, 'MP4, WebM, MOV · MP3, WAV, M4A · PNG, JPG, GIF'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    drop.classList.remove('over');
    importFiles([...e.dataTransfer.files], reportErr);
  });
  const colorIn = h('input', { type: 'color', value: '#7c5cff' });

  el.append(
    h('div', { class: 'panel-title' }, 'Media library'),
    h('div', { class: 'stack' },
      h('button', { class: 'btn accent full', onclick: () => $('#fileInput').click() }, '⇪ Import video, audio or images'),
      drop
    ),
    grid,
    h('div', { class: 'panel-sub' }, 'Solid color / title card'),
    h('div', { class: 'row' }, colorIn,
      h('button', { class: 'btn', style: { flex: 1 }, onclick: () => addClip(makeColorClip(colorIn.value, 'V1', trackEnd('V1'))) }, '+ Add color clip'))
  );

  const renderGrid = () => {
    grid.replaceChildren();
    if (!store.media.size) {
      grid.append(h('div', { class: 'muted', style: { gridColumn: '1 / -1', padding: '10px 2px' } }, 'No media yet.'));
      return;
    }
    for (const m of store.media.values()) {
      const icon = { video: '🎞', audio: '♫', image: '🖼' }[m.type];
      const card = h('div', { class: 'media-card', draggable: true, title: m.name },
        h('div', { class: 'thumb', style: m.poster ? { backgroundImage: `url("${m.poster}")` } : {} }, m.poster ? '' : icon),
        m.type !== 'image' ? h('span', { class: 'dur' }, formatTime(m.duration, false)) : null,
        h('div', { class: 'actions' },
          h('button', { title: 'Add to timeline', onclick: (e) => { e.stopPropagation(); addMediaToTimeline(m); } }, '+'),
          h('button', { title: 'Remove from library', onclick: (e) => { e.stopPropagation(); deleteMediaFlow(m); } }, '×')
        ),
        h('div', { class: 'meta' }, h('div', { class: 'name' }, h('span', { class: 'badge' }, m.type), m.name))
      );
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData(MEDIA_MIME, m.id);
        e.dataTransfer.effectAllowed = 'copy';
      });
      card.addEventListener('dblclick', () => addMediaToTimeline(m));
      grid.append(card);
    }
  };
  on('media', renderGrid);
  renderGrid();
}

async function deleteMediaFlow(m) {
  const used = store.project.clips.filter((c) => c.mediaId === m.id).length;
  if (used && !(await confirmDialog('Remove media?', `"${m.name}" is used by ${used} clip(s) on the timeline. They will be removed too.`, 'Remove'))) return;
  if (used) mutate((p) => { p.clips = p.clips.filter((c) => c.mediaId !== m.id); });
  if (store.selected && !store.project.clips.some((c) => c.id === store.selected)) select(null);
  await removeMedia(m.id);
}
