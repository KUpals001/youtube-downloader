import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { spawn, spawnSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import {
  existsSync,
  readdirSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  statSync,
  createReadStream,
} from "fs";
import { randomUUID } from "crypto";

import {
  sanitize,
  cleanup,
  zipDir,
  rmDir,
  safeDisposition,
} from "@/lib/server-utils";
import { getMetadata } from "@/lib/metadata";
import { embedMetaWithFfmpeg, isAudioFileValid, getFfmpegPath } from "@/lib/ffmpeg";
import { parseYtdlpStderrBuffer } from "@/lib/ytdlp-progress";

/**
 * GET handler for downloading videos or audio.
 * Supports streaming responses with progress updates as NDJSON before switching to binary.
 * 
 * @param req - The Next.js request object.
 * @returns A streaming response.
 */
export async function GET(req: NextRequest): Promise<Response> {
  logger.log(
    "[download] Request received",
    req.nextUrl.searchParams.toString(),
  );
  const sp = req.nextUrl.searchParams;

  const url = sp.get("url")!;
  const mode = (sp.get("mode") ?? "video") as "video" | "audio";
  const quality = sp.get("quality") ?? "best";
  const ext = sp.get("ext") ?? (mode === "video" ? "mp4" : "mp3");
  const isPlaylist = sp.get("isPlaylist") === "true";
  const rmSponsor = sp.get("removeSponsor") === "true";
  const rmNonMusic = sp.get("removeNonMusic") === "true";
  const ytTitle = sp.get("title") ?? "download";
  const ytChannel = sp.get("channel") ?? "";
  const uploadDate = sp.get("uploadDate") ?? "";
  const addMetadata = sp.get("addMetadata") === "true";
  const mbId = sp.get("mbId") || undefined;
  const discogsId = sp.get("discogsId") || undefined;
  const deezerId = sp.get("deezerId") || undefined;
  const artistDelimiter = sp.get("artistDelimiter") || ", ";

  if (!url) return Response.json({ error: "URL required" }, { status: 400 });

  const safeTitle = sanitize(ytTitle);
  const args: string[] = ["--ignore-errors", "--remote-components", "ejs:github"];

  if (process.env.YTDLP_CACHE_DIR) {
    args.push("--cache-dir", process.env.YTDLP_CACHE_DIR);
  }

  if (mode === "video") {
    args.push(
      "-f",
      quality === "best"
        ? "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best"
        : `${quality}+bestaudio/${quality}/best`,
    );
    args.push("--merge-output-format", ext);
  } else {
    args.push("-f", quality === "best" ? "bestaudio/best" : quality);
    args.push("-x", "--audio-format", ext);
  }

  const sb: string[] = [];
  if (rmSponsor)
    sb.push(
      "sponsor",
      "selfpromo",
      "interaction",
      "intro",
      "outro",
      "preview",
      "filler",
    );
  if (rmNonMusic) sb.push("music_offtopic");
  if (sb.length) args.push("--sponsorblock-remove", sb.join(","));

  const ffmpegLocation = process.env.FFMPEG_LOCATION;
  if (ffmpegLocation) {
    args.push("--ffmpeg-location", ffmpegLocation);
  }

  if (!isPlaylist) {
    const tmpFile = join(tmpdir(), `ytdl-${randomUUID()}.${ext}`);
    args.push("--no-playlist", "-o", tmpFile, url);

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const sendJSON = async (obj: object): Promise<boolean> => {
      try {
        await writer.write(encoder.encode(JSON.stringify(obj) + "\n"));
        return true;
      } catch (err) {
        logger.error("[download] Failed to write to stream:", err);
        return false;
      }
    };

    const response = new Response(readable, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": safeDisposition(`${safeTitle}.${ext}`),
      },
    });

    (async () => {
      const errBuf: Buffer[] = [];
      let stderrTail = "";

      await sendJSON({ type: "start", message: "Download started" });
      await sendJSON({ type: "download", progress: 0 });

      const proc = spawn(process.env.YTDLP_PATH || "yt-dlp", args, {
        signal: req.signal,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
      proc.stderr.on("data", (c: Buffer) => {
        errBuf.push(c);
        const text = c.toString().replace(/\r/g, "\n");
        stderrTail += text;
        const lines = stderrTail.split("\n");
        stderrTail = lines.pop() ?? "";
        for (const line of lines) {
          if (
            line.includes("[ffmpeg]") ||
            line.includes("[ExtractAudio]") ||
            line.includes("[VideoConvertor]")
          ) {
            sendJSON({ type: "converting" }).catch(() => { });
          }
          for (const parsed of parseYtdlpStderrBuffer(line, false)) {
            if (parsed.type === "percent") {
              sendJSON({ type: "download", progress: parsed.progress }).catch(
                () => { },
              );
            }
          }
        }
      });

      await new Promise<void>((resolve, reject) => {
        proc.on("close", (code) => {
          if (req.signal.aborted) {
            resolve();
            return;
          }
          if (code !== 0 || !existsSync(tmpFile)) {
            const fullStderr = Buffer.concat(errBuf).toString();
            const msg =
              fullStderr
                .split("\n")
                .find((l) => l.includes("ERROR")) ?? "Download failed";
            cleanup(tmpFile);
            reject(new Error(msg));
            return;
          }
          resolve();
        });
        proc.on("error", (err) => reject(err));
      }).catch(async (err) => {
        await sendJSON({
          type: "error",
          message: err instanceof Error ? err.message : "Download failed",
        });
        await writer.close();
        cleanup(tmpFile);
        return;
      });

      if (req.signal.aborted) {
        cleanup(tmpFile);
        await writer.close();
        return;
      }

      if (mode === "audio" && !isAudioFileValid(tmpFile)) {
        cleanup(tmpFile);
        await sendJSON({
          type: "error",
          message: "Downloaded audio file is corrupted",
        });
        await writer.close();
        return;
      }

      let finalFile = tmpFile;

      if (mode === "audio" && addMetadata) {
        logger.log("[download] Fetching metadata for:", {
          ytTitle,
          ytChannel,
          uploadDate,
          mbId,
          discogsId,
          deezerId,
        });
        const meta = await getMetadata(
          ytTitle,
          ytChannel,
          uploadDate,
          mbId,
          discogsId,
          deezerId,
        );
        logger.log("[download] Metadata received:", meta);

        const taggedFile = join(
          tmpdir(),
          `ytdl-tagged-${randomUUID()}.${ext}`,
        );
        const ok = await embedMetaWithFfmpeg(
          tmpFile,
          taggedFile,
          ext,
          meta,
          req.signal,
          (progress) => {
            sendJSON({ type: "tagging", progress }).catch(() => { });
          },
          artistDelimiter,
        );

        if (ok && isAudioFileValid(taggedFile)) {
          const verify = spawnSync(getFfmpegPath("ffprobe"), [
            "-v",
            "error",
            "-show_entries",
            "format_tags",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            taggedFile,
          ]);
          logger.log(
            "[download] Tagged file tags:\n",
            verify.stdout.toString(),
          );
          cleanup(tmpFile);
          finalFile = taggedFile;
        } else {
          cleanup(taggedFile);
          if (!isAudioFileValid(tmpFile)) {
            cleanup(tmpFile);
            await sendJSON({
              type: "error",
              message: "Audio file invalid after tagging attempt",
            });
            await writer.close();
            return;
          }
          logger.log("[download] Tagging failed, keeping original");
        }
      }

      if (req.signal.aborted) {
        cleanup(finalFile);
        await writer.close();
        return;
      }

      const size = statSync(finalFile).size;
      await sendJSON({ type: "file", size });
      await writer.write(encoder.encode("\n"));

      const fileStream = createReadStream(finalFile);
      fileStream.on("data", (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        writer.write(buf).catch((err) => logger.error("[download] Write:", err));
      });
      fileStream.on("end", () => {
        writer.close();
        cleanup(finalFile);
      });
      fileStream.on("error", async (err) => {
        logger.error("[download] File stream error:", err);
        await sendJSON({ type: "error", message: err.message });
        await writer.close();
        cleanup(finalFile);
      });
    })();

    return response;
  }

  logger.log("[playlist] Starting playlist download for", url);
  const tmpDir = join(tmpdir(), `ytdl-pl-${randomUUID()}`);
  const zipPath = join(tmpdir(), `ytdl-zip-${randomUUID()}.zip`);
  mkdirSync(tmpDir, { recursive: true });

  if (mode === "audio" && addMetadata) {
    args.push("--write-info-json");
  }

  args.push("-o", join(tmpDir, "%(title)s.%(ext)s"), url);
  logger.log("[playlist] yt-dlp args:", args.join(" "));

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendJSON = async (obj: any): Promise<boolean> => {
    try {
      await writer.write(encoder.encode(JSON.stringify(obj) + "\n"));
      return true;
    } catch (err) {
      logger.error("[playlist] Failed to write to stream:", err);
      return false;
    }
  };

  let heartbeatInterval: NodeJS.Timeout | null = setInterval(() => {
    logger.log("[playlist] Sending heartbeat");
    sendJSON({ type: "heartbeat" }).catch(() => { });
  }, 5000);

  logger.log("[playlist] Spawning yt-dlp");
  const proc = spawn(process.env.YTDLP_PATH || "yt-dlp", args, {
    signal: req.signal,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  const errBuf: Buffer[] = [];
  const outBuf: Buffer[] = [];
  let stderrTail = "";
  let downloadCurrent = 0;
  let downloadTotal = 0;
  proc.stderr.on("data", (c: Buffer) => {
    errBuf.push(c);
    const text = c.toString().replace(/\r/g, "\n");
    stderrTail += text;
    const lines = stderrTail.split("\n");
    stderrTail = lines.pop() ?? "";
    for (const line of lines) {
      if (
        line.includes("[ffmpeg]") ||
        line.includes("[ExtractAudio]") ||
        line.includes("[VideoConvertor]")
      ) {
        sendJSON({ type: "converting" }).catch(() => { });
      }
      for (const parsed of parseYtdlpStderrBuffer(line, false)) {
        if (parsed.type === "item") {
          downloadCurrent = parsed.current;
          downloadTotal = parsed.total;
          sendJSON({
            type: "download",
            current: parsed.current,
            total: parsed.total,
            progress: (parsed.current - 1) / Math.max(1, parsed.total),
            currentItemProgress: 0,
          }).catch(() => { });
        } else if (parsed.type === "percent" && downloadTotal > 0) {
          const overall =
            (downloadCurrent - 1 + parsed.progress) / downloadTotal;
          sendJSON({
            type: "download",
            current: downloadCurrent,
            total: downloadTotal,
            progress: overall,
            currentItemProgress: parsed.progress,
          }).catch(() => { });
        } else if (parsed.type === "percent") {
          sendJSON({
            type: "download",
            progress: parsed.progress,
            currentItemProgress: parsed.progress,
          }).catch(() => { });
        }
      }
    }
  });
  proc.stdout.on("data", (c: Buffer) => outBuf.push(c));

  req.signal.addEventListener("abort", () => {
    logger.log("[playlist] Request aborted by client");
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    proc.kill();
    writer.close().catch(() => { });
    rmDir(tmpDir);
  });

  (async () => {
    await sendJSON({ type: "start", message: "Download started" });
    await sendJSON({ type: "download", progress: 0 });
  })();

  logger.log("[playlist] Returning streaming response to client");
  const response = new Response(readable, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": safeDisposition(`${safeTitle}.zip`),
    },
  });

  proc.on("close", async (code) => {
    logger.log("[playlist] yt-dlp process closed with code", code);

    const stderrOutput = Buffer.concat(errBuf).toString();
    const stdoutOutput = Buffer.concat(outBuf).toString();
    if (stderrOutput) {
      logger.error("[playlist] yt-dlp stderr:", stderrOutput);
    }
    if (stdoutOutput && code !== 0) {
      logger.error("[playlist] yt-dlp stdout:", stdoutOutput);
    }

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    const filesExist = existsSync(tmpDir) && readdirSync(tmpDir).length > 0;
    if (code !== 0 || !filesExist) {
      let errorMessage = "No files downloaded";

      if (stderrOutput) {
        const errorLines = stderrOutput
          .split("\n")
          .filter((line) =>
            line.includes("ERROR") ||
            line.includes("error") ||
            line.includes("Error") ||
            line.includes("WARNING") ||
            line.trim().length > 0
          );
        if (errorLines.length > 0) {
          const lastError = errorLines[errorLines.length - 1].trim();
          if (lastError) {
            errorMessage = lastError;
          }
        }
      }

      if (errorMessage === "No files downloaded" && code !== 0) {
        errorMessage = `yt-dlp exited with code ${code}. Check server logs for details.`;
      }

      logger.error("[playlist] Download failed:", errorMessage);
      await sendJSON({ type: "error", message: errorMessage });
      await writer.close();
      rmDir(tmpDir);
      return;
    }

    logger.log("[playlist] Files downloaded, proceeding to processing");

    if (!addMetadata) {
      logger.log("[playlist] No metadata tagging, zipping directly");
      try {
        zipDir(tmpDir, zipPath);
        logger.log("[playlist] Zip created at", zipPath);
        const stats = statSync(zipPath);
        await sendJSON({ type: "file", size: stats.size });
        await writer.write(encoder.encode("\n"));

        const fileStream = createReadStream(zipPath);
        fileStream.on("data", (chunk) => {
          writer
            .write(chunk)
            .catch((err) =>
              logger.error("[playlist] Error writing chunk:", err),
            );
        });
        fileStream.on("end", () => {
          logger.log("[playlist] Zip stream ended");
          writer.close();
          rmDir(tmpDir);
          cleanup(zipPath);
        });
        fileStream.on("error", async (err) => {
          logger.error("[playlist] Zip stream error:", err);
          await sendJSON({ type: "error", message: err.message });
          writer.close();
          rmDir(tmpDir);
          cleanup(zipPath);
        });
      } catch (e) {
        logger.error("[playlist] Zipping failed:", e);
        await sendJSON({
          type: "error",
          message: e instanceof Error ? e.message : "Unknown error",
        });
        await writer.close();
        rmDir(tmpDir);
      }
      return;
    }

    logger.log(
      "[playlist] Starting metadata tagging for",
      readdirSync(tmpDir).length,
      "files",
    );
    const allFiles = readdirSync(tmpDir);
    const audioFiles = allFiles.filter((f) => !f.endsWith(".info.json"));
    logger.log("[playlist] Audio files to process:", audioFiles);

    for (let i = 0; i < audioFiles.length; i++) {
      if (req.signal.aborted) {
        logger.log("[playlist] Client aborted, stopping processing");
        await writer.close();
        rmDir(tmpDir);
        return;
      }

      const file = audioFiles[i];
      const filePath = join(tmpDir, file);
      const fileExt = file.split(".").pop() ?? ext;

      logger.log(
        "[playlist] Processing file",
        i + 1,
        "of",
        audioFiles.length,
        ":",
        file,
      );
      await sendJSON({
        type: "progress",
        current: i + 1,
        total: audioFiles.length,
        title: file,
      });

      const baseName = file.slice(0, file.lastIndexOf("."));
      const infoPath = join(tmpDir, `${baseName}.info.json`);
      let trackTitle = baseName;
      let trackChannel = "";
      let trackDate = "";
      if (existsSync(infoPath)) {
        try {
          const info = JSON.parse(readFileSync(infoPath, "utf8"));
          trackTitle = info.title || baseName;
          trackChannel = info.uploader || info.channel || "";
          trackDate = info.upload_date || "";
        } catch (e) {
          logger.error("[playlist] Failed to parse info.json for", file, e);
        }
      }

      if (!isAudioFileValid(filePath)) {
        logger.warn("[playlist] Skipping invalid audio file:", file);
        continue;
      }

      logger.log("[playlist] Fetching metadata for:", trackTitle);
      const meta = await getMetadata(trackTitle, trackChannel, trackDate);
      logger.log("[playlist] Metadata obtained:", meta);

      const taggedPath = join(tmpDir, `tagged_${file}`);
      const ok = await embedMetaWithFfmpeg(
        filePath,
        taggedPath,
        fileExt,
        meta,
        req.signal,
        (tagProgress) => {
          sendJSON({
            type: "tagging",
            current: i + 1,
            total: audioFiles.length,
            progress: (i + tagProgress) / audioFiles.length,
            currentItemProgress: tagProgress,
          }).catch(() => { });
        },
        artistDelimiter,
      );

      if (ok && isAudioFileValid(taggedPath)) {
        try {
          unlinkSync(filePath);
          renameSync(taggedPath, filePath);
          logger.log("[playlist] Successfully tagged", file);
        } catch (e) {
          logger.error(
            "[playlist] Failed to replace file with tagged version:",
            e,
          );
          try {
            unlinkSync(taggedPath);
          } catch { }
        }
      } else {
        logger.warn(
          "[playlist] Tagging failed for:",
          file,
          "— keeping original",
        );
        try {
          unlinkSync(taggedPath);
        } catch { }
      }
    }

    for (const file of readdirSync(tmpDir)) {
      if (file.endsWith(".info.json")) {
        try {
          unlinkSync(join(tmpDir, file));
        } catch { }
      }
    }

    logger.log("[playlist] All files processed, creating zip");
    try {
      zipDir(tmpDir, zipPath);
      const stats = statSync(zipPath);
      logger.log("[playlist] Zip created, size:", stats.size);
      await sendJSON({ type: "file", size: stats.size });
      await writer.write(encoder.encode("\n"));

      const fileStream = createReadStream(zipPath);
      fileStream.on("data", (chunk) => {
        writer
          .write(chunk)
          .catch((err) =>
            logger.error("[playlist] Error writing chunk:", err),
          );
      });
      fileStream.on("end", () => {
        logger.log("[playlist] Zip stream ended, cleaning up");
        writer.close();
        rmDir(tmpDir);
        cleanup(zipPath);
      });
      fileStream.on("error", async (err) => {
        logger.error("[playlist] Zip stream error:", err);
        await sendJSON({ type: "error", message: err.message });
        writer.close();
        rmDir(tmpDir);
        cleanup(zipPath);
      });
    } catch (e) {
      logger.error("[playlist] Zipping failed:", e);
      await sendJSON({
        type: "error",
        message: e instanceof Error ? e.message : "Unknown error",
      });
      await writer.close();
      rmDir(tmpDir);
    }
  });

  proc.on("error", async (err) => {
    logger.error("[playlist] yt-dlp spawn error:", err);
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    await sendJSON({
      type: "error",
      message: `Failed to start yt-dlp: ${err.message}. Make sure yt-dlp is installed and accessible.`
    });
    await writer.close();
    rmDir(tmpDir);
  });

  return response;
}
