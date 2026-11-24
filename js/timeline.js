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
