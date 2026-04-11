const ARTIST_PREFIX_RE = /^(artist|aritst)\s*:\s*/i;
const WEIGHTED_BLOCK_RE = /([0-9]*\.?[0-9]+)\s*::([\s\S]*?)::/gi;

/** Python `strip(" ,")` — only space and comma, not other whitespace. */
function stripOuterCommasAndAsciiSpace(name: string): string {
  return name.replace(/^[ ,]+|[ ,]+$/g, '');
}

/** Mirrors Python `_normalize_artist_name`. */
export function normalizeArtistName(name: string): string {
  const trimmed = stripOuterCommasAndAsciiSpace(name);
  return trimmed.replace(/\s+/g, ' ').toLowerCase();
}

/** Mirrors Python `_display_artist_name`. */
export function displayArtistName(name: string): string {
  const trimmed = stripOuterCommasAndAsciiSpace(name);
  return trimmed.replace(/\s+/g, ' ');
}

/** Minimal CSV row parse aligned with Python `csv.reader` default for a single line. */
function parseCsvRowLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += c;
      i += 1;
    } else {
      if (c === '"') {
        inQuotes = true;
        i += 1;
      } else if (c === ',') {
        result.push(cur);
        cur = '';
        i += 1;
      } else {
        cur += c;
        i += 1;
      }
    }
  }
  result.push(cur);
  return result;
}

/**
 * Mirrors Python `str.splitlines()` for `\n` / `\r\n` (differs from `String.split` on trailing newlines).
 */
function pythonSplitlines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n');
  if (
    normalized.endsWith('\n') &&
    parts.length > 0 &&
    parts[parts.length - 1] === ''
  ) {
    parts.pop();
  }
  return parts;
}

/** Mirrors `list(csv.reader(content.splitlines()))` used in the Python plugin. */
function csvReaderSplitLines(content: string): string[][] {
  return pythonSplitlines(content).map((line) => parseCsvRowLine(line));
}

/**
 * Mirrors Python `_parse_artist_input`.
 */
export function parseArtistInput(text: string): string[] {
  if (!text) return [];
  const raw = text.replace(/\n/g, ',');
  const names: string[] = [];

  const weightedRe = new RegExp(WEIGHTED_BLOCK_RE.source, WEIGHTED_BLOCK_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = weightedRe.exec(raw)) !== null) {
    const content = m[2] ?? '';
    for (const part of content.split(',')) {
      let token = part.trim().replace(ARTIST_PREFIX_RE, '').trim();
      if (token) names.push(token);
    }
  }

  const residual = raw.replace(WEIGHTED_BLOCK_RE, ',');
  for (const part of residual.split(',')) {
    let token = part.trim();
    token = token.replace(/^[0-9]*\.?[0-9]+\s*::\s*/, '');
    token = token.replace(/\s*::$/, '');
    token = token.replace(ARTIST_PREFIX_RE, '').trim();
    if (token) names.push(token);
  }

  const dedup: Record<string, string> = {};
  for (const name of names) {
    const key = normalizeArtistName(name);
    if (key && !(key in dedup)) {
      dedup[key] = displayArtistName(name);
    }
  }
  return Object.values(dedup);
}

/**
 * Mirrors Python `_parse_uploaded_artists` when given file body + optional name hint.
 * CSV: rows merged with commas like Python; otherwise full text goes through `parseArtistInput`.
 */
export function parseArtistsFromFileContent(
  content: string,
  fileNameHint?: string
): string[] {
  if (!content) return [];
  const isCsv = fileNameHint?.toLowerCase().endsWith('.csv');
  if (isCsv) {
    const rows = csvReaderSplitLines(content);
    const merged = rows.map((r) => r.join(',')).join(',');
    return parseArtistInput(merged);
  }
  return parseArtistInput(content);
}

export type MergeArtistSourcesResult = {
  mergedText: string;
  artists: string[];
};

/**
 * Mirrors Python `merge_artist_sources` merge + `merged_text` shape (`artist:x, artist:y`).
 * `fileContent` null/empty skips file import. `fileNameHint` ending in `.csv` selects CSV merge.
 */
export function mergeArtistSources(
  existingText: string,
  fileContent: string | null,
  fileNameHint?: string
): MergeArtistSourcesResult {
  const existing = parseArtistInput(existingText);
  const imported =
    fileContent != null && fileContent !== ''
      ? parseArtistsFromFileContent(fileContent, fileNameHint)
      : [];

  const dedup: Record<string, string> = {};
  for (const artist of [...existing, ...imported]) {
    const key = normalizeArtistName(artist);
    if (key && !(key in dedup)) {
      dedup[key] = artist;
    }
  }

  const artists = Object.values(dedup);

  const mergedText = artists.map((a) => `artist:${a}`).join(', ');
  return { mergedText, artists };
}
