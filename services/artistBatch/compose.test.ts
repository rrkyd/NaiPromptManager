import { describe, it, expect } from 'vitest';
import { composeArtistPrefix, buildFullPrompt } from './compose';
import { buildStrengthMap } from './strength';

describe('buildFullPrompt', () => {
  it('joins prefix and base positive like Python', () => {
    const full = buildFullPrompt('artist:a', 'sunset');
    expect(full).toBe('artist:a, sunset');
  });
});

describe('composeArtistPrefix', () => {
  it('groups weighted tokens', () => {
    const sm = buildStrengthMap(
      'Single',
      ['a', 'b'],
      new Map(),
      0.4,
      1.2,
      1,
      2,
      0.2,
      1,
      0,
      1.5
    );
    const p = composeArtistPrefix(['a', 'b'], sm, '');
    expect(p).toContain('1.5::');
    expect(p).toContain('artist:a');
    expect(p).toContain('artist:b');
  });

  it('appends non-artist block', () => {
    const sm = new Map<string, number>([['x', 1]]);
    const p = composeArtistPrefix(['x'], sm, 'extra tags');
    expect(p.endsWith('extra tags')).toBe(true);
    expect(p).toContain('artist:x');
  });
});
