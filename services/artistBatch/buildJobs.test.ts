import { describe, it, expect } from 'vitest';
import { buildJobs, sha256HexUtf8 } from './buildJobs';

describe('buildJobs', () => {
  const base = {
    positivePrompt: 'p',
    fixedStrengthsText: '',
    randMin: 0.4,
    randMax: 1.2,
    iterMin: 1,
    iterMax: 2,
    iterStep: 0.2,
    iterBase: 1,
    nonArtistBlock: '',
    batchCount: 20,
    imagesPerArtist: 3,
    singleStrength: 1,
  };

  it('Single mode: len(jobs) = artists * imagesPerArtist', () => {
    const jobs = buildJobs({
      ...base,
      selectedArtists: ['a', 'b'],
      mode: 'Single',
    });
    expect(jobs).toHaveLength(6);
  });

  it('non-Single: batchCount jobs', () => {
    const jobs = buildJobs({
      ...base,
      selectedArtists: ['a', 'b'],
      mode: 'Equal',
      batchCount: 5,
    });
    expect(jobs).toHaveLength(5);
    expect(jobs[0]!.fullPrompt).toContain('p');
  });

  it('signature is sha256 hex of fullPrompt utf-8', () => {
    const jobs = buildJobs({
      ...base,
      selectedArtists: ['x'],
      mode: 'Equal',
      batchCount: 1,
    });
    const fp = jobs[0]!.fullPrompt;
    expect(jobs[0]!.signature).toBe(sha256HexUtf8(fp));
    expect(jobs[0]!.signature).toMatch(/^[a-f0-9]{64}$/);
  });
});
