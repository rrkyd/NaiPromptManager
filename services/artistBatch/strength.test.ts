import { describe, it, expect } from 'vitest';
import {
  parseFixedStrengths,
  buildStrengthMap,
  stableHash1000,
  EPS,
} from './strength';

describe('parseFixedStrengths', () => {
  it('parses artist:name=strength pairs', () => {
    const m = parseFixedStrengths('artist:Alpha=0.8, artist:Beta=0.6');
    expect(m.get('alpha')).toBe(0.8);
    expect(m.get('beta')).toBe(0.6);
  });
});

describe('buildStrengthMap', () => {
  const artists = ['B', 'A'];

  it('Equal: all 1.0', () => {
    const m = buildStrengthMap(
      'Equal',
      artists,
      new Map(),
      0.4,
      1.2,
      1,
      2,
      0.2,
      1,
      0,
      1
    );
    expect(m.get('a')).toBe(1);
    expect(m.get('b')).toBe(1);
  });

  it('Single: singleStrength for each', () => {
    const m = buildStrengthMap(
      'Single',
      ['x'],
      new Map(),
      0.4,
      1.2,
      1,
      2,
      0.2,
      1,
      0,
      0.75
    );
    expect(m.get('x')).toBe(0.75);
  });

  it('Full Random: stable for same inputs', () => {
    const m1 = buildStrengthMap(
      'Full Random',
      artists,
      new Map(),
      0.4,
      1.2,
      1,
      2,
      0.2,
      1,
      3,
      1
    );
    const m2 = buildStrengthMap(
      'Full Random',
      artists,
      new Map(),
      0.4,
      1.2,
      1,
      2,
      0.2,
      1,
      3,
      1
    );
    expect(m1.get('a')).toBe(m2.get('a'));
    expect(m1.get('b')).toBe(m2.get('b'));
  });

  it('Iterate: idx 0 uses first level on first sorted artist', () => {
    const m = buildStrengthMap(
      'Iterate',
      ['z', 'a'],
      new Map(),
      0.4,
      1.2,
      1.0,
      2.0,
      0.2,
      0.5,
      0,
      1
    );
    expect(m.get('a')).toBe(1.0);
    expect(m.get('z')).toBe(0.5);
  });

  it('Fixed Some: fixed keys honored; others capped', () => {
    const fixed = new Map<string, number>([['a', 0.5]]);
    const m = buildStrengthMap(
      'Fixed Some',
      ['a', 'b'],
      fixed,
      0.4,
      1.2,
      1,
      2,
      0.2,
      1,
      0,
      1
    );
    expect(m.get('a')).toBe(0.5);
    const vb = m.get('b');
    expect(vb).toBeDefined();
    expect(vb!).toBeLessThanOrEqual(0.5 + EPS);
  });
});

describe('stableHash1000', () => {
  it('is deterministic', () => {
    expect(stableHash1000(['foo', 2])).toBe(stableHash1000(['foo', 2]));
  });
});
