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

const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

let pixCanvas;
function pixelated(ctx, src, W, H, size) {
  pixCanvas ||= document.createElement('canvas');
  const w = Math.max(1, Math.round(W / size));
  const h = Math.max(1, Math.round(H / size));
  pixCanvas.width = w;
  pixCanvas.height = h;
  const pc = pixCanvas.getContext('2d');
  pc.clearRect(0, 0, w, h);
  pc.drawImage(src, 0, 0, w, h);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pixCanvas, 0, 0, W, H);
  ctx.restore();
}

/**
 * Composite outgoing layer A (may be null) and incoming layer B at progress p ∈ [0,1].
 * Layers are full-frame transparent canvases.
 */
export function compositeTransition(ctx, A, B, type, p, W, H) {
  const e = easeInOut(Math.min(1, Math.max(0, p)));
  const draw = (layer, alpha = 1, fn) => {
    if (!layer) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    fn?.();
    ctx.drawImage(layer, 0, 0, W, H);
    ctx.restore();
  };
  const clipRect = (x, y, w, h) => () => { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); };

  switch (type) {
    case 'fadeblack':
    case 'fadewhite': {
      if (e < 0.5) draw(A, 1); else draw(B, 1);
      const a = e < 0.5 ? e * 2 : 2 - e * 2;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = type === 'fadeblack' ? '#000' : '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      break;
    }
    case 'wipeleft': draw(A); draw(B, 1, clipRect(W * (1 - e), 0, W * e + 1, H)); break;
    case 'wiperight': draw(A); draw(B, 1, clipRect(0, 0, W * e, H)); break;
    case 'wipeup': draw(A); draw(B, 1, clipRect(0, H * (1 - e), W, H * e + 1)); break;
    case 'wipedown': draw(A); draw(B, 1, clipRect(0, 0, W, H * e)); break;
    case 'slideleft': draw(A, 1, () => ctx.translate(-W * e, 0)); draw(B, 1, () => ctx.translate(W * (1 - e), 0)); break;
    case 'slideright': draw(A, 1, () => ctx.translate(W * e, 0)); draw(B, 1, () => ctx.translate(-W * (1 - e), 0)); break;
    case 'slideup': draw(A, 1, () => ctx.translate(0, -H * e)); draw(B, 1, () => ctx.translate(0, H * (1 - e))); break;
    case 'slidedown': draw(A, 1, () => ctx.translate(0, H * e)); draw(B, 1, () => ctx.translate(0, -H * (1 - e))); break;
    case 'zoomin': {
      draw(A, 1 - e, () => { ctx.translate(W / 2, H / 2); ctx.scale(1 + e * 0.6, 1 + e * 0.6); ctx.translate(-W / 2, -H / 2); });
      const s = 0.6 + 0.4 * e;
      draw(B, e, () => { ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2); });
      break;
    }
    case 'zoomout': {
      const s = 1 - 0.5 * e;
      draw(B, e);
      draw(A, 1 - e, () => { ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2); });
      break;
    }
    case 'circle': {
      draw(A);
      const r = (e * Math.hypot(W, H)) / 2;
      draw(B, 1, () => { ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.max(0.1, r), 0, Math.PI * 2); ctx.clip(); });
      break;
    }
    case 'blur': {
      const k = Math.min(W, H) / 1080;
      draw(A, 1 - e, () => { ctx.filter = `blur(${e * 24 * k}px)`; });
      draw(B, e, () => { ctx.filter = `blur(${(1 - e) * 24 * k}px)`; });
      break;
    }
    case 'spin': {
      draw(A);
      draw(B, e, () => {
        ctx.translate(W / 2, H / 2);
        ctx.rotate((1 - e) * -Math.PI);
        ctx.scale(e, e);
        ctx.translate(-W / 2, -H / 2);
      });
      break;
    }
    case 'pixelate': {
      const size = 1 + Math.round(Math.sin(p * Math.PI) * 48 * (Math.min(W, H) / 1080));
      const src = p < 0.5 ? A : B;
      if (src) pixelated(ctx, src, W, H, size);
      break;
    }
    case 'glitch': {
      const src = p < 0.5 ? A : B;
      if (!src) break;
      const amp = Math.sin(p * Math.PI);
      ctx.drawImage(src, 0, 0, W, H);
      const slices = 14;
      const sh = H / slices;
      const seed = Math.floor(p * 40);
      for (let i = 0; i < slices; i++) {
        const r = Math.sin((i + 1) * 999 + seed * 77) * 0.5 + 0.5;
        if (r < 0.45) continue;
        const dx = (r - 0.5) * W * 0.25 * amp * (i % 2 ? 1 : -1);
        ctx.drawImage(src, 0, i * sh, W, sh, dx, i * sh, W, sh);
      }
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.35 * amp;
      ctx.drawImage(src, 12 * amp, 0, W, H);
      ctx.restore();
      break;
    }
    case 'fade':
    default:
      draw(A, 1);
      draw(B, e);
  }
}
