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
