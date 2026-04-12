import { describe, it, expect } from 'vitest';
import { resolveSeedForApiCall } from './seedForJob';

describe('resolveSeedForApiCall', () => {
  it('returns undefined when random (undefined)', () => {
    expect(resolveSeedForApiCall({ seed: undefined })).toBeUndefined();
  });
  it('returns undefined when random (-1)', () => {
    expect(resolveSeedForApiCall({ seed: -1 })).toBeUndefined();
  });
  it('returns fixed number when seed set', () => {
    expect(resolveSeedForApiCall({ seed: 42 })).toBe(42);
  });
});
