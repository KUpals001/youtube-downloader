"use client";

import Image from "next/image";

export interface MetadataPreview {
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
  source: string;
}

const SOURCE_LABELS: Record<string, string> = {
  musicbrainz: "MusicBrainz",
  discogs: "Discogs",
  deezer: "Deezer",
  youtube: "YouTube",
};

function formatSourceLabel(source: string): string {
  return source
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => SOURCE_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1))
    .join(", ");
}

/**
 * Apply the user's chosen delimiter to a comma-joined artist string.
 * Cache always stores artists as "A, B, C"; here we re-join with the
 * display delimiter before rendering.
 */
function applyArtistDelimiter(artist: string, delimiter: string): string {
  if (!artist || delimiter === ", ") return artist;
  return artist
    .split(", ")
    .map((a) => a.trim())
    .filter(Boolean)
    .join(delimiter);
}

/**
 * Component for displaying a preview of track metadata.
 * 
 * @param props - Component props.
 * @returns Metadata preview card element.
 */
export function MetadataPreviewCard({
  meta,
  artistDelimiter = ", ",
}: {
  meta: MetadataPreview;
  artistDelimiter?: string;
}) {
  const displayArtist = applyArtistDelimiter(meta.artist, artistDelimiter);

  return (
    <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm">
      <div className="flex items-start gap-4">
        {meta.coverUrl && (
          <div className="w-16 h-16 relative flex-shrink-0">
            <Image
              src={meta.coverUrl}
              alt="cover"
              fill
              className="object-cover rounded-lg shadow-sm"
              unoptimized
            />
          </div>
        )}
        <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1">
          <div>
            <span className="text-red-600 dark:text-red-400 font-medium">
              Title:
            </span>{" "}
            {meta.title}
          </div>
          <div>
            <span className="text-red-600 dark:text-red-400 font-medium">
              Artist:
            </span>{" "}
            {displayArtist}
          </div>
          <div>
            <span className="text-red-600 dark:text-red-400 font-medium">
              Album:
            </span>{" "}
            {meta.album || "—"}
          </div>
          <div>
            <span className="text-red-600 dark:text-red-400 font-medium">
              Year:
            </span>{" "}
            {meta.year || "—"}
          </div>
          <div>
            <span className="text-red-600 dark:text-red-400 font-medium">
              Track:
            </span>{" "}
            {meta.trackNumber || "—"}
          </div>
          <div>
            <span className="text-red-600 dark:text-red-400 font-medium">
              Genre:
            </span>{" "}
            {meta.genre || "—"}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-red-500 dark:text-red-300">
        Sources: {formatSourceLabel(meta.source)}
      </p>
    </div>
  );
}
