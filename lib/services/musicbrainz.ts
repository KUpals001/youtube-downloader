import { logger } from "@/lib/logger";
import {
  normalizeForSearch,
  trackScore,
  cleanForMetadataSearch,
} from "../client-utils";

/**
 * User agent string for MusicBrainz API requests.
 */
const MUSICBRAINZ_UA = "youtube-downloader/1.0 (https://elpideus.space)";

/**
 * Helper to fetch a URL with retry logic.
 * 
 * @param url - The URL to fetch.
 * @param options - Request options.
 * @param retries - Number of retry attempts.
 * @returns The fetch response.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3,
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (attempt === retries) return res;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error("fetchWithRetry failed");
}

/**
 * Standardized MusicBrainz metadata result.
 */
export interface MusicBrainzResult {
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
 * Internal MusicBrainz recording response structure.
 */
interface MBRecording {
  id: string;
  title?: string;
  releases?: Array<{ id: string }>;
}

/**
 * Internal MusicBrainz track response structure.
 */
interface MBTrack {
  position?: number;
  recording?: {
    id: string;
    title?: string;
  };
}

/**
 * Internal MusicBrainz release response structure.
 */
interface MBRelease {
  id: string;
  title?: string;
  date?: string;
  "release-group"?: { "first-release-date"?: string; "primary-type"?: string };
  "artist-credit"?: Array<
    { name?: string; joinphrase?: string; artist?: { name: string } } | string
  >;
  media?: Array<{
    position: number;
    tracks?: MBTrack[];
  }>;
}

/**
 * Fetch metadata from MusicBrainz for a given YouTube title and channel.
 * 
 * @param ytTitle - YouTube video title.
 * @param ytChannel - YouTube channel name.
 * @returns Metadata result or null if no match found.
 */
export async function fetchMusicBrainzMeta(
  ytTitle: string,
  ytChannel: string = "",
): Promise<MusicBrainzResult | null> {
  try {
    const { artist: cleanedArtist, track: cleanedTrack } =
      cleanForMetadataSearch(ytTitle);
    const searchArtist =
      cleanedArtist ||
      ytChannel.replace(/ - Topic$|VEVO|Official|Channel/i, "").trim();
    const searchTrack = cleanedTrack || ytTitle;

    const normalizedTrack = normalizeForSearch(searchTrack);
    const normalizedArtist = normalizeForSearch(searchArtist);

    logger.log("[musicbrainz] searching for", {
      artist: searchArtist,
      track: searchTrack,
    });

    let query = `recording:"${normalizedTrack}"`;
    if (normalizedArtist) query = `artist:"${normalizedArtist}" AND ${query}`;
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=10&inc=releases+release-groups`;

    const res = await fetchWithRetry(url, {
      headers: { "User-Agent": MUSICBRAINZ_UA, Accept: "application/json" },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const recordings: MBRecording[] = data.recordings || [];
    if (recordings.length === 0) return null;

    let bestRecording: MBRecording | null = null;
    let bestScore = 0;
    for (const r of recordings) {
      const score = trackScore(r.title || "", normalizedTrack);
      if (score > bestScore) {
        bestScore = score;
        bestRecording = r;
      }
    }
    if (!bestRecording || bestScore < 0.6) return null;

    const releases = bestRecording.releases || [];
    if (releases.length === 0) return null;

    const selectedRelease = releases[0];
    const releaseMbid = selectedRelease.id;

    const releaseUrl = `https://musicbrainz.org/ws/2/release/${releaseMbid}?fmt=json&inc=recordings+artists+release-groups`;
    const releaseRes = await fetchWithRetry(releaseUrl, {
      headers: { "User-Agent": MUSICBRAINZ_UA, Accept: "application/json" },
    });
    if (!releaseRes.ok) return null;

    const releaseData: MBRelease = await releaseRes.json();

    let trackNumber = "";
    let discNumber = "";
    let foundTrack: MBTrack | null = null;

    if (releaseData.media) {
      for (const media of releaseData.media) {
        const disc = media.position;
        if (media.tracks) {
          for (const track of media.tracks) {
            if (track.recording && track.recording.id === bestRecording.id) {
              foundTrack = track;
              discNumber = disc.toString();
              trackNumber = track.position?.toString() || "";
              break;
            }
          }
        }
        if (foundTrack) break;
      }
    }

    if (!foundTrack && releaseData.media) {
      for (const media of releaseData.media) {
        if (media.tracks) {
          for (const track of media.tracks) {
            if (
              track.recording &&
              trackScore(track.recording.title || "", normalizedTrack) >= 0.8
            ) {
              foundTrack = track;
              discNumber = media.position?.toString() || "";
              trackNumber = track.position?.toString() || "";
              break;
            }
          }
        }
        if (foundTrack) break;
      }
    }

    const album = releaseData.title || "";
    let year = "";
    if (releaseData.date) {
      year = releaseData.date.substring(0, 4);
    } else if (
      releaseData["release-group"] &&
      releaseData["release-group"]["first-release-date"]
    ) {
      year = releaseData["release-group"]["first-release-date"].substring(0, 4);
    }

    let artist = searchArtist;
    let albumArtist = searchArtist;
    if (
      releaseData["artist-credit"] &&
      releaseData["artist-credit"].length > 0
    ) {
      let joined = "";
      for (const credit of releaseData["artist-credit"]) {
        if (typeof credit === "string") {
          joined += credit;
        } else {
          const name = credit.name || credit.artist?.name || "";
          joined += name + (credit.joinphrase || "");
        }
      }
      artist = joined.trim() || searchArtist;
      const first = releaseData["artist-credit"][0];
      albumArtist = typeof first === "string"
        ? first
        : first.name || first.artist?.name || searchArtist;
    }

    let genre = "";
    if (
      releaseData["release-group"] &&
      releaseData["release-group"]["primary-type"]
    ) {
      genre = releaseData["release-group"]["primary-type"];
    }

    let coverUrl: string | undefined = undefined;
    try {
      const coverRes = await fetch(
        `https://coverartarchive.org/release/${releaseMbid}/front-250`,
        {
          method: "HEAD",
        },
      );
      if (coverRes.ok) {
        coverUrl = `https://coverartarchive.org/release/${releaseMbid}/front-250`;
      }
    } catch { }

    return {
      title: foundTrack?.recording?.title || bestRecording.title || searchTrack,
      artist,
      album,
      year,
      trackNumber,
      discNumber,
      albumArtist,
      composer: "",
      genre,
      coverUrl,
    };
  } catch (e) {
    logger.error("[musicbrainz] error:", e);
    return null;
  }
}

/**
 * Normalize a MusicBrainz release MBID from a URL or bare UUID.
 * 
 * @param input - The MBID string (URL or UUID).
 * @returns Normalized UUID or null.
 */
function normalizeReleaseMbid(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/musicbrainz\.org\/release\/([0-9a-f-]{36})/i);
  if (urlMatch) return urlMatch[1]!;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Fetch metadata from MusicBrainz by a specific release MBID (or URL).
 * 
 * @param releaseId - The MusicBrainz release ID.
 * @returns Metadata result or null if not found.
 */
export async function fetchMusicBrainzMetaByReleaseId(
  releaseId: string,
): Promise<MusicBrainzResult | null> {
  const mbid = normalizeReleaseMbid(releaseId);
  if (!mbid) return null;
  try {
    const releaseUrl = `https://musicbrainz.org/ws/2/release/${mbid}?fmt=json&inc=recordings+artists+release-groups`;
    const releaseRes = await fetchWithRetry(releaseUrl, {
      headers: { "User-Agent": MUSICBRAINZ_UA, Accept: "application/json" },
    });
    if (!releaseRes.ok) return null;

    const releaseData: MBRelease = await releaseRes.json();

    const album = releaseData.title || "";
    let year = "";
    if (releaseData.date) {
      year = releaseData.date.substring(0, 4);
    } else if (
      releaseData["release-group"] &&
      releaseData["release-group"]["first-release-date"]
    ) {
      year = releaseData["release-group"]["first-release-date"].substring(0, 4);
    }

    let artist = "";
    if (
      releaseData["artist-credit"] &&
      releaseData["artist-credit"].length > 0
    ) {
      const credit = releaseData["artist-credit"][0];
      artist =
        typeof credit === "string"
          ? credit
          : credit.name || credit.artist?.name || "";
    }

    let genre = "";
    if (
      releaseData["release-group"] &&
      releaseData["release-group"]["primary-type"]
    ) {
      genre = releaseData["release-group"]["primary-type"];
    }

    let title = album;
    let trackNumber = "";
    let discNumber = "";
    if (releaseData.media && releaseData.media.length > 0) {
      const firstMedia = releaseData.media[0];
      discNumber = firstMedia.position?.toString() || "";
      if (firstMedia.tracks && firstMedia.tracks.length > 0) {
        const firstTrack = firstMedia.tracks[0];
        title = firstTrack.recording?.title || album;
        trackNumber = firstTrack.position?.toString() || "";
      }
    }

    let coverUrl: string | undefined = undefined;
    try {
      const coverRes = await fetch(
        `https://coverartarchive.org/release/${mbid}/front-250`,
        { method: "HEAD" },
      );
      if (coverRes.ok) {
        coverUrl = `https://coverartarchive.org/release/${mbid}/front-250`;
      }
    } catch { }

    return {
      title,
      artist,
      album,
      year,
      trackNumber,
      discNumber,
      albumArtist: artist,
      composer: "",
      genre,
      coverUrl,
    };
  } catch (e) {
    logger.error("[musicbrainz] fetchByReleaseId error:", e);
    return null;
  }
}
