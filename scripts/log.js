/**
 * Console logging with a module prefix. Debug output is controlled by the "debug" client setting
 * so troubleshooting information can be switched on without editing code.
 */
import { MODULE_ID } from "./constants.js";

const PREFIX = `${MODULE_ID} |`;

function debugEnabled() {
  try {
    return game.settings.get(MODULE_ID, "debug");
  } catch {
    return true;
  }
}

export const log = {
  /** Verbose output, only when the debug setting is on. */
  debug(...args) {
    if (debugEnabled()) console.debug(PREFIX, ...args);
  },
  info(...args) {
    console.log(PREFIX, ...args);
  },
  warn(...args) {
    console.warn(PREFIX, ...args);
  },
  error(...args) {
    console.error(PREFIX, ...args);
  }
};
