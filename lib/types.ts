/**
 * Media format information (e.g., resolution, bitrate, codecs).
 */
export interface Format {
  format_id: string;
  ext: string;
  height?: number;
  fps?: number;
  abr?: number;
  vcodec?: string;
  acodec?: string;
}

/**
 * Individual entry in a playlist or search result.
 */
export interface Entry {
  id: string;
  title: string;
  thumbnail?: string;
  duration?: number;
  url?: string;
}

/**
 * Comprehensive information about a video or playlist.
 */
export interface MediaInfo {
  isPlaylist: boolean;
  id: string;
  title: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  uploadDate?: string;
  formats: Format[];
  entryCount?: number;
  entries?: Entry[];
}
