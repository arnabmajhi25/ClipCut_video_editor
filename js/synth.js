// Generates royalty-free backing loops offline (WebAudio) and encodes them as WAV,
// so there is always usable music even without Spotify.

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export const LOOPS = {
  lofi: { label: 'Lo-fi chill', bpm: 80, wave: 'triangle', drums: true, chords: [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]] },
  pop: { label: 'Upbeat pop', bpm: 118, wave: 'sawtooth', drums: true, fourFloor: true, chords: [[60, 64, 67], [67, 71, 74], [69, 72, 76], [65, 69, 72]] },
  ambient: { label: 'Ambient pad', bpm: 60, wave: 'sine', drums: false, chords: [[48, 55, 64, 71], [45, 52, 60, 67], [41, 48, 57, 64], [43, 50, 59, 66]] },
  cinematic: { label: 'Cinematic pulse', bpm: 92, wave: 'sawtooth', drums: true, sparse: true, chords: [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 52, 56]] },
};

function toWav(buf) {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const sr = buf.sampleRate;
  const dv = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, len * ch * 2, true);
  const chans = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([dv], { type: 'audio/wav' });
}

export async function synthLoop(kind, seconds = 32) {
  const cfg = LOOPS[kind];
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, sr * seconds, sr);
  const master = ctx.createGain();
  master.gain.value = 0.55;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);

  const noise = ctx.createBuffer(1, sr, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const env = (g, t, a, peak, d) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  const kick = (t) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    env(g, t, 0.005, 0.9, 0.25);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.3);
  };
  const hit = (t, hp, peak, d) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = ctx.createGain();
    env(g, t, 0.002, peak, d);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + d + 0.05);
  };

  const beat = 60 / cfg.bpm;
  const bar = beat * 4;
  for (let t = 0, i = 0; t < seconds; t += bar, i++) {
    const chord = cfg.chords[i % cfg.chords.length];
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cfg.wave === 'sawtooth' ? 1400 : 4000;
    lp.connect(master);
    for (const n of chord) {
      const o = ctx.createOscillator();
      o.type = cfg.wave;
      o.frequency.value = midi(n);
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain();
      const lvl = cfg.wave === 'sine' ? 0.09 : 0.045;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(lvl, t + Math.min(0.4, bar / 4));
      g.gain.setValueAtTime(lvl, t + bar - 0.25);
      g.gain.linearRampToValueAtTime(0, t + bar);
      o.connect(g).connect(lp);
      o.start(t); o.stop(t + bar + 0.05);
    }
    if (!cfg.drums) continue;
    for (let b = 0; b < 4; b++) {
      const bt = t + b * beat;
      if (bt >= seconds) break;
      // bass
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = midi(chord[0] - 12);
      const g = ctx.createGain();
      env(g, bt, 0.01, 0.35, beat * 0.8);
      o.connect(g).connect(master);
      o.start(bt); o.stop(bt + beat);
      if (cfg.fourFloor || b % 2 === 0) kick(bt);
      if (!cfg.sparse && b % 2 === 1) hit(bt, 1200, 0.35, 0.16);
      if (cfg.sparse && b === 3) hit(bt, 900, 0.3, 0.3);
      if (!cfg.sparse) { hit(bt, 7000, 0.1, 0.04); hit(bt + beat / 2, 7000, 0.07, 0.04); }
    }
  }
  const out = await ctx.startRendering();
  return toWav(out);
}
