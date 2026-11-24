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
