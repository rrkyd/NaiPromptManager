import { normalizeArtistName } from './parseArtists';
import { EPS, fmtStrength } from './strength';

/**
 * Mirrors Python `_compose_artist_prefix`.
 */
export function composeArtistPrefix(
  artists: string[],
  strengthMap: Map<string, number>,
  nonArtistBlock: string
): string {
  const grouped = new Map<number, string[]>();
  const plain: string[] = [];

  for (const artist of artists) {
    const token = `artist:${artist}`;
    const strength = strengthMap.get(normalizeArtistName(artist)) ?? 1;
    if (Math.abs(strength - 1) <= EPS) {
      plain.push(token);
    } else {
      const s = parseFloat(fmtStrength(strength));
      if (!grouped.has(s)) grouped.set(s, []);
      grouped.get(s)!.push(token);
    }
  }

  const parts: string[] = [];
  const strengths = [...grouped.keys()].sort((a, b) => b - a);
  for (const strength of strengths) {
    const tokens = grouped.get(strength)!;
    parts.push(`${fmtStrength(strength)}::${tokens.join(', ')}::`);
  }
  parts.push(...plain);
  const block = nonArtistBlock.trim();
  if (block) parts.push(block);
  return parts.join(', ');
}

export function buildFullPrompt(artistPrefix: string, basePositive: string): string {
  const a = artistPrefix.trim();
  const b = basePositive.trim();
  if (!a && !b) return '';
  if (!a) return b;
  if (!b) return a;
  return `${a}, ${b}`.replace(/^,+\s*|,+\s*$/g, '').trim();
}
