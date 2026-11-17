/* Material You dynamic color from a seed hex, in OKLCH space.
   Produces tonal palettes (0..100) and a light/dark M3 color scheme. */
(function (global) {
  'use strict';

  /* ---------- sRGB <-> OKLab / OKLCH ---------- */
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const clamp01 = (x) => Math.min(1, Math.max(0, x));

  function hexToRgb(hex) {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 103, g: 80, b: 164 };
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  const rgbToHex = (r, g, b) =>
    '#' + [r, g, b].map((v) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

  function rgbToOklab({ r, g, b }) {
    const lr = toLin(r / 255), lg = toLin(g / 255), lb = toLin(b / 255);
    const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
    const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    return {
      L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
      a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
      b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
    };
  }

  function oklabToRgb({ L, a, b }) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    return { r: clamp01(toSrgb(r)) * 255, g: clamp01(toSrgb(g)) * 255, b: clamp01(toSrgb(bl)) * 255 };
  }

  function labToLch({ L, a, b }) {
    return { L, C: Math.hypot(a, b), h: (Math.atan2(b, a) * 180) / Math.PI };
  }
  function lchToLab({ L, C, h }) {
    const rad = (h * Math.PI) / 180;
    return { L, a: Math.cos(rad) * C, b: Math.sin(rad) * C };
  }

  /* Convert seed to LCH, remembering native chroma so we can scale it. */
  function seedLch(hex) {
    const lab = rgbToOklab(hexToRgb(hex));
    const lch = labToLch(lab);
    return { L: lch.L, C: lch.C, h: (lch.h + 360) % 360 };
  }

  /* Tone = perceptual lightness target (0..100), M3-style. */
  /* Tone = CIELAB L* (0..100), like M3 tonal palettes.
     OKLab L is ~= cbrt(Y), so convert L* -> Y -> OKLab L. */
  function toneToOklabL(tone) {
    const lstar = Math.min(100, Math.max(0, tone));
    const Y = lstar <= 8 ? lstar / 903.2962962 : Math.pow((lstar + 16) / 116, 3);
    return Math.cbrt(Y);
  }

  const toneCache = new Map();

  function toneColor(h, c, tone) {
    if (tone <= 0) return '#000000';
    if (tone >= 100) return '#FFFFFF';
    const key = h.toFixed(3) + '|' + c.toFixed(4) + '|' + tone;
    const hit = toneCache.get(key);
    if (hit) return hit;
    // To make tonal ramps behave, we search chroma that keeps the target L
    // while staying inside sRGB.
    const L = toneToOklabL(tone);
    let lo = 0, hi = c, best = null;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      const rgb = oklabToRgb(lchToLab({ L, C: mid, h }));
      // chroma is representable if clamping barely moved the color
      const lab2 = rgbToOklab(rgb);
      const lch2 = labToLch(lab2);
      const ok = Math.abs(lch2.L - L) < 0.012 && Math.abs(lch2.C - mid) < 0.008;
      if (ok) { best = rgb; lo = mid; } else { hi = mid; }
    }
    if (!best) best = oklabToRgb(lchToLab({ L, C: 0, h }));
    const hex = rgbToHex(best.r, best.g, best.b);
    toneCache.set(key, hex);
    return hex;
  }

  function tonalPalette(h, cMax) {
    const out = {};
    [0, 4, 5, 6, 10, 12, 15, 17, 20, 22, 24, 25, 30, 35, 40, 45, 50, 60, 70, 80, 87, 90, 92, 94, 95, 96, 98, 99, 100].forEach((t) => {
      out[t] = toneColor(h, cMax, t);
    });
    return out;
  }

  /* Neutral palettes: slight chroma, with the warm/cool tilt M3 uses. */
  function build(seedHex) {
    const s = seedLch(seedHex);
    const h = s.h;
    // Boost dull seeds so they still feel "Material You"
    const c = Math.max(s.C, 0.085);
    const primary = tonalPalette(h, Math.min(c * 1.28, 0.33));
    const secondary = tonalPalette((h + 18) % 360, Math.min(c * 0.48, 0.14));
    const tertiary = tonalPalette((h + 62) % 360, Math.min(c * 0.86, 0.22));
    const neutral = tonalPalette(h, 0.011);
    const neutralVariant = tonalPalette(h, Math.max(0.03, Math.min(c * 0.3, 0.055)));
    const error = tonalPalette(25, 0.205);
    return { seed: seedHex.toUpperCase(), h, primary, secondary, tertiary, neutral, neutralVariant, error };
  }

  /* ---- M3 scheme tokens ---- */
  function schemeFromPalettes(p, dark) {
    const t = (pal, tone) => pal[tone];
    const sc = dark
      ? {
          primary: t(p.primary, 80), onPrimary: t(p.primary, 20), primaryContainer: t(p.primary, 30), onPrimaryContainer: t(p.primary, 90),
          secondary: t(p.secondary, 80), onSecondary: t(p.secondary, 20), secondaryContainer: t(p.secondary, 30), onSecondaryContainer: t(p.secondary, 90),
          tertiary: t(p.tertiary, 80), onTertiary: t(p.tertiary, 20), tertiaryContainer: t(p.tertiary, 30), onTertiaryContainer: t(p.tertiary, 90),
          error: t(p.error, 80), onError: t(p.error, 20), errorContainer: t(p.error, 30), onErrorContainer: t(p.error, 90),
          surface: t(p.neutral, 6), surfaceDim: t(p.neutral, 6), surfaceBright: t(p.neutral, 24),
          surfaceContainerLowest: t(p.neutral, 4), surfaceContainerLow: t(p.neutral, 10), surfaceContainer: t(p.neutral, 12),
          surfaceContainerHigh: t(p.neutral, 17), surfaceContainerHighest: t(p.neutral, 22),
          onSurface: t(p.neutral, 90), onSurfaceVariant: t(p.neutralVariant, 80),
          outline: t(p.neutralVariant, 60), outlineVariant: t(p.neutralVariant, 30),
          inverseSurface: t(p.neutral, 90), inverseOnSurface: t(p.neutral, 20), inversePrimary: t(p.primary, 40),
          scrim: '#000000', shadow: '#000000',
        }
      : {
          primary: t(p.primary, 40), onPrimary: t(p.primary, 100), primaryContainer: t(p.primary, 90), onPrimaryContainer: t(p.primary, 10),
          secondary: t(p.secondary, 40), onSecondary: t(p.secondary, 100), secondaryContainer: t(p.secondary, 90), onSecondaryContainer: t(p.secondary, 10),
          tertiary: t(p.tertiary, 40), onTertiary: t(p.tertiary, 100), tertiaryContainer: t(p.tertiary, 90), onTertiaryContainer: t(p.tertiary, 10),
          error: t(p.error, 40), onError: t(p.error, 100), errorContainer: t(p.error, 90), onErrorContainer: t(p.error, 10),
          surface: t(p.neutral, 98), surfaceDim: t(p.neutral, 87), surfaceBright: t(p.neutral, 98),
          surfaceContainerLowest: '#FFFFFF', surfaceContainerLow: t(p.neutral, 96), surfaceContainer: t(p.neutral, 94),
          surfaceContainerHigh: t(p.neutral, 92), surfaceContainerHighest: t(p.neutral, 90),
          onSurface: t(p.neutral, 10), onSurfaceVariant: t(p.neutralVariant, 30),
          outline: t(p.neutralVariant, 50), outlineVariant: t(p.neutralVariant, 80),
          inverseSurface: t(p.neutral, 20), inverseOnSurface: t(p.neutral, 95), inversePrimary: t(p.primary, 80),
          scrim: '#000000', shadow: '#000000',
        };
    sc.primaryFixed = t(p.primary, 90); sc.primaryFixedDim = t(p.primary, 80);
    sc.primaryFixedSoft = mixHex(t(p.primary, 90), t(p.primary, 80), 0.35);
    sc.secondaryFixed = t(p.secondary, 90);
    sc.tertiaryFixed = t(p.tertiary, 90);
    return sc;
  }

  function mixHex(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
  }

  function scheme(seedHex, dark) {
    return schemeFromPalettes(build(seedHex), !!dark);
  }

  const Palette = { scheme, build, mixHex, rgbToHex, seedLch, hexToRgb };
  global.Palette = Palette;
})(typeof globalThis !== 'undefined' ? globalThis : this);
