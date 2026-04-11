import { describe, expect, it } from 'vitest';
import {
  displayArtistName,
  mergeArtistSources,
  normalizeArtistName,
  parseArtistInput,
  parseArtistsFromFileContent,
} from './parseArtists';

describe('parseArtistInput', () => {
  it('parses artist: tokens and dedupes case-insensitively by normalized key', () => {
    expect(parseArtistInput('artist:Foo Bar, artist:foo bar')).toEqual(['Foo Bar']);
  });

  it('extracts names from weighted segments', () => {
    const out = parseArtistInput('1.2::artist:a, artist:b::');
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  it('accepts aritst typo like Python', () => {
    expect(parseArtistInput('aritst:Who')).toEqual(['Who']);
  });
});

describe('normalizeArtistName / displayArtistName', () => {
  it('strip only outer space and comma, then collapse internal whitespace (normalize lowercases)', () => {
    expect(normalizeArtistName(' ,Foo  Bar, ')).toBe('foo bar');
    expect(displayArtistName(' ,Foo  Bar, ')).toBe('Foo Bar');
  });
});

describe('mergeArtistSources', () => {
  it('merges existing text and file artists with artist: prefix join', () => {
    const { mergedText, artists } = mergeArtistSources(
      'artist:Alpha',
      'artist:Beta',
      'artists.txt'
    );
    expect(artists).toEqual(['Alpha', 'Beta']);
    expect(mergedText).toBe('artist:Alpha, artist:Beta');
  });

  it('dedupes case-insensitively keeping first occurrence (existing wins)', () => {
    const { mergedText, artists } = mergeArtistSources(
      'artist:Foo',
      'artist:foo',
      null
    );
    expect(artists).toEqual(['Foo']);
    expect(mergedText).toBe('artist:Foo');
  });

  it('treats null file content as no import', () => {
    expect(mergeArtistSources('artist:Only', null).artists).toEqual(['Only']);
  });

  it('treats empty file content as no import', () => {
    expect(mergeArtistSources('artist:Only', '').artists).toEqual(['Only']);
  });

  it('merges CSV rows with comma join like Python plugin', () => {
    const { mergedText, artists } = mergeArtistSources(
      'artist:Z',
      'x,y\nz,w',
      'pool.csv'
    );
    expect(artists).toEqual(['Z', 'x', 'y', 'w']);
    expect(mergedText).toBe('artist:Z, artist:x, artist:y, artist:w');
  });
});

describe('parseArtistsFromFileContent', () => {
  it('parses non-CSV as full prompt text', () => {
    expect(parseArtistsFromFileContent('artist:A\nartist:B', 'names.txt')).toEqual([
      'A',
      'B',
    ]);
  });

  it('CSV quoted cell then comma splits into separate tokens after merge (Python behavior)', () => {
    const out = parseArtistsFromFileContent('"a,b",c', 't.csv');
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('CSV with blank line row merges like Python csv.reader + join', () => {
    const out = parseArtistsFromFileContent('a,b\n\n', 't.csv');
    expect(out).toEqual(['a', 'b']);
  });
});
