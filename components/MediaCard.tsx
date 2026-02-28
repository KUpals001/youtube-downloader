"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Checkbox } from "./ui/Checkbox";
import { Select } from "./ui/Select";
import { ProgressBar, DlState } from "./ui/ProgressBar";
import { MetadataPreviewCard, MetadataPreview } from "./MetadataPreviewCard";
import { fmtDur } from "@/lib/client-utils";
import { MediaInfo, Format } from "@/lib/types";

const VIDEO_EXTS = ["mp4", "mkv", "webm"];
const AUDIO_EXTS = ["mp3", "m4a", "flac", "wav", "ogg"];

const PREFS_KEY = "ytdl-prefs";

interface Prefs {
  mode: "video" | "audio";
  videoExt: string;
  audioExt: string;
  rmSponsor: boolean;
  rmMusic: boolean;
  addMetadata: boolean;
  artistDelimiter: string;
}

const DEFAULT_PREFS: Prefs = {
  mode: "video",
  videoExt: "mp4",
  audioExt: "mp3",
  rmSponsor: false,
  rmMusic: false,
  addMetadata: false,
  artistDelimiter: ", ",
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch { }
}

interface MediaCardProps {
  info: MediaInfo;
  dlState: DlState;
  onDownload: (options: {
    mode: "video" | "audio";
    quality: string;
    ext: string;
    rmSponsor: boolean;
    rmMusic: boolean;
    addMetadata: boolean;
    manualId?: string;
    idType?: "discogs" | "musicbrainz" | "deezer";
    artistDelimiter?: string;
    mbId?: string;
    discogsId?: string;
    deezerId?: string;
    overrideUrl?: string;
    overrideTitle?: string;
    _t: number;
  }) => void;
  onDismissProgress: () => void;
}

/**
 * MediaCard component displaying fetched media information and download options.
 * Handles both individual video and playlist modes.
 * 
 * @param props - Component props.
 * @returns Media card element.
 */
export function MediaCard({
  info,
  dlState,
  onDownload,
  onDismissProgress,
}: MediaCardProps) {
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [mode, setMode] = useState<"video" | "audio">(DEFAULT_PREFS.mode);
  const [videoQ, setVideoQ] = useState("best");
  const [audioQ, setAudioQ] = useState("best");
  const [videoExt, setVideoExt] = useState(DEFAULT_PREFS.videoExt);
  const [audioExt, setAudioExt] = useState(DEFAULT_PREFS.audioExt);
  const [rmSponsor, setRmSponsor] = useState(DEFAULT_PREFS.rmSponsor);
  const [rmMusic, setRmMusic] = useState(DEFAULT_PREFS.rmMusic);
  const [addMetadata, setAddMetadata] = useState(DEFAULT_PREFS.addMetadata);

  const [mbId, setMbId] = useState("");
  const [discogsId, setDiscogsId] = useState("");
  const [deezerId, setDeezerId] = useState("");
  const [artistDelimiter, setArtistDelimiter] = useState(DEFAULT_PREFS.artistDelimiter);
  const [previewMeta, setPreviewMeta] = useState<MetadataPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  /** URL of the playlist entry currently being downloaded individually */
  const [activeEntryUrl, setActiveEntryUrl] = useState<string | null>(null);

  useEffect(() => {
    const p = loadPrefs();
    setMode(p.mode);
    setVideoExt(p.videoExt);
    setAudioExt(p.audioExt);
    setRmSponsor(p.rmSponsor);
    setRmMusic(p.rmMusic);
    setAddMetadata(p.addMetadata);
    setArtistDelimiter(p.artistDelimiter ?? ", ");
    setPrefsLoaded(true);
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    savePrefs({
      mode,
      videoExt,
      audioExt,
      rmSponsor,
      rmMusic,
      addMetadata,
      artistDelimiter,
    });
  }, [
    prefsLoaded,
    mode,
    videoExt,
    audioExt,
    rmSponsor,
    rmMusic,
    addMetadata,
    artistDelimiter,
  ]);

  useEffect(() => {
    setPreviewMeta(null);
    setMbId("");
    setDiscogsId("");
    setDeezerId("");
  }, [info.id]);

  // Clear active entry URL only when the download finishes or fails.
  // Deliberately NOT clearing on 'idle' to avoid a race where the state
  // hasn't switched to 'active' yet when the effect fires.
  useEffect(() => {
    if (dlState.status === "done" || dlState.status === "error") {
      setActiveEntryUrl(null);
    }
  }, [dlState.status]);

  const videoOpts = info
    ? [
      { label: "Best Available", value: "best" },
      ...info.formats
        .filter(
          (f): f is Format & { height: number } =>
            (f.height ?? 0) > 0 && !!f.vcodec && f.vcodec !== "none",
        )
        .reduce(
          (acc: Array<{ label: string; value: string; h: number }>, f) => {
            const lbl = `${f.height}p${(f.fps ?? 0) > 30 ? f.fps : ""}`;
            if (!acc.find((a) => a.label === lbl))
              acc.push({ label: lbl, value: f.format_id, h: f.height });
            return acc;
          },
          [],
        )
        .sort((a, b) => b.h - a.h),
    ]
    : [];

  const audioOpts = info
    ? [
      { label: "Best Available", value: "best" },
      ...info.formats
        .filter(
          (f): f is Format & { abr: number } =>
            (f.abr ?? 0) > 0 &&
            (!f.vcodec || f.vcodec === "none") &&
            !!f.acodec &&
            f.acodec !== "none",
        )
        .reduce(
          (acc: Array<{ label: string; value: string; kbps: number }>, f) => {
            const kbps = Math.round(f.abr);
            const lbl = `${kbps} kbps`;
            if (!acc.find((a) => a.label === lbl))
              acc.push({ label: lbl, value: f.format_id, kbps });
            return acc;
          },
          [],
        )
        .sort((a, b) => b.kbps - a.kbps),
    ]
    : [];

  const checkMetadata = async () => {
    if (info.isPlaylist) return;
    setPreviewLoading(true);
    setPreviewMeta(null);
    try {
      const params = new URLSearchParams({
        title: info.title,
        channel: info.uploader || "",
        uploadDate: info.uploadDate || "",
        ...(mbId ? { mbId } : {}),
        ...(discogsId ? { discogsId } : {}),
        ...(deezerId ? { deezerId } : {}),
      });
      const res = await fetch(`/api/metadata?${params}`);
      if (!res.ok) throw new Error("Failed to fetch metadata");
      const data = await res.json();
      setPreviewMeta(data);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      alert("Metadata check failed: " + errorMessage);
    } finally {
      setPreviewLoading(false);
    }
  };

  const ext = mode === "video" ? videoExt : audioExt;

  const handleMainDownload = () => {
    onDownload({
      mode,
      quality: mode === "video" ? videoQ : audioQ,
      ext,
      rmSponsor,
      rmMusic,
      addMetadata,
      ...(addMetadata && mbId ? { mbId } : {}),
      ...(addMetadata && discogsId ? { discogsId } : {}),
      ...(addMetadata && deezerId ? { deezerId } : {}),
      artistDelimiter: addMetadata ? artistDelimiter : undefined,
      _t: Date.now(),
    });
  };

  const handleEntryDownload = (entryUrl: string, entryTitle: string) => {
    setActiveEntryUrl(entryUrl);
    onDownload({
      mode,
      quality: mode === "video" ? videoQ : audioQ,
      ext,
      rmSponsor,
      rmMusic,
      addMetadata,
      ...(addMetadata && mbId ? { mbId } : {}),
      ...(addMetadata && discogsId ? { discogsId } : {}),
      ...(addMetadata && deezerId ? { deezerId } : {}),
      artistDelimiter: addMetadata ? artistDelimiter : undefined,
      overrideUrl: entryUrl,
      overrideTitle: entryTitle,
      _t: Date.now(),
    });
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 overflow-hidden">
      <div className="flex gap-4 p-5 pb-4">
        {info.thumbnail && (
          <div className="flex-shrink-0 w-32 sm:w-48 relative aspect-video">
            <Image
              src={info.thumbnail}
              alt={info.title}
              fill
              className="object-cover rounded-xl bg-gray-100 dark:bg-zinc-800"
              unoptimized
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100 line-clamp-2 leading-snug">
            {info.title}
          </p>
          {info.uploader && (
            <p className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
              {info.uploader}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {info.duration && (
              <span className="text-xs bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 px-2 py-0.5 rounded-md">
                {fmtDur(info.duration)}
              </span>
            )}
            {info.isPlaylist && (
              <span className="text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-md font-medium">
                Playlist · {info.entryCount} videos
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100 dark:border-zinc-800 p-5 space-y-4">
        <div className="flex bg-gray-100 dark:bg-zinc-800 rounded-xl p-1 w-fit">
          {(["video", "audio"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-5 py-1.5 rounded-lg text-sm font-medium transition-all capitalize cursor-pointer ${mode === m
                ? "bg-white dark:bg-zinc-700 text-gray-900 dark:text-zinc-100 shadow-sm"
                : "text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200"
                }`}
            >
              {m === "video" ? "🎬 Video" : "🎵 Audio"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select
            label="Quality"
            value={mode === "video" ? videoQ : audioQ}
            onChange={mode === "video" ? setVideoQ : setAudioQ}
            options={mode === "video" ? videoOpts : audioOpts}
          />
          <Select
            label="Format"
            value={mode === "video" ? videoExt : audioExt}
            onChange={mode === "video" ? setVideoExt : setAudioExt}
            options={(mode === "video" ? VIDEO_EXTS : AUDIO_EXTS).map((e) => ({
              label: `.${e}`,
              value: e,
            }))}
          />
        </div>

        <div className="rounded-xl bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-700/50 p-4 space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-1">
            SponsorBlock
          </p>
          <Checkbox
            label="Remove Ads & Sponsorships"
            checked={rmSponsor}
            onChange={() => setRmSponsor((v) => !v)}
          />
          <Checkbox
            label="Remove Non-Music Sections"
            checked={rmMusic}
            onChange={() => setRmMusic((v) => !v)}
          />
        </div>

        {!info.isPlaylist && mode === "audio" && (
          <div className="rounded-xl bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-700/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-3">
              Manual Metadata Settings
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-zinc-400 w-28 shrink-0">MusicBrainz</span>
                <input
                  type="text"
                  value={mbId}
                  onChange={(e) => setMbId(e.target.value)}
                  placeholder="Release MBID or URL"
                  className="flex-1 bg-gray-100 dark:bg-zinc-700 border border-gray-200 dark:border-zinc-600 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-zinc-400 w-28 shrink-0">Discogs</span>
                <input
                  type="text"
                  value={discogsId}
                  onChange={(e) => setDiscogsId(e.target.value)}
                  placeholder="Release ID or URL"
                  className="flex-1 bg-gray-100 dark:bg-zinc-700 border border-gray-200 dark:border-zinc-600 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-zinc-400 w-28 shrink-0">Deezer</span>
                <input
                  type="text"
                  value={deezerId}
                  onChange={(e) => setDeezerId(e.target.value)}
                  placeholder="Track ID or URL"
                  className="flex-1 bg-gray-100 dark:bg-zinc-700 border border-gray-200 dark:border-zinc-600 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <label className="text-xs text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                Artist delimiter
              </label>
              <input
                type="text"
                value={artistDelimiter}
                onChange={(e) => setArtistDelimiter(e.target.value)}
                placeholder=", "
                className="w-20 bg-gray-100 dark:bg-zinc-700 border border-gray-200 dark:border-zinc-600 rounded-lg px-3 py-1.5 text-sm font-mono"
              />
              <span className="text-xs text-gray-400 dark:text-zinc-500">
                between multiple artists
              </span>
            </div>
          </div>
        )}

        {!info.isPlaylist && mode === "audio" && (
          <div className="flex items-center gap-3">
            <Checkbox
              label="Add metadata from MusicBrainz/Discogs"
              checked={addMetadata}
              onChange={() => setAddMetadata((v) => !v)}
            />
            {addMetadata && (
              <p className="text-xs text-gray-500">
                Metadata will be fetched automatically (or use the manual IDs
                above).
              </p>
            )}
          </div>
        )}

        {!info.isPlaylist && mode === "audio" && (
          <div className="space-y-3">
            <button
              onClick={checkMetadata}
              disabled={previewLoading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {previewLoading ? "Checking…" : "🔍 Check Metadata"}
            </button>
            {previewMeta && (
              <MetadataPreviewCard meta={previewMeta} artistDelimiter={artistDelimiter} />
            )}
          </div>
        )}

        {info.isPlaylist && mode === "audio" && (
          <div className="rounded-xl bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-700/50 p-4">
            <Checkbox
              label="Add metadata to songs (slower, may be rate-limited)"
              checked={addMetadata}
              onChange={() => setAddMetadata((v) => !v)}
            />
          </div>
        )}

        <button
          onClick={handleMainDownload}
          disabled={dlState.status === "active"}
          className="w-full bg-red-600 hover:bg-red-700 active:scale-[.98] disabled:opacity-60 disabled:cursor-not-allowed
                     text-white font-semibold rounded-xl py-3 text-sm transition-all
                     flex items-center justify-center gap-2 shadow-sm shadow-red-200 dark:shadow-none cursor-pointer"
        >
          {dlState.status === "active" ? (
            <>
              <svg
                className="w-4 h-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"
                />
              </svg>
              Downloading…
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              {info.isPlaylist
                ? `Download Playlist (.zip)`
                : `Download ${mode === "video" ? "Video" : "Audio"} (.${ext})`}
            </>
          )}
        </button>

        <ProgressBar state={dlState} onDismiss={onDismissProgress} />
      </div>

      {info.isPlaylist && info.entries && info.entries.length > 0 && (
        <div className="border-t border-gray-100 dark:border-zinc-800">
          <p className="px-5 pt-4 pb-2 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-zinc-500">
            Entries
          </p>
          <ul className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:gap-2 px-5 pb-5">
            {info.entries.map((e, i) => {
              // Is this entry the one being downloaded individually?
              const isSingleActive = activeEntryUrl === e.url && dlState.status === "active";
              // Is this entry being processed during a full-playlist download?
              const isPlaylistActive =
                !activeEntryUrl &&
                dlState.status === "active" &&
                dlState.currentIndex === i + 1;
              const isRowActive = isSingleActive || isPlaylistActive;
              const rowProgress = isSingleActive
                ? dlState.progress
                : isPlaylistActive
                  ? dlState.currentItemProgress ?? 0
                  : 0;
              const rowPhase = dlState.phase;

              return (
                <li
                  key={e.id ?? i}
                  className={`flex flex-col gap-1.5 p-2 rounded-lg transition ${isRowActive
                    ? "bg-red-50 dark:bg-red-900/10"
                    : "hover:bg-gray-50 dark:hover:bg-zinc-800/60 group"
                    }`}
                >
                  <div className="flex items-center gap-3">
                    {e.thumbnail && (
                      <div className="w-16 aspect-video relative flex-shrink-0 bg-gray-100 dark:bg-zinc-800 rounded-md overflow-hidden">
                        <Image
                          src={e.thumbnail}
                          alt={e.title}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${isRowActive ? "text-red-700 dark:text-red-400 font-medium" : "text-gray-800 dark:text-zinc-200"
                        }`}>
                        {e.title}
                      </p>
                      {e.duration && (
                        <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                          {fmtDur(e.duration)}
                        </p>
                      )}
                    </div>
                    {e.url && (
                      <button
                        onClick={() => handleEntryDownload(e.url!, e.title)}
                        disabled={dlState.status === "active"}
                        className={`flex-shrink-0 transition text-white text-xs font-medium px-3 py-1.5 rounded-lg ${isSingleActive
                          ? "bg-red-500 opacity-100 cursor-not-allowed"
                          : dlState.status === "active"
                            ? "bg-gray-400 dark:bg-zinc-600 opacity-40 cursor-not-allowed"
                            : "opacity-0 group-hover:opacity-100 bg-red-600 hover:bg-red-700"
                          }`}
                      >
                        {isSingleActive ? (
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                          </svg>
                        ) : "↓"}
                      </button>
                    )}
                  </div>
                  {/* Inline progress bar for this entry */}
                  {isRowActive && (
                    <div className="flex items-center gap-2 px-0.5">
                      <div className="flex-1 h-1 bg-red-100 dark:bg-red-900/30 rounded-full overflow-hidden">
                        {rowProgress <= 0.01 || rowPhase === "converting" ? (
                          <div
                            className="h-full w-1/3 bg-red-500 rounded-full"
                            style={{ animation: "indeterminate 1.4s ease-in-out infinite" }}
                          />
                        ) : (
                          <div
                            className="h-full bg-red-500 rounded-full transition-all duration-200"
                            style={{ width: `${Math.round(rowProgress * 100)}%` }}
                          />
                        )}
                      </div>
                      <span className="text-xs text-red-600 dark:text-red-400 shrink-0 tabular-nums">
                        {rowPhase === "converting"
                          ? "Converting…"
                          : rowPhase === "tagging"
                            ? `Tagging ${Math.round(rowProgress * 100)}%`
                            : rowPhase === "zipping"
                              ? "Zipping"
                              : rowProgress <= 0.01
                                ? "Downloading…"
                                : `Downloading ${Math.round(rowProgress * 100)}%`}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
