/**
 * Represents progress for a single item in a series (e.g., "3 of 15").
 */
export interface YtdlpItemProgress {
  type: "item";
  current: number;
  total: number;
}

/**
 * Represents progress as a percentage (0..1).
 */
export interface YtdlpPercentProgress {
  type: "percent";
  progress: number;
}

/**
 * Combined type for different yt-dlp progress formats.
 */
export type YtdlpProgress = YtdlpItemProgress | YtdlpPercentProgress;

const RE_ITEM =
  /\[download\]\s+Downloading\s+(?:video|item|playlist\s+item)\s+(\d+)\s+of\s+(\d+)/i;
const RE_PERCENT = /\[download\]\s+(\d+(?:\.\d+)?)\s*%/;
const RE_PERCENT_LOOSE = /(?:\[download\]|download).*?(\d+(?:\.\d+)?)\s*%/i;
const RE_FRAG = /\[download\].*\(frag\s+(\d+)\/(\d+)\)/;

/**
 * Parses a single line from yt-dlp stderr for progress information.
 * Supports item counts, percentages, and fragment progress.
 * 
 * @param line - The line to parse.
 * @returns Parsed progress object or null if no progress found.
 */
export function parseYtdlpStderrLine(line: string): YtdlpProgress | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const itemMatch = trimmed.match(RE_ITEM);
  if (itemMatch) {
    const current = parseInt(itemMatch[1], 10);
    const total = parseInt(itemMatch[2], 10);
    if (current >= 1 && total >= 1) return { type: "item", current, total };
  }

  let percentMatch = trimmed.match(RE_PERCENT);
  if (!percentMatch) percentMatch = trimmed.match(RE_PERCENT_LOOSE);
  if (percentMatch) {
    const pct = parseFloat(percentMatch[1]) / 100;
    return { type: "percent", progress: Math.min(1, Math.max(0, pct)) };
  }

  const fragMatch = trimmed.match(RE_FRAG);
  if (fragMatch) {
    const current = parseInt(fragMatch[1], 10);
    const total = parseInt(fragMatch[2], 10);
    if (total > 0) return { type: "percent", progress: current / total };
  }

  return null;
}

/**
 * Consumes a buffer of stderr data and yields parsed progress items.
 * 
 * @param buffer - Raw buffer data.
 * @param stripCarriageReturn - Whether to replace \r with \n.
 * @returns Generator yielding YtdlpProgress items.
 */
export function* parseYtdlpStderrBuffer(
  buffer: string,
  stripCarriageReturn = true,
): Generator<YtdlpProgress> {
  const text = stripCarriageReturn ? buffer.replace(/\r/g, "\n") : buffer;
  const lines = text.split("\n");
  for (const line of lines) {
    const parsed = parseYtdlpStderrLine(line);
    if (parsed) yield parsed;
  }
}
