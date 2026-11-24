// Canvas compositor: syncs <video>/<audio> elements to the timeline clock,
// draws layers with transforms/effects/transitions and renders captions.
import {
  store, clipEnd, prevAdjacent, nextAdjacent, transitionDuration, clamp,
  DEFAULT_TRANSFORM, DEFAULT_TEXT_STYLE,
} from './state.js';
import { effectiveFx, filterString, compositeTransition } from './effects.js';

// ---------- audio graph ----------
// clip gains -> mix -> master (preview volume) -> speakers
//                  \-> dest (MediaStream for export, unaffected by preview volume)
export const audio = { ctx: null, mix: null, master: null, dest: null };
export function ensureAudio() {
  if (!audio.ctx) {
    audio.ctx = new AudioContext();
    audio.mix = audio.ctx.createGain();
    audio.master = audio.ctx.createGain();
    audio.dest = audio.ctx.createMediaStreamDestination();
    audio.mix.connect(audio.master).connect(audio.ctx.destination);
    audio.mix.connect(audio.dest);
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
  return audio;
}
