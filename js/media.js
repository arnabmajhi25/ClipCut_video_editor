// Media import, probing, thumbnails and waveform peaks.
import { store, uid, emit } from './state.js';
import * as db from './db.js';

const EXT = {
  video: ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'weba'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'],
};

function detectType(blob, name) {
  const t = blob.type || '';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('image/')) return 'image';
  const ext = (name.split('.').pop() || '').toLowerCase();
  return Object.keys(EXT).find((k) => EXT[k].includes(ext)) || null;
}

const once = (el, ev) => new Promise((res, rej) => {
  const ok = () => { cleanup(); res(); };
  const bad = () => { cleanup(); rej(new Error('Could not decode media')); };
  const cleanup = () => { el.removeEventListener(ev, ok); el.removeEventListener('error', bad); };
  el.addEventListener(ev, ok);
  el.addEventListener('error', bad);
});

async function probe(media) {
  if (media.type === 'image') {
    const img = new Image();
    img.src = media.url;
    await img.decode();
    media.img = img;
    media.width = img.naturalWidth || 1920;
    media.height = img.naturalHeight || 1080;
    media.duration = 0;
    return;
  }
  const el = document.createElement(media.type === 'audio' ? 'audio' : 'video');
  el.preload = 'metadata';
  el.muted = true;
  el.src = media.url;
  await once(el, 'loadedmetadata');
  // MediaRecorder WebM files report Infinity until you seek far ahead.
  if (!isFinite(el.duration)) {
    el.currentTime = 1e9;
    await once(el, 'durationchange').catch(() => {});
  }
  media.duration = isFinite(el.duration) ? el.duration : 10;
  media.width = el.videoWidth || 0;
  media.height = el.videoHeight || 0;
  el.removeAttribute('src');
  el.load();
}

async function makeThumbs(media, count = 12) {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = media.url;
  await once(v, 'loadeddata');
  const h = 64;
  const w = Math.max(40, Math.round(h * ((media.width / media.height) || 16 / 9)));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const thumbs = [];
  for (let i = 0; i < count; i++) {
    v.currentTime = Math.min(media.duration - 0.05, ((i + 0.5) * media.duration) / count);
    await once(v, 'seeked');
    ctx.drawImage(v, 0, 0, w, h);
    thumbs.push(c.toDataURL('image/jpeg', 0.6));
    if (i === 0) { media.poster = thumbs[0]; emit('media'); }
  }
  media.thumbs = thumbs;
  media.thumbW = w;
  v.removeAttribute('src');
  v.load();
}

const PEAKS_PER_SEC = 50;
async function makePeaks(media) {
  if (media.blob.size > 400e6) return; // skip giant files to protect memory
  const buf = await media.blob.arrayBuffer();
  const ac = new OfflineAudioContext(1, 1, 44100);
  let audio;
  try { audio = await ac.decodeAudioData(buf); } catch { media.hasAudio = false; return; }
  const ch = audio.getChannelData(0);
  const n = Math.max(1, Math.ceil(audio.duration * PEAKS_PER_SEC));
  const step = Math.max(1, Math.floor(ch.length / n));
  const peaks = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    const s = i * step;
    for (let j = s; j < s + step && j < ch.length; j += 4) { const a = Math.abs(ch[j]); if (a > m) m = a; }
    peaks[i] = m;
    if (m > max) max = m;
  }
  if (max > 0) for (let i = 0; i < n; i++) peaks[i] /= max;
  media.peaks = peaks;
  media.peaksPerSec = PEAKS_PER_SEC;
  media.hasAudio = true;
}

function generateExtras(media) {
  const jobs = [];
  if (media.type === 'video') jobs.push(makeThumbs(media).catch(() => {}));
  if (media.type === 'image') media.poster = media.url;
  if (media.type !== 'image') jobs.push(makePeaks(media).catch(() => {}));
  Promise.all(jobs).then(() => emit('media'));
}

/** Import a Blob/File into the media library. */
export async function importBlob(blob, name, extra = {}) {
  const type = detectType(blob, name);
  if (!type) throw new Error(`Unsupported file type: ${name}`);
  const media = {
    id: extra.id || uid('m'), name, type, blob, url: URL.createObjectURL(blob),
    duration: 0, width: 0, height: 0, thumbs: [], peaks: null, source: extra.source || null,
  };
  await probe(media);
  store.media.set(media.id, media);
  if (!extra.skipSave) db.putMedia(media).catch((e) => console.warn('Could not persist media', e));
  emit('media');
  generateExtras(media);
  return media;
}

export async function importFiles(files, onError) {
  const out = [];
  for (const f of files) {
    try { out.push(await importBlob(f, f.name)); }
    catch (e) { onError?.(e); }
  }
  return out;
}

/** Re-create media records saved in IndexedDB. */
export async function restoreMedia() {
  const records = await db.allMedia();
  for (const r of records) {
    try { await importBlob(r.blob, r.name, { id: r.id, source: r.source, skipSave: true }); }
    catch (e) { console.warn('Failed to restore', r.name, e); }
  }
}

export async function removeMedia(id) {
  const m = store.media.get(id);
  if (!m) return;
  URL.revokeObjectURL(m.url);
  store.media.delete(id);
  await db.deleteMedia(id).catch(() => {});
  emit('media');
}
