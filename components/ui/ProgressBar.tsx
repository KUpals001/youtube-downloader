"use client";

export type DlPhase = "downloading" | "converting" | "tagging" | "zipping";

export interface DlState {
  status: "idle" | "active" | "done" | "error";
  progress: number;
  indeterminate: boolean;
  error: string;
  filename: string;
  statusText?: string;
  /** Current item index (1-based), e.g. song 3 of 15 */
  currentIndex?: number;
  /** Total items (songs/videos) */
  totalCount?: number;
  /** Phase: downloading (yt-dlp), tagging (ffmpeg), zipping */
  phase?: DlPhase;
  /** Progress of the current item only (0..1), e.g. 45% of current song */
  currentItemProgress?: number;
}

interface ProgressBarProps {
  state: DlState;
  onDismiss: () => void;
}

/**
 * Progress bar component for displaying download and processing status.
 * Supports percentages, indeterminate states, and status text.
 * 
 * @param props - Component props.
 * @returns Progress bar element.
 */
export function ProgressBar({ state, onDismiss }: ProgressBarProps) {
  if (state.status === "idle") return null;

  const done = state.status === "done";
  const err = state.status === "error";
  const pct = Math.round(state.progress * 100);
  const currentItemPct =
    state.currentItemProgress != null
      ? Math.round(state.currentItemProgress * 100)
      : null;
  const hasCount =
    state.currentIndex != null &&
    state.totalCount != null &&
    state.totalCount > 0;
  const phaseLabel =
    state.phase === "downloading"
      ? "Downloading"
      : state.phase === "converting"
        ? "Converting"
        : state.phase === "tagging"
          ? "Tagging"
          : state.phase === "zipping"
            ? "Zipping"
            : null;

  return (
    <div
      className={`rounded-xl border px-4 py-3 transition-all ${err
        ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
        : done
          ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
          : "bg-gray-50 dark:bg-zinc-800/80 border-gray-100 dark:border-zinc-700"
        }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {state.status === "active" && (
            <svg
              className="w-3.5 h-3.5 animate-spin text-red-500 flex-shrink-0"
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
          )}
          {done && (
            <svg
              className="w-3.5 h-3.5 text-green-600 flex-shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
          {err && (
            <svg
              className="w-3.5 h-3.5 text-red-500 flex-shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          )}
          <span
            className={`text-xs font-medium truncate ${err
              ? "text-red-600 dark:text-red-400"
              : done
                ? "text-green-700 dark:text-green-400"
                : "text-gray-700 dark:text-zinc-300"
              }`}
          >
            {err
              ? state.error
              : done
                ? `Saved — ${state.filename}`
                : (() => {
                  if (state.indeterminate && !hasCount && currentItemPct == null)
                    return state.statusText || "Preparing…";
                  const parts: string[] = [];
                  if (phaseLabel) parts.push(phaseLabel);
                  if (hasCount)
                    parts.push(`${state.currentIndex}/${state.totalCount}`);
                  if (currentItemPct != null)
                    parts.push(`(${currentItemPct}% of current)`);
                  if (pct > 0 && (hasCount || state.phase === "zipping"))
                    parts.push(`— ${pct}% total`);
                  return parts.length
                    ? parts.join(" ")
                    : state.statusText || "Preparing…";
                })()}
          </span>
        </div>
        {(done || err) && (
          <button
            onClick={onDismiss}
            className="ml-2 flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 transition"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
      <div className="h-1.5 bg-gray-200 dark:bg-zinc-700 rounded-full overflow-hidden">
        {state.indeterminate ? (
          <div
            className="h-full w-1/3 bg-red-500 rounded-full"
            style={{ animation: "indeterminate 1.4s ease-in-out infinite" }}
          />
        ) : (
          <div
            className={`h-full rounded-full transition-all duration-200 ${err ? "bg-red-500" : done ? "bg-green-500" : "bg-red-500"
              }`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <style>{`@keyframes indeterminate{0%{transform:translateX(-100%) scaleX(.5)}50%{transform:translateX(100%) scaleX(1)}100%{transform:translateX(300%) scaleX(.5)}}`}</style>
    </div>
  );
}
