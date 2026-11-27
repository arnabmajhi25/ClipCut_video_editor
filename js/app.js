// Entry point: wires playback, top bar, shortcuts, autosave and all panels together.
import {
  store, on, emit, mutate, undo, redo, canUndo, canRedo, setTime, setProject, newProject,
  projectDuration, formatTime, clamp, select, deleteClip, duplicateClip, ASPECTS, getClip,
} from './state.js';
import { Renderer, ensureAudio, audio } from './renderer.js';
import { initTimeline, addMediaToTimeline, addTextAtPlayhead, splitSelected, zoomToFit } from './timeline.js';
import { initInspector } from './inspector.js';
import { initPanels } from './panels.js';
import { initMusicPanel, handleSpotifyRedirect, renderMusicPanel } from './spotify.js';
import { importFiles, restoreMedia } from './media.js';
import { openExportDialog } from './export.js';
import { $, h, toast, openModal, closeModal, confirmDialog } from './ui.js';
import * as db from './db.js';

const canvas = $('#preview');
const renderer = new Renderer(canvas);
let previewScale = +(localStorage.getItem('cf_preview_scale') || 0.5);
let readyRetries = 0;

function applyPreviewSize() {
  const { width, height } = store.project;
  const s = store.exporting ? 1 : previewScale;
  renderer.resize(Math.round(width * s), Math.round(height * s));
}

// ---------- playback ----------
let clockStart = 0;
let clockT0 = 0;
const player = {
  onEnd: null,
  onPause: null,
  play() {
    if (store.playing) return;
    ensureAudio();
    const end = projectDuration();
    if (end <= 0) return;
    if (store.time >= end - 0.02) setTime(0);
    store.playing = true;
    clockStart = performance.now();
    clockT0 = store.time;
    renderer.sync(store.time, true);
    updatePlayBtn();
  },
  pause() {
    if (!store.playing) return;
    store.playing = false;
    renderer.pauseAll();
    renderer.dirty = true;
    updatePlayBtn();
    this.onPause?.();
  },
  toggle() { store.playing ? this.pause() : this.play(); },
  seek(t) {
    setTime(clamp(t, 0, Math.max(0, projectDuration())));
    clockStart = performance.now();
    clockT0 = store.time;
    renderer.dirty = true;
  },
};

function loop(now) {
  if (store.playing) {
    const end = projectDuration();
    const t = clockT0 + (now - clockStart) / 1000;
    if (t >= end) {
      setTime(end);
      renderer.sync(end, false);
      renderer.render(Math.max(0, end - 0.001));
      player.pause();
      player.onEnd?.();
    } else {
      setTime(t);
      renderer.sync(t, true);
      renderer.render(t);
    }
  } else if (renderer.dirty) {
    renderer.sync(store.time, false);
    // Avoid black flashes while a seek is in flight: wait (briefly) for decoded frames.
    if (renderer.framesReady(store.time) || ++readyRetries > 45) {
      renderer.render(store.time);
      renderer.dirty = false;
      readyRetries = 0;
    }
  }
  requestAnimationFrame(loop);
}

function updatePlayBtn() {
  $('#playBtn').textContent = store.playing ? '❚❚' : '▶';
}

function updateTimes() {
  $('#curTime').textContent = formatTime(store.time);
  $('#totTime').textContent = formatTime(projectDuration());
}
