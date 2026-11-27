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
