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
