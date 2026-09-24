const isMac = navigator.userAgent.includes('Mac OS');

/** Formats a main-process shortcut (Ctrl on Windows/Linux, Cmd on macOS) for hints. */
export function formatShortcut(key: string) {
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}
