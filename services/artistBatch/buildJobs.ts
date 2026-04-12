import { sha256 } from 'js-sha256';
import { composeArtistPrefix, buildFullPrompt } from './compose';
import { parseFixedStrengths, buildStrengthMap } from './strength';
import type { ArtistBatchJob, BuildJobsInput } from './types';

export function sha256HexUtf8(s: string): string {
  return sha256(s);
}

export function buildJobs(input: BuildJobsInput): ArtistBatchJob[] {
  const {
    selectedArtists,
    positivePrompt,
    mode,
    fixedStrengthsText,
    randMin,
    randMax,
    iterMin,
    iterMax,
    iterStep,
    iterBase,
    nonArtistBlock,
    batchCount,
    imagesPerArtist,
    singleStrength,
  } = input;

  const fixedMap = parseFixedStrengths(fixedStrengthsText);
  const jobs: ArtistBatchJob[] = [];
  const lowerMode = mode.toLowerCase();

  if (lowerMode === 'single') {
    let idx = 0;
    for (const artist of selectedArtists) {
      const n = Math.max(1, Math.floor(imagesPerArtist));
      for (let i = 0; i < n; i++) {
        const artists = [artist];
        const strengthMap = buildStrengthMap(
          mode,
          artists,
          fixedMap,
          randMin,
          randMax,
          iterMin,
          iterMax,
          iterStep,
          iterBase,
          idx,
          singleStrength
        );
        const artistPrefix = composeArtistPrefix(artists, strengthMap, nonArtistBlock);
        const fullPrompt = buildFullPrompt(artistPrefix, positivePrompt);
        jobs.push({
          index: idx,
          artists: [...artists],
          artistPrefix,
          fullPrompt,
          strengthMap: mapToRecord(strengthMap),
          signature: sha256HexUtf8(fullPrompt),
          state: 'Pending',
          attempts: 0,
          error: '',
        });
        idx += 1;
      }
    }
    return jobs;
  }

  const count = Math.max(1, Math.floor(batchCount));
  for (let idx = 0; idx < count; idx++) {
    const strengthMap = buildStrengthMap(
      mode,
      selectedArtists,
      fixedMap,
      randMin,
      randMax,
      iterMin,
      iterMax,
      iterStep,
      iterBase,
      idx,
      singleStrength
    );
    const artistPrefix = composeArtistPrefix(
      selectedArtists,
      strengthMap,
      nonArtistBlock
    );
    const fullPrompt = buildFullPrompt(artistPrefix, positivePrompt);
    jobs.push({
      index: idx,
      artists: [...selectedArtists],
      artistPrefix,
      fullPrompt,
      strengthMap: mapToRecord(strengthMap),
      signature: sha256HexUtf8(fullPrompt),
      state: 'Pending',
      attempts: 0,
      error: '',
    });
  }
  return jobs;
}

function mapToRecord(m: Map<string, number>): Record<string, number> {
  const o: Record<string, number> = {};
  for (const [k, v] of m) o[k] = v;
  return o;
}
