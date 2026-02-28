import { cleanForMetadataSearch } from "../client-utils";

const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN;
const USER_AGENT = "YouTubeDownloader/1.0 +https://elpideus.space";

/**
 * Standardized Discogs metadata result.
 */
export interface DiscogsResult {
  title: string;
  artist: string;
  album: string;
  year: string;
  trackNumber: string;
  discNumber: string;
  albumArtist: string;
  composer: string;
  genre: string;
  coverUrl?: string;
}

/**
 * Internal Discogs search result structure.
 */
interface DiscogsSearchResult {
  id: number;
  title: string;
}

/**
 * Internal Discogs release details structure.
 */
interface DiscogsRelease {
  id: number;
  title: string;
  year?: number;
  genres?: string[];
  styles?: string[];
  artists?: Array<{ name: string }>;
  tracklist?: Array<{ position: string; title: string }>;
}

/**
 * Search Discogs for a release matching artist and track.
 * 
 * @param artist - Artist name.
 * @param track - Track title.
 * @returns Best matching release ID or null.
 */
async function searchDiscogs(
  artist: string,
  track: string,
): Promise<number | null> {
  if (!DISCOGS_TOKEN) return null;

  const query = `${artist} ${track}`.trim();
  const url = new URL("https://api.discogs.com/database/search");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "release");
  url.searchParams.set("per_page", "5");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      Authorization: `Discogs token=${DISCOGS_TOKEN}`,
    },
  });

  if (!res.ok) return null;
  const data = await res.json();
  const results: DiscogsSearchResult[] = data.results || [];

  if (results.length === 0) return null;

  const scored = results.map((r) => {
    const titleLower = r.title.toLowerCase();
    const artistLower = artist.toLowerCase();
    const trackLower = track.toLowerCase();
    let score = 0;
    if (titleLower.includes(artistLower) && titleLower.includes(trackLower))
      score += 2;
    else if (
      titleLower.includes(artistLower) ||
      titleLower.includes(trackLower)
    )
      score += 1;
    return { id: r.id, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > 0 ? scored[0].id : null;
}

/**
 * Fetch full release details by ID from Discogs.
 * 
 * @param id - Discogs release ID.
 * @returns Release details or null.
 */
async function getReleaseDetails(id: number): Promise<DiscogsRelease | null> {
  const res = await fetch(`https://api.discogs.com/releases/${id}`, {
    headers: {
      "User-Agent": USER_AGENT,
      Authorization: `Discogs token=${DISCOGS_TOKEN}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Search Discogs and return metadata for a given track.
 * 
 * @param ytTitle - YouTube video title.
 * @param ytChannel - YouTube channel name.
 * @returns Metadata result or null if no match found.
 */
export async function fetchDiscogsMeta(
  ytTitle: string,
  ytChannel: string = "",
): Promise<DiscogsResult | null> {
  if (!DISCOGS_TOKEN) return null;

  const { artist: cleanedArtist, track: cleanedTrack } =
    cleanForMetadataSearch(ytTitle);
  const searchArtist =
    cleanedArtist ||
    ytChannel.replace(/ - Topic$|VEVO|Official|Channel/i, "").trim();
  const searchTrack = cleanedTrack || ytTitle;

  if (!searchArtist || !searchTrack) return null;

  const releaseId = await searchDiscogs(searchArtist, searchTrack);
  if (!releaseId) return null;

  const release = await getReleaseDetails(releaseId);
  if (!release) return null;

  let trackNumber = "";
  if (release.tracklist) {
    const matchedTrack = release.tracklist.find(
      (t) =>
        t.title.toLowerCase().includes(searchTrack.toLowerCase()) ||
        searchTrack.toLowerCase().includes(t.title.toLowerCase()),
    );
    if (matchedTrack) trackNumber = matchedTrack.position;
  }

  let artist = searchArtist;
  if (release.artists && release.artists.length > 0) {
    artist = release.artists[0].name;
  }

  return {
    title: searchTrack,
    artist,
    album: release.title,
    year: release.year?.toString() || "",
    trackNumber,
    discNumber: "",
    albumArtist: artist,
    composer: "",
    genre: release.genres?.[0] || release.styles?.[0] || "",
    coverUrl: undefined,
  };
}

/**
 * Normalize a Discogs release ID from a URL or plain number.
 * 
 * @param input - The release ID string (URL or number).
 * @returns Normalized numeric ID or null.
 */
function normalizeDiscogsReleaseId(input: string): number | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/discogs\.com\/release\/(\d+)/i);
  if (urlMatch) return parseInt(urlMatch[1]!, 10);
  const plain = parseInt(trimmed, 10);
  if (!isNaN(plain) && plain > 0) return plain;
  return null;
}

/**
 * Fetch metadata from Discogs by a specific release ID (or URL).
 * 
 * @param releaseId - The Discogs release ID.
 * @returns Metadata result or null if not found.
 */
export async function fetchDiscogsMetaByReleaseId(
  releaseId: string,
): Promise<DiscogsResult | null> {
  if (!DISCOGS_TOKEN) return null;
  const id = normalizeDiscogsReleaseId(releaseId);
  if (!id) return null;
  try {
    const release = await getReleaseDetails(id);
    if (!release) return null;

    let artist = "";
    if (release.artists && release.artists.length > 0) {
      artist = release.artists[0].name;
    }

    return {
      title: release.title,
      artist,
      album: release.title,
      year: release.year?.toString() || "",
      trackNumber: "",
      discNumber: "",
      albumArtist: artist,
      composer: "",
      genre: release.genres?.[0] || release.styles?.[0] || "",
      coverUrl: undefined,
    };
  } catch (e) {
    console.error("[discogs] fetchByReleaseId error:", e);
    return null;
  }
}
