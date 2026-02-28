"use client";

interface UrlInputProps {
  url: string;
  setUrl: (url: string) => void;
  status: "idle" | "loading" | "success" | "error";
  errorMsg: string;
}

/**
 * Component for URL input field with loading and error states.
 * 
 * @param props - Component props.
 * @returns URL input element.
 */
export function UrlInput({ url, setUrl, status, errorMsg }: UrlInputProps) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 p-5">
      <label className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-2 block">
        YouTube URL
      </label>
      <input
        type="url"
        placeholder="https://youtube.com/watch?v=… or playlist"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-600"
      />
      <div className="mt-2 h-5 flex items-center">
        {status === "loading" && (
          <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
            <svg
              className="w-3 h-3 animate-spin"
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
            Loading…
          </span>
        )}
        {status === "error" && (
          <span className="text-xs text-red-500 truncate">{errorMsg}</span>
        )}
      </div>
    </div>
  );
}
