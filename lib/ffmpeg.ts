import { logger } from "@/lib/logger";
import { spawn, spawnSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { writeFileSync, unlinkSync } from "fs";

/**
 * Utility to get the path to ffmpeg or ffprobe binaries.
 * Checks FFMPEG_LOCATION environment variable first.
 * 
 * @param bin - The binary name ("ffmpeg" or "ffprobe").
 * @returns The full path to the binary.
 */
export function getFfmpegPath(bin: "ffmpeg" | "ffprobe"): string {
  const loc = process.env.FFMPEG_LOCATION;
  if (!loc) return bin;
  const name = process.platform === "win32" ? `${bin}.exe` : bin;
  return join(loc, name);
}

/**
 * Metadata for a music track.
 */
export interface TrackMeta {
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
 * Validates if an audio file can be read and has a duration.
 * 
 * @param filePath - Path to the audio file.
 * @returns True if valid, false otherwise.
 */
export function isAudioFileValid(filePath: string): boolean {
  const result = spawnSync(getFfmpegPath("ffprobe"), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  return result.status === 0 && result.stdout.toString().trim().length > 0;
}

/**
 * Gets the duration of an audio file in seconds.
 * 
 * @param filePath - Path to the audio file.
 * @returns Duration in seconds, or null if unavailable.
 */
export function getDuration(filePath: string): number | null {
  const result = spawnSync(getFfmpegPath("ffprobe"), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  if (result.status !== 0) return null;
  const s = result.stdout.toString().trim();
  const d = parseFloat(s);
  return Number.isFinite(d) && d > 0 ? d : null;
}

/**
 * Embeds metadata and album art into an audio file using ffmpeg.
 * 
 * @param input - Path to the input file.
 * @param output - Path to the output file.
 * @param ext - File extension (e.g., "mp3").
 * @param meta - Track metadata to embed.
 * @param signal - Optional AbortSignal to cancel the process.
 * @param onProgress - Optional callback for progress updates (0 to 1).
 * @param artistDelimiter - Delimiter used for joining multiple artists.
 * @returns Promise resolving to true if successful.
 */
export async function embedMetaWithFfmpeg(
  input: string,
  output: string,
  ext: string,
  meta: TrackMeta,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
  artistDelimiter: string = ", ",
): Promise<boolean> {
  const inputs: string[] = ["-i", input];
  const outputOptions: string[] = ["-c:a", "copy", "-loglevel", "error"];
  if (onProgress) {
    outputOptions.push("-progress", "pipe:1");
    outputOptions.push("-nostats");
  }

  if (ext === "mp3") {
    outputOptions.push("-id3v2_version", "3");
    outputOptions.push("-write_id3v2", "1");
  }

  if (meta.title) outputOptions.push("-metadata", `title=${meta.title}`);
  if (meta.artist) {
    const artistTag = meta.artist
      .split(", ")
      .map((a) => a.trim())
      .filter(Boolean)
      .join(artistDelimiter);
    outputOptions.push("-metadata", `artist=${artistTag}`);
  }
  if (meta.album) outputOptions.push("-metadata", `album=${meta.album}`);
  if (meta.year) outputOptions.push("-metadata", `date=${meta.year}`);
  if (meta.trackNumber)
    outputOptions.push("-metadata", `track=${meta.trackNumber}`);
  if (meta.discNumber)
    outputOptions.push("-metadata", `disc=${meta.discNumber}`);
  if (meta.albumArtist)
    outputOptions.push("-metadata", `album_artist=${meta.albumArtist}`);
  if (meta.genre) outputOptions.push("-metadata", `genre=${meta.genre}`);

  let coverPath: string | undefined;

  if (meta.coverUrl && ext === "mp3") {
    coverPath = join(tmpdir(), `cover-${randomUUID()}.jpg`);
    try {
      const res = await fetch(meta.coverUrl);
      if (!res.ok) throw new Error(`Cover fetch failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(coverPath, buf);
      inputs.push("-i", coverPath);
      outputOptions.push("-map", "0", "-map", "1", "-c:v", "mjpeg");
      outputOptions.push("-metadata:s:v", 'title="Album cover"');
      outputOptions.push("-metadata:s:v", 'comment="Cover (front)"');
    } catch (err) {
      logger.error("[ffmpeg] Cover download error:", err);
      if (coverPath) {
        try {
          unlinkSync(coverPath);
        } catch { }
      }
      coverPath = undefined;
    }
  }

  const args = ["-y", ...inputs, ...outputOptions, output];
  logger.log("[ffmpeg] full args:", args.join(" "));

  const durationSec = onProgress ? getDuration(input) : null;
  const durationUs = durationSec != null && durationSec > 0 ? durationSec * 1e6 : 0;

  return new Promise((resolve) => {
    const proc = spawn(getFfmpegPath("ffmpeg"), args, {
      signal,
      stdio: onProgress ? ["pipe", "pipe", "pipe"] : undefined,
    });
    let stderr = "";
    let progressBuffer = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (!onProgress) logger.error("[ffmpeg stderr]", chunk.toString());
    });
    if (onProgress && proc.stdout) {
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        progressBuffer += chunk;
        const lines = progressBuffer.split("\n");
        progressBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const m = line.match(/^out_time_ms=(\d+)$/);
          if (m && durationUs > 0) {
            const outUs = parseInt(m[1], 10);
            const p = Math.min(1, Math.max(0, outUs / durationUs));
            onProgress(p);
          }
        }
      });
    }
    proc.on("close", (code) => {
      if (coverPath) {
        try {
          unlinkSync(coverPath);
        } catch { }
      }
      if (code !== 0) {
        logger.error("[ffmpeg] failed with code", code, "stderr:", stderr);
      }
      resolve(code === 0);
    });
  });
}
