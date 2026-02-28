import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { Entry, MediaInfo } from "@/lib/types";

/**
 * Best-quality thumbnail we can reliably get without an extra request.
 * 
 * @param id - YouTube video ID.
 * @returns Thumbnail URL.
 */
function ytThumb(id: string) {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

interface YtDlpFormat {
  format_id: string;
  ext: string;
  height?: number;
  fps?: number;
  abr?: number;
  vcodec?: string;
  acodec?: string;
}

interface YtDlpVideo {
  id: string;
  title?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  upload_date?: string;
  formats?: YtDlpFormat[];
  webpage_url?: string;
  url?: string;
  _type?: string;
  entries?: YtDlpVideo[];
}

/**
 * GET handler for fetching media information using yt-dlp.
 * 
 * @param req - The Next.js request object.
 * @returns Response containing MediaInfo.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return Response.json({ error: "URL required" }, { status: 400 });

  return new Promise<Response>((resolve) => {
    const proc = spawn(process.env.YTDLP_PATH || "yt-dlp", ["-J", "--flat-playlist", url]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    proc.stdout.on("data", (c: Buffer) => out.push(c));
    proc.stderr.on("data", (c: Buffer) => err.push(c));

    proc.on("close", (code) => {
      const raw = Buffer.concat(out).toString().trim();
      if (code !== 0 || !raw) {
        const msg = Buffer.concat(err).toString();
        resolve(
          Response.json(
            { error: msg || "Failed to fetch info" },
            { status: 500 },
          ),
        );
        return;
      }
      try {
        const data: YtDlpVideo = JSON.parse(raw);
        const isPlaylist = data._type === "playlist";

        if (isPlaylist) {
          const entries: Entry[] = (data.entries ?? []).map((e) => ({
            id: e.id,
            title: e.title ?? e.id,
            thumbnail: e.thumbnail ?? (e.id ? ytThumb(e.id) : undefined),
            duration: e.duration,
            url:
              e.url ??
              e.webpage_url ??
              (e.id ? `https://www.youtube.com/watch?v=${e.id}` : undefined),
          }));

          const playlistInfo: MediaInfo = {
            isPlaylist: true,
            id: data.id,
            title: data.title ?? "Untitled playlist",
            thumbnail: data.thumbnail ?? entries[0]?.thumbnail,
            formats: [],
            entryCount: entries.length,
            entries,
          };
          resolve(Response.json(playlistInfo));
        } else {
          const videoInfo: MediaInfo = {
            isPlaylist: false,
            id: data.id,
            title: data.title ?? "Untitled video",
            thumbnail:
              data.thumbnail ?? (data.id ? ytThumb(data.id) : undefined),
            duration: data.duration,
            uploader: data.uploader,
            uploadDate: data.upload_date,
            formats: (data.formats ?? []).map((f) => ({
              format_id: f.format_id,
              ext: f.ext,
              height: f.height,
              fps: f.fps,
              abr: f.abr,
              vcodec: f.vcodec,
              acodec: f.acodec,
            })),
          };
          resolve(Response.json(videoInfo));
        }
      } catch {
        resolve(
          Response.json({ error: "Failed to parse info" }, { status: 500 }),
        );
      }
    });

    proc.on("error", () => {
      resolve(
        Response.json(
          { error: "yt-dlp not found — install with: pip install yt-dlp" },
          { status: 500 },
        ),
      );
    });
  });
}
