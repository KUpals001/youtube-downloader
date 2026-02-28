/**
 * Formats duration in seconds to a human-readable string (H:MM:SS or M:SS).
 * 
 * @param s - Duration in seconds.
 * @returns Formatted time string.
 */
export function fmtDur(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Simplifies yt-dlp error messages for display.
 * 
 * @param msg - The raw error message.
 * @returns A simplified error message.
 */
export function simplifyError(msg: string): string {
  if (
    /Incomplete YouTube ID|Unable to extract|unavailable|is not a valid URL|Unsupported URL|no video formats/i.test(
      msg,
    )
  )
    return "No video found";
  return (
    msg.replace(/^ERROR:\s*(\[[^\]]+\]\s*[^:]*:\s*)/, "").trim() ||
    "No video found"
  );
}

/**
 * Mapping of file extensions to MIME types.
 */
export const MIME_MAP: Record<string, string> = {
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  zip: "application/zip",
};

/**
 * Cleans a YouTube title for metadata searching and extracts potential artists.
 * 
 * @param title - The YouTube video title.
 * @returns Object containing cleaned artist, track, and featured artists.
 */
export function cleanForMetadataSearch(title: string): {
  artist: string;
  track: string;
  featuredArtists: string[];
} {
  const featuredArtists: string[] = [];
  const featMatch = title.match(
    /\s*(?:ft\.?|feat\.?|featuring)\.?\s+([^–—|([]+?)(?:\s*[([–—|]|$)/i,
  );
  if (featMatch) {
    featuredArtists.push(
      ...featMatch[1]
        .split(/\s*,\s*|\s*&\s*|\s*\+\s*/)
        .map((n) => n.trim())
        .filter(Boolean),
    );
  }

  const cleaned = title
    .replace(
      /\s*\([^)]*(official|music\s*video|lyric\s*video|audio|visualizer|hd|hq|4k|remaster(ed)?|live|version|explicit|clean|mono|stereo)[^)]*\)\s*/gi,
      "",
    )
    .replace(
      /\s*\[[^\]]*(official|music\s*video|lyric\s*video|audio|visualizer|hd|hq|4k|remaster(ed)?|live|version|explicit|clean|mono|stereo)[^\]]*\]\s*/gi,
      "",
    )
    .replace(/\s*(ft\.?|feat\.?|featuring)\.?\s+[^–—-]+$/i, "")
    .replace(
      /\s*[–—|]\s*(official\s*(music\s*)?video|lyric\s*video|audio|visualizer|hd|hq|remastered|live|version|explicit).*$/i,
      "",
    )
    .replace(/\s*[–—|]\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();

  const separators = [" - ", " – ", " — ", " | ", ": "];
  for (const sep of separators) {
    const parts = cleaned.split(sep);
    if (parts.length >= 2) {
      return {
        artist: parts[0].trim(),
        track: parts.slice(1).join(sep).trim(),
        featuredArtists,
      };
    }
  }
  return { artist: "", track: cleaned, featuredArtists };
}

/**
 * Scores a candidate track title against a target title (0..1).
 * 
 * @param candidate - The candidate title.
 * @param target - The target title.
 * @returns A similarity score.
 */
export function trackScore(candidate: string, target: string): number {
  const a = candidate.toLowerCase();
  const b = target.toLowerCase();
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;

  const wa = new Set(a.split(/\s+/));
  const wb = new Set(b.split(/\s+/));
  const intersection = [...wb].filter((x) => wa.has(x)).length;
  let score = intersection / Math.max(wa.size, wb.size);

  const noAccents = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (
    noAccents(a).includes(noAccents(b)) ||
    noAccents(b).includes(noAccents(a))
  ) {
    score = Math.max(score, 0.75);
  }
  return score;
}

/**
 * Normalizes a string for search comparisons (accents, quotes, etc.).
 * 
 * @param s - The string to normalize.
 * @returns Normalized lowercase string.
 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[‐‒–—―]/g, "-")
    .replace(/['’‘]/g, "'")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Generates cleaned metadata fallback from YouTube-specific information.
 * 
 * @param ytTitle - YouTube video title.
 * @param ytChannel - YouTube channel name.
 * @returns Cleaned metadata object.
 */
export function getCleanedFallback(
  ytTitle: string,
  ytChannel: string,
): {
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
} {
  const { artist: cleanedArtist, track: cleanedTrack, featuredArtists } =
    cleanForMetadataSearch(ytTitle);
  const primaryArtist =
    cleanedArtist ||
    ytChannel.replace(/ - Topic$|VEVO|Official|Channel/i, "").trim() ||
    "Unknown Artist";
  const allArtists =
    featuredArtists.length > 0
      ? [primaryArtist, ...featuredArtists].join(", ")
      : primaryArtist;
  const finalTrack =
    cleanedTrack ||
    ytTitle.replace(/\s*\([^)]*\)|\s*\[[^\]]*\]/g, "").trim() ||
    "Unknown Track";
  return {
    title: finalTrack,
    artist: allArtists,
    album: "",
    year: "",
    trackNumber: "",
    discNumber: "",
    albumArtist: primaryArtist,
    composer: "",
    genre: "",
    coverUrl: undefined,
  };
}
