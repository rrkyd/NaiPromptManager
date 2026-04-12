import { normalizeArtistName } from './parseArtists';

export const EPS = 1e-6;

const ARTIST_PREFIX_STRIP = /^(artist|aritst)\s*:\s*/i;

/** Deterministic stand-in for Python `hash((...)) % 1000` (JS `%` differs for negatives). */
export function stableHash1000(parts: (string | number)[]): number {
  const s = parts.map((p) => String(p)).join('\x1e');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = h >>> 0;
  return u % 1000;
}

export function fmtStrength(x: number): string {
  return x
    .toFixed(2)
    .replace(/\.?0+$/, '')
    .replace(/\.$/, '');
}

/** Mirrors Python `_parse_fixed_strengths` — keys are `normalizeArtistName(artist)`. */
export function parseFixedStrengths(text: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!text) return out;
  for (const raw of text.split(',')) {
    const pair = raw.trim();
    if (!pair || !pair.includes('=')) continue;
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const rawStrength = pair.slice(eq + 1).trim();
    const artist = name.replace(ARTIST_PREFIX_STRIP, '').trim();
    const key = normalizeArtistName(artist);
    const v = parseFloat(rawStrength);
    if (!Number.isFinite(v)) continue;
    out.set(key, v);
  }
  return out;
}

export type BatchStrengthMode =
  | 'Equal'
  | 'Fixed Some'
  | 'Full Random'
  | 'Iterate'
  | 'Single';

/**
 * Mirrors Python `_build_strength_map`.
 * Random modes use `stableHash1000` instead of Python `hash()` for cross-run stability.
 */
export function buildStrengthMap(
  mode: string,
  artists: string[],
  fixedMap: Map<string, number>,
  randMin: number,
  randMax: number,
  iterMin: number,
  iterMax: number,
  iterStep: number,
  iterBase: number,
  idx: number,
  singleStrength: number
): Map<string, number> {
  const artistsSorted = [...artists].sort((a, b) =>
    normalizeArtistName(a).localeCompare(normalizeArtistName(b))
  );
  const values = new Map<string, number>();
  for (const a of artistsSorted) {
    values.set(normalizeArtistName(a), 1);
  }

  const lowMode = mode.toLowerCase();

  if (lowMode === 'equal') {
    return values;
  }

  if (lowMode === 'fixed some') {
    for (const artist of artistsSorted) {
      const key = normalizeArtistName(artist);
      if (fixedMap.has(key)) {
        values.set(key, fixedMap.get(key)!);
      }
    }
    const caps = [...values.entries()]
      .filter(([k]) => fixedMap.has(k))
      .map(([, v]) => v);
    let cap = caps.length ? Math.min(...caps) : randMax;
    cap = Math.min(cap, randMax);
    for (const artist of artistsSorted) {
      const key = normalizeArtistName(artist);
      if (!fixedMap.has(key)) {
        const t = stableHash1000([artist, idx]) / 1000;
        let v = round2(randMin + (randMax - randMin) * t);
        v = Math.min(v, cap);
        values.set(key, v);
      }
    }
    return values;
  }

  if (lowMode === 'full random') {
    for (const artist of artistsSorted) {
      const key = normalizeArtistName(artist);
      const t = stableHash1000([artist, idx, 'r']) / 1000;
      values.set(key, round2(randMin + (randMax - randMin) * t));
    }
    return values;
  }

  if (lowMode === 'iterate') {
    if (!artistsSorted.length) return values;
    const step = Math.max(0.2, iterStep);
    const levels: number[] = [iterMin];
    while (levels[levels.length - 1]! + step < iterMax + EPS) {
      levels.push(round2(levels[levels.length - 1]! + step));
    }
    if (Math.abs(levels[levels.length - 1]! - iterMax) > EPS) {
      levels.push(round2(iterMax));
    }
    const artistIdx = Math.floor(idx / levels.length) % artistsSorted.length;
    const levelIdx = idx % levels.length;
    const active = artistsSorted[artistIdx]!;
    for (const artist of artistsSorted) {
      values.set(normalizeArtistName(artist), iterBase);
    }
    values.set(normalizeArtistName(active), levels[levelIdx]!);
    return values;
  }

  if (lowMode === 'single') {
    for (const artist of artistsSorted) {
      values.set(normalizeArtistName(artist), singleStrength);
    }
    return values;
  }

  return values;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
