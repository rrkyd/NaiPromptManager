/**
 * Spec §5: random -> undefined (each API call random); fixed int -> same seed all jobs.
 */
export function resolveSeedForApiCall(params: {
  seed?: number;
}): number | undefined {
  const s = params.seed;
  if (s === undefined || s === null) return undefined;
  if (s === -1) return undefined;
  return s;
}
