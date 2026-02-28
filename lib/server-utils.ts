import { logger } from "@/lib/logger";
import {
  unlinkSync,
  writeFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  createReadStream,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MIME_MAP } from "./client-utils";
import AdmZip from "adm-zip";

/**
 * Sanitizes a filename by replacing illegal characters with underscores.
 * 
 * @param name - The filename to sanitize.
 * @returns Sanitized filename.
 */
export function sanitize(name: string): string {
  return name
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Synchronously deletes a file. Fails silently.
 * 
 * @param path - Path to the file.
 */
export function cleanup(path: string) {
  try {
    unlinkSync(path);
  } catch { }
}

/**
 * Synchronously deletes a directory and its contents. Fails silently.
 * 
 * @param dir - Path to the directory.
 */
export function rmDir(dir: string) {
  try {
    const files = readdirSync(dir);
    for (const f of files) {
      const fullPath = join(dir, f);
      unlinkSync(fullPath);
    }
    rmdirSync(dir);
  } catch { }
}

/**
 * Writes content to a debug file in the temp directory.
 * 
 * @param name - Name identifier for the debug file.
 * @param content - Text or object to write.
 */
export function debugWrite(name: string, content: string | object) {
  const filePath = join(tmpdir(), `ytdl-debug-${name}-${Date.now()}.txt`);
  const text =
    typeof content === "string" ? content : JSON.stringify(content, null, 2);
  writeFileSync(filePath, text);
  logger.log(`[DEBUG] Wrote: ${filePath}`);
}

/**
 * Creates a safe Content-Disposition header value for a filename.
 * 
 * @param filename - The filename to use.
 * @returns Encoded Content-Disposition string.
 */
export function safeDisposition(filename: string) {
  const ascii = filename.replace(/[^\x00-\x7F]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Streams a file as a Web Response. Handles cleanup on completion or error.
 * 
 * @param filePath - Path to the file on disk.
 * @param ext - File extension for MIME type lookup.
 * @param filename - Filename for Content-Disposition.
 * @param signal - Optional AbortSignal.
 * @returns Web Response object.
 */
export function streamFile(
  filePath: string,
  ext: string,
  filename: string,
  signal?: AbortSignal,
): Response {
  const size = statSync(filePath).size;
  const nodeStream = createReadStream(filePath);
  const mime = MIME_MAP[ext] ?? "application/octet-stream";

  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        nodeStream.destroy();
        cleanup(filePath);
      },
      { once: true },
    );
  }

  const webStream = new ReadableStream({
    start(ctrl) {
      nodeStream.on("data", (chunk: string | Buffer) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        ctrl.enqueue(new Uint8Array(buffer));
      });
      nodeStream.on("end", () => {
        ctrl.close();
        cleanup(filePath);
      });
      nodeStream.on("error", (e) => {
        ctrl.error(e);
        cleanup(filePath);
      });
    },
    cancel() {
      nodeStream.destroy();
      cleanup(filePath);
    },
  });

  return new Response(webStream, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": safeDisposition(filename),
      "Content-Length": String(size),
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

/**
 * Compresses all files in a directory into a ZIP archive.
 * 
 * @param dir - Source directory.
 * @param zipPath - Output ZIP file path.
 */
export function zipDir(dir: string, zipPath: string): void {
  const files = readdirSync(dir);
  if (files.length === 0) throw new Error("No files downloaded");
  const zip = new AdmZip();
  for (const f of files) zip.addLocalFile(join(dir, f));
  zip.writeZip(zipPath);
}

export { MIME_MAP };
