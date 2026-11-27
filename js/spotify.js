// Music panel: Spotify Web API search (Authorization Code + PKCE, no server secret needed),
// local audio upload, and generated royalty-free loops.
import { store } from './state.js';
import { h, toast, pickFiles } from './ui.js';
import { importBlob } from './media.js';
import { addMediaToTimeline } from './timeline.js';
import { LOOPS, synthLoop } from './synth.js';

const LS_CLIENT = 'cf_spotify_client_id';
const LS_TOKEN = 'cf_spotify_token';
const LS_VERIFIER = 'cf_spotify_verifier';
const API = 'https://api.spotify.com/v1';

export const redirectUri = () => location.origin + location.pathname;
const getClientId = () => localStorage.getItem(LS_CLIENT) || '';
const getToken = () => { try { return JSON.parse(localStorage.getItem(LS_TOKEN)); } catch { return null; } };
const setToken = (t) => (t ? localStorage.setItem(LS_TOKEN, JSON.stringify(t)) : localStorage.removeItem(LS_TOKEN));

let beforeRedirect = async () => {};
let panel;
let previewAudio;

// ---------- auth ----------
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function randomString(n) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return [...crypto.getRandomValues(new Uint8Array(n))].map((x) => chars[x % chars.length]).join('');
}

async function login() {
  const clientId = getClientId();
  if (!clientId) return toast('Enter your Spotify Client ID first', 'error');
  const verifier = randomString(64);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  localStorage.setItem(LS_VERIFIER, verifier);
  await beforeRedirect();
  const params = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri(),
    code_challenge_method: 'S256', code_challenge: challenge,
  });
  location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Spotify token request failed');
  const prev = getToken();
  const tok = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || prev?.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  };
  setToken(tok);
  return tok;
}

/** Call once on startup: completes the login if we just came back from Spotify. */
export async function handleSpotifyRedirect() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return;
  history.replaceState({}, '', redirectUri());
  if (error) return toast(`Spotify login cancelled (${error})`, 'error');
  try {
    await tokenRequest({
      client_id: getClientId(), grant_type: 'authorization_code', code,
      redirect_uri: redirectUri(), code_verifier: localStorage.getItem(LS_VERIFIER) || '',
    });
    toast('Connected to Spotify', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    localStorage.removeItem(LS_VERIFIER);
  }
}

async function accessToken() {
  let t = getToken();
  if (!t) return null;
  if (Date.now() > t.expires_at) {
    if (!t.refresh_token) { setToken(null); return null; }
    try { t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: getClientId() }); }
    catch { setToken(null); return null; }
  }
  return t.access_token;
}

async function api(path) {
  const tok = await accessToken();
  if (!tok) { renderPanel(); throw new Error('Please connect Spotify again'); }
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${tok}` } });
  if (res.status === 401) { setToken(null); renderPanel(); throw new Error('Spotify session expired — reconnect'); }
  if (res.status === 429) throw new Error('Spotify rate limit hit — wait a moment');
  if (!res.ok) throw new Error(`Spotify error ${res.status}`);
  return res.json();
}

// ---------- adding audio ----------
async function addSpotifyPreview(track, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await fetch(track.preview_url);
    if (!res.ok) throw new Error('Preview download failed');
    const blob = await res.blob();
    const media = await importBlob(new Blob([blob], { type: 'audio/mpeg' }), `${track.name} – ${artists(track)} (preview).mp3`, { source: sourceOf(track) });
    addMediaToTimeline(media, 'A1', store.time);
    toast('30s preview added to the Music track', 'ok');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '+ Add';
  }
}

async function attachLocalFile(track) {
  const [f] = await pickFiles('audio/*', false);
  if (!f) return;
  try {
    const media = await importBlob(f, `${track.name} – ${artists(track)}`, { source: sourceOf(track) });
    addMediaToTimeline(media, 'A1', store.time);
    toast('Song added to the Music track', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

const artists = (t) => t.artists.map((a) => a.name).join(', ');
const sourceOf = (t) => ({ kind: 'spotify', id: t.id, title: t.name, artist: artists(t), url: t.external_urls?.spotify });

function togglePreview(url, btn) {
  if (previewAudio && previewAudio.src === url && !previewAudio.paused) {
    previewAudio.pause();
    btn.textContent = '▶';
    return;
  }
  previewAudio?.pause();
  panel.querySelectorAll('.pv-btn').forEach((b) => { b.textContent = '▶'; });
  previewAudio = new Audio(url);
  previewAudio.play().catch(() => toast('Could not play preview', 'error'));
  previewAudio.onended = () => { btn.textContent = '▶'; };
  btn.textContent = '❚❚';
}

function trackRow(t) {
  const img = t.album?.images?.at(-1)?.url;
  const dur = `${Math.floor(t.duration_ms / 60000)}:${String(Math.floor(t.duration_ms / 1000) % 60).padStart(2, '0')}`;
  const btns = h('div', { class: 'btns' });
  if (t.preview_url) {
    const pv = h('button', { class: 'icon-btn pv-btn', title: 'Listen to preview' }, '▶');
    pv.onclick = () => togglePreview(t.preview_url, pv);
    const add = h('button', { class: 'icon-btn btn accent', title: 'Add 30-second preview to timeline' }, '+ Add');
    add.onclick = () => addSpotifyPreview(t, add);
    btns.append(pv, add);
  } else {
    btns.append(h('button', { class: 'icon-btn', title: 'Spotify provides no audio for this track — attach your own copy of the song', onclick: () => attachLocalFile(t) }, '📎 File'));
  }
  if (t.external_urls?.spotify) btns.append(h('a', { class: 'icon-btn', href: t.external_urls.spotify, target: '_blank', rel: 'noopener', title: 'Open in Spotify', style: { textDecoration: 'none' } }, '↗'));
  return h('div', { class: 'track-result' },
    img ? h('img', { src: img, alt: '' }) : h('div', { class: 'thumb' }),
    h('div', { style: { minWidth: 0 } }, h('div', { class: 't', title: t.name }, t.name), h('div', { class: 'a' }, `${artists(t)} · ${dur}`)),
    btns);
}
