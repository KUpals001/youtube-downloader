/**
 * Simple logger that only outputs if DEBUG or NEXT_PUBLIC_DEBUG is set to 'true'.
 */
export const logger = {
  /** Logs standard messages. */
  log: (...args: any[]) => {
    if (process.env.DEBUG === 'true' || process.env.NEXT_PUBLIC_DEBUG === 'true') {
      console.log(...args);
    }
  },
  /** Logs warning messages. */
  warn: (...args: any[]) => {
    if (process.env.DEBUG === 'true' || process.env.NEXT_PUBLIC_DEBUG === 'true') {
      console.warn(...args);
    }
  },
  /** Logs error messages. */
  error: (...args: any[]) => {
    if (process.env.DEBUG === 'true' || process.env.NEXT_PUBLIC_DEBUG === 'true') {
      console.error(...args);
    }
  },
  /** Logs informational messages. */
  info: (...args: any[]) => {
    if (process.env.DEBUG === 'true' || process.env.NEXT_PUBLIC_DEBUG === 'true') {
      console.info(...args);
    }
  },
  /** Logs debug messages. */
  debug: (...args: any[]) => {
    if (process.env.DEBUG === 'true' || process.env.NEXT_PUBLIC_DEBUG === 'true') {
      console.debug(...args);
    }
  },
};
