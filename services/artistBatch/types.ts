export const MAX_ARTISTS = 20;

export type BatchJobState =
  | 'Pending'
  | 'Running'
  | 'Retrying'
  | 'Success'
  | 'Failed'
  | 'Skipped';

export interface ArtistBatchJob {
  index: number;
  artists: string[];
  artistPrefix: string;
  fullPrompt: string;
  strengthMap: Record<string, number>;
  signature: string;
  state: BatchJobState;
  attempts: number;
  error: string;
  imageUrl?: string;
}

export interface BuildJobsInput {
  selectedArtists: string[];
  positivePrompt: string;
  mode: string;
  fixedStrengthsText: string;
  randMin: number;
  randMax: number;
  iterMin: number;
  iterMax: number;
  iterStep: number;
  iterBase: number;
  nonArtistBlock: string;
  batchCount: number;
  imagesPerArtist: number;
  singleStrength: number;
}
