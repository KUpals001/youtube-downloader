import { logger } from "@/lib/logger";
import {
  normalizeForSearch,
  trackScore,
  cleanForMetadataSearch,
} from "../client-utils";

/**
 * Standardized Deezer metadata result.
 */
export interface DeezerResult {
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
 * Internal Deezer track search item structure.
 */
interface DeezerTrackSearchItem {
  id: number;
  title: string;
  title_short?: string;
  artist?: { id: number; name: string };
  album?: {
    id: number;
    title: string;
    cover?: string;
    cover_medium?: string;
    cover_big?: string;
    release_date?: string;
  };
  track_position?: number;
  disk_number?: number;
  release_date?: string;
}

/**
 * Internal Deezer search response structure.
 */
interface DeezerSearchResponse {
  data?: DeezerTrackSearchItem[];
}

/**
 * Internal Deezer track details structure including contributors.
 */
interface DeezerTrackResponse extends DeezerTrackSearchItem {
  contributors?: Array<{ name: string }>;
}

/**
 * API key for Deezer (optional).
 */
const DEEZER_API_KEY = process.env.DEEZER_API_KEY?.trim() || undefined;

/**
 * Adds the Deezer access token to a URL if available.
 * 
 * @param url - The URL to append the token to.
 * @returns The updated URL.
 */
function withDeezerToken(url: string): string {
  if (!DEEZER_API_KEY) return url;
  const u = new URL(url);
  u.searchParams.set("access_token", DEEZER_API_KEY);
  return u.toString();
}

/**
 * Helper to fetch a Deezer API endpoint with retry logic.
 * 
 * @param urlOrPath - The URL or API path.
 * @param retries - Number of retry attempts.
 * @param queryParams - Additional query parameters.
 * @returns The fetch response.
 */
async function fetchWithRetry(
  urlOrPath: string,
  retries = 3,
  queryParams: Record<string, string> = {},
): Promise<Response> {
  let url: string;
  if (urlOrPath.startsWith("http")) {
    const u = new URL(urlOrPath);
    Object.entries(queryParams).forEach(([k, v]) => u.searchParams.set(k, v));
    url = withDeezerToken(u.toString());
  } else {
    const base = new URL(urlOrPath, "https://api.deezer.com/");
    Object.entries(queryParams).forEach(([k, v]) => base.searchParams.set(k, v));
    url = withDeezerToken(base.toString());
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "YouTubeDownloader/1.0 +https://elpideus.space",
        },
      });
      if (res.ok) return res;
      if (attempt === retries) return res;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw new Error("fetchWithRetry failed");
}

/**
 * Maps a Deezer track object to a standardized result.
 * 
 * @param t - The Deezer track search item.
 * @param searchTrack - The original search track title.
 * @param searchArtist - The original search artist name.
 * @param contributors - Optional list of contributors.
 * @returns Standardized DeezerResult.
 */
function mapTrackToResult(
  t: DeezerTrackSearchItem,
  searchTrack: string,
  searchArtist: string,
  contributors?: Array<{ name: string }>,
): DeezerResult {
  const VARIOUS = /^various\s*artists?$/i;
  const filteredContribs = contributors
    ? contributors.map((c) => c.name).filter((n) => !VARIOUS.test(n))
    : [];
  const artistNames: string[] =
    filteredContribs.length > 0
      ? [...new Set(filteredContribs)]
      : t.artist?.name && !VARIOUS.test(t.artist.name)
        ? [t.artist.name]
        : [searchArtist];
  const artist = artistNames.join(", ");
  const albumArtist = artistNames[0] ?? searchArtist;
  const title = t.title_short || t.title || searchTrack;
  const album = t.album?.title ?? "";
  let year = "";
  if (t.release_date) {
    year = t.release_date.substring(0, 4);
  } else if (t.album?.release_date) {
    year = t.album.release_date.substring(0, 4);
  }
  const trackNumber = t.track_position?.toString() ?? "";
  const discNumber = t.disk_number?.toString() ?? "";
  let coverUrl: string | undefined;
  if (t.album?.cover_medium) {
    coverUrl = t.album.cover_medium;
  } else if (t.album?.cover_big) {
    coverUrl = t.album.cover_big;
  } else if (t.album?.cover) {
    coverUrl = t.album.cover;
  }
  return {
    title,
    artist,
    album,
    year,
    trackNumber,
    discNumber,
    albumArtist,
    composer: "",
    genre: "",
    coverUrl,
  };
}

/**
 * Fetch metadata from Deezer for a given YouTube title and channel.
 * 
 * @param ytTitle - YouTube video title.
 * @param ytChannel - YouTube channel name.
 * @returns Metadata result or null if no match found.
 */
export async function fetchDeezerMeta(
  ytTitle: string,
  ytChannel: string = "",
): Promise<DeezerResult | null> {
  try {
    const { artist: cleanedArtist, track: cleanedTrack } =
      cleanForMetadataSearch(ytTitle);
    const searchArtist =
      cleanedArtist ||
      ytChannel.replace(/ - Topic$|VEVO|Official|Channel/i, "").trim();
    const searchTrack = cleanedTrack || ytTitle;

    const normalizedTrack = normalizeForSearch(searchTrack);
    const normalizedArtist = normalizeForSearch(searchArtist);
    const query = [normalizedArtist, normalizedTrack].filter(Boolean).join(" ");
    if (!query.trim()) return null;

    logger.log("[deezer] searching for", {
      artist: searchArtist,
      track: searchTrack,
    });

    const res = await fetchWithRetry("https://api.deezer.com/search", 3, {
      q: query,
      limit: "15",
    });
    if (!res.ok) return null;

    const data: DeezerSearchResponse = await res.json();
    const tracks: DeezerTrackSearchItem[] = data.data || [];
    if (tracks.length === 0) return null;

    let best = tracks[0];
    let bestScore = trackScore(best.title_short || best.title, normalizedTrack);
    if (normalizedArtist) {
      const artistMatch =
        best.artist?.name &&
        normalizeForSearch(best.artist.name).includes(normalizedArtist);
      if (artistMatch) bestScore += 0.2;
    }
    for (let i = 1; i < tracks.length; i++) {
      const t = tracks[i];
      let score = trackScore(t.title_short || t.title, normalizedTrack);
      if (normalizedArtist && t.artist?.name) {
        if (normalizeForSearch(t.artist.name).includes(normalizedArtist))
          score += 0.2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (bestScore < 0.3) return null;

    try {
      const detailRes = await fetchWithRetry(
        `https://api.deezer.com/track/${best.id}`,
      );
      if (detailRes.ok) {
        const detail: DeezerTrackResponse = await detailRes.json();
        return mapTrackToResult(best, searchTrack, searchArtist, detail.contributors);
      }
    } catch {
    }
    return mapTrackToResult(best, searchTrack, searchArtist);
  } catch (e) {
    logger.error("[deezer] error:", e);
    return null;
  }
}

/**
 * Normalize a Deezer track ID from a URL or plain number string.
 * 
 * @param input - The track ID string (URL or number).
 * @returns Normalized track ID or null.
 */
function normalizeDeezerTrackId(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/deezer\.com\/track\/(\d+)/i) || trimmed.match(/^(\d+)$/);
  return match ? match[1]! : null;
}

/**
 * Fetch metadata from Deezer by a specific track ID.
 * 
 * @param trackId - The Deezer track ID.
 * @returns Metadata result or null if not found.
 */
export async function fetchDeezerMetaByTrackId(
  trackId: string,
): Promise<DeezerResult | null> {
  const id = normalizeDeezerTrackId(trackId);
  if (!id) return null;
  try {
    const res = await fetchWithRetry(
      `https://api.deezer.com/track/${encodeURIComponent(id)}`,
    );
    if (!res.ok) return null;
    const t: DeezerTrackResponse = await res.json();
    if (!t.id || !t.title) return null;
    const VARIOUS = /^various\s*artists?$/i;
    const filteredContribs = t.contributors
      ? t.contributors.map((c) => c.name).filter((n) => !VARIOUS.test(n))
      : [];
    const artistNames: string[] =
      filteredContribs.length > 0
        ? [...new Set(filteredContribs)]
        : t.artist?.name && !VARIOUS.test(t.artist.name)
          ? [t.artist.name]
          : [];
    const artist = artistNames.join(", ");
    const albumArtist = artistNames[0] ?? t.artist?.name ?? "";
    const title = t.title_short || t.title;
    const album = t.album?.title ?? "";
    let year = "";
    if (t.release_date) {
      year = t.release_date.substring(0, 4);
    } else if (t.album?.release_date) {
      year = t.album.release_date.substring(0, 4);
    }
    let coverUrl: string | undefined;
    if (t.album?.cover_medium) {
      coverUrl = t.album.cover_medium;
    } else if (t.album?.cover_big) {
      coverUrl = t.album.cover_big;
    } else if (t.album?.cover) {
      coverUrl = t.album.cover;
    }
    return {
      title,
      artist,
      album,
      year,
      trackNumber: t.track_position?.toString() ?? "",
      discNumber: t.disk_number?.toString() ?? "",
      albumArtist,
      composer: "",
      genre: "",
      coverUrl,
    };
  } catch (e) {
    logger.error("[deezer] track by id error:", e);
    return null;
  }
}
