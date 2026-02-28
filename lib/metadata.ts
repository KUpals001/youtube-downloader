import { logger } from "@/lib/logger";
import { prisma } from "./prisma";
import { fetchMusicBrainzMeta, fetchMusicBrainzMetaByReleaseId } from "./services/musicbrainz";
import { fetchDiscogsMeta, fetchDiscogsMetaByReleaseId } from "./services/discogs";
import {
  fetchDeezerMeta,
  fetchDeezerMetaByTrackId,
} from "./services/deezer";
import {
  getCleanedFallback,
  normalizeForSearch,
  cleanForMetadataSearch,
} from "./client-utils";
import { createHash } from "crypto";

/**
 * Complete metadata result including source information.
 */
export type MetadataResult = {
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
  /** Single source or combined e.g. "musicbrainz, discogs, deezer" */
  source: string;
};

/**
 * Partial metadata object used during fetching and merging.
 */
type PartialMeta = {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  trackNumber?: string;
  discNumber?: string;
  albumArtist?: string;
  composer?: string;
  genre?: string;
  coverUrl?: string;
};

/**
 * Checks if a string is non-empty after trimming.
 * 
 * @param s - The string to check.
 * @returns The trimmed string or undefined if empty.
 */
function nonEmpty(s: string | undefined): string | undefined {
  const t = typeof s === "string" ? s.trim() : "";
  return t.length > 0 ? t : undefined;
}

/**
 * Merge metadata from multiple sources (MusicBrainz, Discogs, Deezer).
 * For each field, the first non-empty value is taken in predefined order.
 * 
 * @param mb - Metadata from MusicBrainz.
 * @param dc - Metadata from Discogs.
 * @param dz - Metadata from Deezer.
 * @returns Merged metadata and the list of sources used.
 */
function mergeMetadata(
  mb: PartialMeta | null,
  dc: PartialMeta | null,
  dz: PartialMeta | null,
): { merged: MetadataResult; sources: string[] } {
  const sources: string[] = [];
  const pick = (
    order: ("mb" | "dc" | "dz")[],
    key: keyof PartialMeta,
  ): string | undefined => {
    for (const src of order) {
      const obj = src === "mb" ? mb : src === "dc" ? dc : dz;
      const val = obj && nonEmpty(obj[key] as string | undefined);
      if (val) {
        if (!sources.includes(src === "mb" ? "musicbrainz" : src === "dc" ? "discogs" : "deezer")) {
          sources.push(src === "mb" ? "musicbrainz" : src === "dc" ? "discogs" : "deezer");
        }
        return val;
      }
    }
    return undefined;
  };
  const coverOrder: ("mb" | "dc" | "dz")[] = ["dz", "mb", "dc"];
  const restOrder: ("mb" | "dc" | "dz")[] = ["mb", "dc", "dz"];
  const title = pick(restOrder, "title") ?? "";
  const artist = pick(restOrder, "artist") ?? "";
  const album = pick(restOrder, "album") ?? "";
  const year = pick(restOrder, "year") ?? "";
  const trackNumber = pick(restOrder, "trackNumber") ?? "";
  const discNumber = pick(restOrder, "discNumber") ?? "";
  const albumArtist = pick(restOrder, "albumArtist") ?? artist;
  const composer = pick(restOrder, "composer") ?? "";
  const genre = pick(restOrder, "genre") ?? "";
  let coverUrl: string | undefined;
  for (const src of coverOrder) {
    const obj = src === "mb" ? mb : src === "dc" ? dc : dz;
    const u = obj?.coverUrl?.trim();
    if (u && u.length > 0) {
      coverUrl = u;
      const name = src === "mb" ? "musicbrainz" : src === "dc" ? "discogs" : "deezer";
      if (!sources.includes(name)) sources.push(name);
      break;
    }
  }
  const ordered = ["musicbrainz", "discogs", "deezer"].filter((s) =>
    sources.includes(s),
  );
  const merged: MetadataResult = {
    title,
    artist,
    album,
    year,
    trackNumber,
    discNumber,
    albumArtist: albumArtist || artist,
    composer,
    genre,
    coverUrl: coverUrl || undefined,
    source: ordered.length > 0 ? ordered.join(", ") : "youtube",
  };
  return { merged, sources: ordered };
}

/**
 * Generate a cache key from search parameters.
 * Manual IDs take precedence over auto-search keys.
 * 
 * @param ytTitle - YouTube video title.
 * @param ytChannel - YouTube channel name.
 * @param mbId - MusicBrainz ID.
 * @param discogsId - Discogs ID.
 * @param deezerId - Deezer ID.
 * @returns SHA-256 hash of the search parameters.
 */
function generateCacheKey(
  ytTitle: string,
  ytChannel: string,
  mbId?: string,
  discogsId?: string,
  deezerId?: string,
): string {
  const { artist, track } = cleanForMetadataSearch(ytTitle);
  const normalizedArtist = normalizeForSearch(artist || ytChannel);
  const normalizedTrack = normalizeForSearch(track || ytTitle);

  const manualParts: string[] = [];
  if (mbId) manualParts.push(`mb:${mbId.trim()}`);
  if (discogsId) manualParts.push(`dc:${discogsId.trim()}`);
  if (deezerId) manualParts.push(`dz:${deezerId.trim()}`);

  const base = manualParts.length > 0
    ? `manual:${manualParts.join(",")}`
    : `${normalizedArtist}:${normalizedTrack}`;

  return createHash("sha256").update(base).digest("hex");
}

/**
 * Checks if an error is related to database connectivity.
 * 
 * @param err - The error to check.
 * @returns True if it's a connectivity error.
 */
function isDbConnectionError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: string }).code;
    return code === "ECONNREFUSED" || code === "P1001" || code === "P1017";
  }
  return false;
}

/**
 * Fetches metadata for a YouTube video, with caching and fallback.
 * Attempts to match against MusicBrainz, Discogs, and Deezer.
 * 
 * @param ytTitle - YouTube video title.
 * @param ytChannel - YouTube channel name.
 * @param uploadDate - Video upload date.
 * @param mbId - Optional manual MusicBrainz ID.
 * @param discogsId - Optional manual Discogs ID.
 * @param deezerId - Optional manual Deezer ID.
 * @returns The best available metadata for the track.
 */
export async function getMetadata(
  ytTitle: string,
  ytChannel: string = "",
  uploadDate?: string,
  mbId?: string,
  discogsId?: string,
  deezerId?: string,
): Promise<MetadataResult> {
  const cacheKey = generateCacheKey(ytTitle, ytChannel, mbId, discogsId, deezerId);

  let cached: Awaited<ReturnType<typeof prisma.videoMetadata.findUnique>> = null;
  try {
    cached = await prisma.videoMetadata.findUnique({
      where: { id: cacheKey },
    });
  } catch (err) {
    if (isDbConnectionError(err)) {
      logger.log("[metadata] database unavailable, skipping cache");
    } else {
      throw err;
    }
  }

  if (cached) {
    logger.log("[metadata] cache hit");
    if (cached.fullMetadata) {
      return cached.fullMetadata as MetadataResult;
    }
    return {
      title: cached.normalizedTitle || cached.youtubeTitle,
      artist: cached.normalizedArtist,
      album: cached.album || "",
      year: cached.year || "",
      trackNumber: cached.trackNumber || "",
      discNumber: "",
      albumArtist: cached.normalizedArtist,
      composer: "",
      genre: cached.genre || "",
      coverUrl: undefined,
      source: cached.source,
    };
  }

  logger.log("[metadata] cache miss, fetching...");

  let result: MetadataResult | null = null;
  const hasManualIds = mbId || discogsId || deezerId;

  if (hasManualIds) {
    const [mb, dc, dz] = await Promise.all([
      mbId
        ? fetchMusicBrainzMetaByReleaseId(mbId)
        : fetchMusicBrainzMeta(ytTitle, ytChannel),
      discogsId
        ? fetchDiscogsMetaByReleaseId(discogsId)
        : fetchDiscogsMeta(ytTitle, ytChannel),
      deezerId
        ? fetchDeezerMetaByTrackId(deezerId)
        : fetchDeezerMeta(ytTitle, ytChannel),
    ]);

    const { merged } = mergeMetadata(mb, dc, dz);
    const hasAny = mb || dc || dz;
    if (hasAny && (merged.title || merged.artist)) {
      result = merged;
    }
  }

  if (!result && !hasManualIds) {
    const [mb, dc, dz] = await Promise.all([
      fetchMusicBrainzMeta(ytTitle, ytChannel),
      fetchDiscogsMeta(ytTitle, ytChannel),
      fetchDeezerMeta(ytTitle, ytChannel),
    ]);
    const { merged } = mergeMetadata(mb, dc, dz);
    const hasAny = mb || dc || dz;
    if (hasAny && (merged.title || merged.artist)) {
      result = merged;
    }
  }

  if (!result) {
    const fallback = getCleanedFallback(ytTitle, ytChannel);
    result = {
      ...fallback,
      source: "youtube",
    };
  }

  if (result.source !== "youtube") {
    const { featuredArtists } = cleanForMetadataSearch(ytTitle);
    if (featuredArtists.length > 0) {
      const artistLower = result.artist.toLowerCase();
      const missing = featuredArtists.filter(
        (fa) => !artistLower.includes(fa.toLowerCase()),
      );
      if (missing.length > 0) {
        result = {
          ...result,
          artist: [result.artist, ...missing].join(", "),
        };
      }
    }
  }

  if (!result.year && uploadDate) {
    result.year = uploadDate.replace(/\D/g, "").slice(0, 4);
  }

  try {
    await prisma.videoMetadata.upsert({
      where: { id: cacheKey },
      update: {},
      create: {
        id: cacheKey,
        youtubeTitle: ytTitle,
        channel: ytChannel,
        uploadDate: uploadDate || null,
        normalizedArtist: normalizeForSearch(result.artist),
        normalizedTitle: normalizeForSearch(result.title),
        album: result.album || null,
        year: result.year || null,
        trackNumber: result.trackNumber || null,
        genre: result.genre || null,
        source: result.source,
        fullMetadata: result,
      },
    });
  } catch (err) {
    if (isDbConnectionError(err)) {
      logger.log("[metadata] database unavailable, skipping cache write");
    } else {
      throw err;
    }
  }

  return result;
}
