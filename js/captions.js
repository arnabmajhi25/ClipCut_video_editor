// SRT / VTT import & export and transcript → timed captions.
import { store, makeTextClip, mutate, select } from './state.js';

function parseTimestamp(s) {
  const m = s.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/);
  if (!m) return NaN;
  return (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + +`0.${m[4]}`;
}

/** Parses SRT or WebVTT text into [{start, end, text}]. */
export function parseSubtitles(src) {
  const out = [];
  const blocks = src.replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    const start = parseTimestamp(a);
    const end = parseTimestamp(z);
    const text = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (isFinite(start) && isFinite(end) && end > start && text) out.push({ start, end, text });
  }
  return out;
}

const pad = (n, l = 2) => String(n).padStart(l, '0');
function srtTime(t) {
  const ms = Math.round(t * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function exportSRT() {
  const caps = store.project.clips.filter((c) => c.type === 'text').sort((a, b) => a.start - b.start);
  return caps.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.start + c.duration)}\n${c.text}\n`).join('\n');
}
