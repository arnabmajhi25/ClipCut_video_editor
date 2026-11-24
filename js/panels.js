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

// ---------- Text & captions ----------
export const TEXT_PRESETS = [
  { id: 'classic', label: 'Classic subtitle', css: 'font-size:15px;text-shadow:0 0 3px #000', style: { size: 52, bold: true, strokeWidth: 5 }, anim: 'fade' },
  { id: 'social', label: 'BOLD SOCIAL', css: 'font-size:18px;font-weight:900;color:#fff;text-shadow:0 0 4px #000', style: { size: 84, uppercase: true, strokeWidth: 9, pos: 'center', font: 'Arial Black, Arial, sans-serif' }, anim: 'highlight' },
  { id: 'title', label: 'Big Title', css: 'font-size:24px;font-family:Impact', style: { size: 150, pos: 'center', strokeWidth: 0, font: 'Impact, Haettenschweiler, sans-serif' }, anim: 'pop' },
  { id: 'boxed', label: 'Boxed caption', css: 'font-size:14px;background:rgba(0,0,0,.8);padding:3px 8px;border-radius:4px', style: { size: 50, bgOpacity: 0.78, strokeWidth: 0, shadow: false }, anim: 'slide' },
  { id: 'typewriter', label: 'Typewriter', css: 'font-family:Courier New;font-size:15px', style: { size: 56, font: '"Courier New", monospace', strokeWidth: 0, bgOpacity: 0.55 }, anim: 'typewriter' },
  { id: 'neon', label: 'Neon glow', css: 'color:#39ff14;font-size:18px;text-shadow:0 0 8px #39ff14', style: { size: 96, color: '#39ff14', stroke: '#063d00', strokeWidth: 3, pos: 'center', font: '"Trebuchet MS", sans-serif' }, anim: 'pop' },
  { id: 'lowerthird', label: 'Lower third', css: 'font-size:14px;background:#7c5cff;padding:3px 8px;border-radius:4px', style: { size: 46, pos: 'custom', x: 0.3, y: 0.8, bg: '#7c5cff', bgOpacity: 0.92, strokeWidth: 0, shadow: false, maxWidth: 0.5 }, anim: 'slide' },
  { id: 'wordbyword', label: 'Word by word', css: 'font-size:16px;font-weight:800;color:#ffd400;text-shadow:0 0 3px #000', style: { size: 80, color: '#ffd400', strokeWidth: 8, pos: 'center', uppercase: true }, anim: 'wordpop' },
];

function initTextPanel(el) {
  const presetSel = h('select', {}, TEXT_PRESETS.map((p, i) => h('option', { value: i }, p.label)));
  const wordsSel = h('select', {}, [3, 5, 8, 12].map((n) => h('option', { value: n, selected: n === 8 }, `${n} words / caption`)));
  const ta = h('textarea', { rows: 6, placeholder: 'Paste a transcript or lyrics here. Each line becomes one or more captions, timed by word count, starting at the playhead.' });

  el.append(
    h('div', { class: 'panel-title' }, 'Text & captions'),
    ...TEXT_PRESETS.map((p) =>
      h('button', { class: 'text-style-btn', onclick: () => addTextAtPlayhead(p.label === 'BOLD SOCIAL' ? 'Tap to edit this caption' : p.label, p.style, p.anim) },
        h('span', { style: p.css.split(';').reduce((o, d) => { const [k, v] = d.split(':'); if (k && v) o[k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v.trim(); return o; }, {}) }, p.label))
    ),
    h('div', { class: 'panel-sub' }, 'Transcript → captions'),
    h('div', { class: 'stack' },
      ta,
      h('div', { class: 'row' }, presetSel, wordsSel),
      h('button', {
        class: 'btn accent full',
        onclick: () => {
          if (!ta.value.trim()) return toast('Paste some text first');
          const p = TEXT_PRESETS[+presetSel.value];
          const items = transcriptToCaptions(ta.value, store.time, { maxWords: +wordsSel.value });
          const n = addCaptions(items, p.style, p.anim);
          toast(`Added ${n} captions`, 'ok');
        },
      }, 'Generate timed captions')
    ),
    h('div', { class: 'panel-sub' }, 'Subtitle files'),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn', style: { flex: 1 },
        onclick: async () => {
          const [f] = await pickFiles('.srt,.vtt,text/vtt', false);
          if (!f) return;
          const items = parseSubtitles(await f.text());
          if (!items.length) return toast('No captions found in that file', 'error');
          const p = TEXT_PRESETS[+presetSel.value];
          toast(`Imported ${addCaptions(items, p.style, 'none')} captions`, 'ok');
        },
      }, '⇪ Import SRT/VTT'),
      h('button', {
        class: 'btn', style: { flex: 1 },
        onclick: () => {
          const srt = exportSRT();
          if (!srt) return toast('No captions to export');
          download(new Blob([srt], { type: 'text/plain' }), `${store.project.name || 'captions'}.srt`);
        },
      }, '⇩ Export SRT')
    ),
    h('div', { class: 'note', style: { marginTop: '10px' } },
      'Tip: select a caption to change font, colors, outline, box, position and animation (', Object.values(TEXT_ANIMS).slice(1).join(', '), ').')
  );
}

// ---------- Transitions ----------
function requireVisual() {
  const c = selectedClip();
  if (!c || !isVisual(c)) { toast('Select a video, image or color clip on the timeline first'); return null; }
  return c;
}

function initTransitionsPanel(el) {
  let dur = 0.8;
  const durOut = h('span', { class: 'val' }, '0.80s');
  const durIn = h('input', { type: 'range', min: 0.2, max: 3, step: 0.05, value: dur, oninput: (e) => { dur = +e.target.value; durOut.textContent = `${dur.toFixed(2)}s`; } });
  const grid = h('div', { class: 'tile-grid' });
  for (const [k, label] of Object.entries(TRANSITIONS)) {
    grid.append(h('button', {
      class: 'tile', 'data-tr': k,
      onclick: () => {
        const c = requireVisual();
        if (!c) return;
        mutate(() => { c.transition = { type: k, duration: dur }; });
        toast(k === 'none' ? 'Transition removed' : `${label} applied`, 'ok');
      },
    }, h('div', { class: `ico tr-prev tr-${k}` }, h('i')), label));
  }
  el.append(
    h('div', { class: 'panel-title' }, 'Transitions'),
    h('div', { class: 'note' }, 'Select a clip, then pick a transition. It plays at the ', h('b', {}, 'start'), ' of that clip, blending from the clip right before it.'),
    h('div', { class: 'field', style: { marginTop: '10px' } }, h('label', {}, 'Duration'), durIn, durOut),
    grid,
    h('div', { class: 'panel-sub' }, 'Batch'),
    h('button', {
      class: 'btn full',
      onclick: () => {
        const type = store.selected && selectedClip()?.transition?.type;
        const t = type && type !== 'none' ? type : 'fade';
        let n = 0;
        mutate((p) => {
          const v1 = p.clips.filter((c) => c.track === 'V1').sort((a, b) => a.start - b.start);
          v1.forEach((c, i) => { if (i > 0 && Math.abs(v1[i - 1].start + v1[i - 1].duration - c.start) < 0.06) { c.transition = { type: t, duration: dur }; n++; } });
        });
        toast(n ? `Applied "${TRANSITIONS[t]}" to ${n} cut(s)` : 'No back-to-back clips on the main track', n ? 'ok' : '');
      },
    }, 'Apply to every cut on main track'),
    h('button', {
      class: 'btn full', style: { marginTop: '6px' },
      onclick: () => mutate((p) => p.clips.forEach((c) => { if (c.transition) c.transition.type = 'none'; })),
    }, 'Remove all transitions')
  );
  injectTransitionPreviewCSS();
}

function injectTransitionPreviewCSS() {
  const anim = {
    fade: 'opacity:0;animation:trf 1.6s infinite',
    fadeblack: 'opacity:0;animation:trf 1.6s infinite;filter:brightness(.2)',
    fadewhite: 'opacity:0;animation:trf 1.6s infinite;filter:brightness(2)',
    wipeleft: 'clip-path:inset(0 0 0 100%);animation:trwl 1.6s infinite',
    wiperight: 'clip-path:inset(0 100% 0 0);animation:trwr 1.6s infinite',
    wipeup: 'clip-path:inset(100% 0 0 0);animation:trwu 1.6s infinite',
    wipedown: 'clip-path:inset(0 0 100% 0);animation:trwd 1.6s infinite',
    slideleft: 'transform:translateX(100%);animation:trsl 1.6s infinite',
    slideright: 'transform:translateX(-100%);animation:trsr 1.6s infinite',
    slideup: 'transform:translateY(100%);animation:trsu 1.6s infinite',
    slidedown: 'transform:translateY(-100%);animation:trsd 1.6s infinite',
    zoomin: 'transform:scale(.3);opacity:0;animation:trzi 1.6s infinite',
    zoomout: 'transform:scale(1.6);opacity:0;animation:trzo 1.6s infinite',
    circle: 'clip-path:circle(0% at 50% 50%);animation:trc 1.6s infinite',
    blur: 'filter:blur(8px);opacity:0;animation:trb 1.6s infinite',
    spin: 'transform:rotate(-180deg) scale(0);animation:trsp 1.6s infinite',
    pixelate: 'opacity:0;animation:trf 1.6s steps(4) infinite',
    glitch: 'opacity:0;animation:trg 1.6s steps(6) infinite',
    none: 'display:none',
  };
  const css = `
  @keyframes trf{40%{opacity:0}80%,100%{opacity:1}}
  @keyframes trwl{40%{clip-path:inset(0 0 0 100%)}80%,100%{clip-path:inset(0 0 0 0)}}
  @keyframes trwr{40%{clip-path:inset(0 100% 0 0)}80%,100%{clip-path:inset(0 0 0 0)}}
  @keyframes trwu{40%{clip-path:inset(100% 0 0 0)}80%,100%{clip-path:inset(0 0 0 0)}}
  @keyframes trwd{40%{clip-path:inset(0 0 100% 0)}80%,100%{clip-path:inset(0 0 0 0)}}
  @keyframes trsl{40%{transform:translateX(100%)}80%,100%{transform:none}}
  @keyframes trsr{40%{transform:translateX(-100%)}80%,100%{transform:none}}
  @keyframes trsu{40%{transform:translateY(100%)}80%,100%{transform:none}}
  @keyframes trsd{40%{transform:translateY(-100%)}80%,100%{transform:none}}
  @keyframes trzi{40%{transform:scale(.3);opacity:0}80%,100%{transform:none;opacity:1}}
  @keyframes trzo{40%{transform:scale(1.6);opacity:0}80%,100%{transform:none;opacity:1}}
  @keyframes trc{40%{clip-path:circle(0% at 50% 50%)}80%,100%{clip-path:circle(75% at 50% 50%)}}
  @keyframes trb{40%{filter:blur(8px);opacity:0}80%,100%{filter:none;opacity:1}}
  @keyframes trsp{40%{transform:rotate(-180deg) scale(0)}80%,100%{transform:none}}
  @keyframes trg{40%{opacity:0;transform:translateX(0)}50%{opacity:1;transform:translateX(6px)}60%{transform:translateX(-6px)}70%,100%{opacity:1;transform:none}}
  ${Object.entries(anim).map(([k, v]) => `.tr-${k}>i{${v}}`).join('\n')}`;
  document.head.append(h('style', {}, css));
}

// ---------- Effects ----------
function initEffectsPanel(el) {
  const presetGrid = h('div', { class: 'tile-grid' });
  for (const [k, p] of Object.entries(PRESETS)) {
    const f = [];
    if (p.brightness) f.push(`brightness(${p.brightness}%)`);
    if (p.contrast) f.push(`contrast(${p.contrast}%)`);
    if (p.saturate) f.push(`saturate(${p.saturate}%)`);
    if (p.hue) f.push(`hue-rotate(${p.hue}deg)`);
    if (p.grayscale) f.push(`grayscale(${p.grayscale}%)`);
    if (p.sepia) f.push(`sepia(${p.sepia}%)`);
    if (p.invert) f.push(`invert(${p.invert}%)`);
    presetGrid.append(h('button', {
      class: 'tile',
      onclick: () => {
        const c = requireVisual();
        if (!c) return;
        mutate(() => { c.preset = k; });
        toast(`${p.label} applied`, 'ok');
      },
    }, h('div', { class: 'ico b', style: { filter: f.join(' ') || 'none', background: 'linear-gradient(135deg,#ff7a59,#ffcc4d 45%,#3b9cff)' } }), p.label));
  }
  const motionGrid = h('div', { class: 'tile-grid' });
  for (const [k, label] of Object.entries(MOTIONS)) {
    motionGrid.append(h('button', {
      class: 'tile',
      onclick: () => {
        const c = requireVisual();
        if (!c) return;
        mutate(() => { c.motion = k; });
        toast(`${label} applied`, 'ok');
      },
    }, label));
  }
  el.append(
    h('div', { class: 'panel-title' }, 'Effects'),
    h('div', { class: 'note' }, 'Select a clip, then click a look. Fine-tune brightness, contrast, blur, vignette and more in the right panel.'),
    h('div', { class: 'panel-sub' }, 'Color looks'),
    presetGrid,
    h('div', { class: 'panel-sub' }, 'Motion'),
    motionGrid,
    h('div', { class: 'panel-sub' }, 'Batch'),
    h('button', {
      class: 'btn full',
      onclick: () => {
        const c = requireVisual();
        if (!c) return;
        mutate((p) => p.clips.forEach((x) => { if (isVisual(x)) { x.preset = c.preset; x.fx = { ...c.fx }; } }));
        toast('Look copied to all visual clips', 'ok');
      },
    }, "Copy selected clip's look to all clips")
  );
}
