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
