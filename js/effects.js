// Catalogue of filter presets, motions, transitions and text animations,
// plus the transition compositor used by the renderer.

export const PRESETS = {
  none: { label: 'Original' },
  vivid: { label: 'Vivid', saturate: 160, contrast: 110 },
  bw: { label: 'B&W', grayscale: 100, contrast: 115 },
  noir: { label: 'Noir', grayscale: 100, contrast: 160, brightness: 85, vignette: 60 },
  vintage: { label: 'Vintage', sepia: 45, contrast: 90, saturate: 80, brightness: 105, vignette: 40 },
  cinematic: { label: 'Cinematic', contrast: 120, saturate: 85, brightness: 95, vignette: 35, tint: 'rgba(0,90,130,0.18)' },
  warm: { label: 'Warm', saturate: 120, sepia: 15, tint: 'rgba(255,140,0,0.14)' },
  cool: { label: 'Cool', saturate: 95, tint: 'rgba(0,120,255,0.16)' },
  dramatic: { label: 'Dramatic', contrast: 145, saturate: 70, brightness: 90, vignette: 50 },
  faded: { label: 'Faded', contrast: 78, brightness: 112, saturate: 75 },
  dreamy: { label: 'Dreamy', blur: 1.5, brightness: 110, saturate: 125, tint: 'rgba(255,170,220,0.14)' },
  retro: { label: 'Retro', sepia: 30, hue: -15, saturate: 140, contrast: 105, vignette: 30 },
  matrix: { label: 'Matrix', hue: 80, saturate: 150, contrast: 120, tint: 'rgba(0,255,80,0.12)' },
  negative: { label: 'Negative', invert: 100 },
};

export const MOTIONS = {
  none: 'None',
  'zoom-in': 'Ken Burns zoom in',
  'zoom-out': 'Ken Burns zoom out',
  'pan-left': 'Pan left',
  'pan-right': 'Pan right',
  pulse: 'Pulse',
  shake: 'Camera shake',
  spin: 'Slow spin',
};

export const TRANSITIONS = {
  none: 'None',
  fade: 'Cross dissolve',
  fadeblack: 'Dip to black',
  fadewhite: 'Flash white',
  wipeleft: 'Wipe left',
  wiperight: 'Wipe right',
  wipeup: 'Wipe up',
  wipedown: 'Wipe down',
  slideleft: 'Slide left',
  slideright: 'Slide right',
  slideup: 'Slide up',
  slidedown: 'Slide down',
  zoomin: 'Zoom in',
  zoomout: 'Zoom out',
  circle: 'Circle reveal',
  blur: 'Blur dissolve',
  spin: 'Spin in',
  pixelate: 'Pixelate',
  glitch: 'Glitch',
};

export const TEXT_ANIMS = {
  none: 'None',
  fade: 'Fade',
  pop: 'Pop',
  slide: 'Slide up',
  typewriter: 'Typewriter',
  highlight: 'Word highlight (karaoke)',
  wordpop: 'Word by word',
};

/** Merge user sliders with the selected preset into effective values. */
export function effectiveFx(clip) {
  const fx = clip.fx || {};
  const p = PRESETS[clip.preset] || {};
  const mul = (k) => ((fx[k] ?? 100) * (p[k] ?? 100)) / 100;
  return {
    brightness: mul('brightness'),
    contrast: mul('contrast'),
    saturate: mul('saturate'),
    hue: (fx.hue || 0) + (p.hue || 0),
    blur: (fx.blur || 0) + (p.blur || 0),
    grayscale: Math.max(fx.grayscale || 0, p.grayscale || 0),
    sepia: Math.max(fx.sepia || 0, p.sepia || 0),
    invert: Math.max(fx.invert || 0, p.invert || 0),
    vignette: Math.max(fx.vignette || 0, p.vignette || 0),
    tint: p.tint || null,
  };
}

export function filterString(e, scale = 1) {
  const parts = [];
  if (e.brightness !== 100) parts.push(`brightness(${e.brightness}%)`);
  if (e.contrast !== 100) parts.push(`contrast(${e.contrast}%)`);
  if (e.saturate !== 100) parts.push(`saturate(${e.saturate}%)`);
  if (e.hue) parts.push(`hue-rotate(${e.hue}deg)`);
  if (e.grayscale) parts.push(`grayscale(${e.grayscale}%)`);
  if (e.sepia) parts.push(`sepia(${e.sepia}%)`);
  if (e.invert) parts.push(`invert(${e.invert}%)`);
  if (e.blur) parts.push(`blur(${(e.blur * scale).toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

