import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition } from "@tauri-apps/api/dpi";

const OVERLAY_LABEL = "session-overlay";
const OVERLAY_WIDTH = 460;
const OVERLAY_HEIGHT = 72;

/**
 * Persistent always-on-top "Being controlled" bar with Disconnect.
 * Host must always be able to kill the session (Phase 6).
 */
export async function showSessionOverlay(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(OVERLAY_LABEL);
  if (existing) {
    await existing.show();
    await existing.setAlwaysOnTop(true);
    await existing.setFocus();
    return;
  }

  const monitor = await currentMonitor();
  const scale = monitor?.scaleFactor ?? 1;
  const screenW = monitor ? monitor.size.width / scale : 1280;
  const x = Math.round((screenW - OVERLAY_WIDTH) / 2);
  const y = 16;

  const overlay = new WebviewWindow(OVERLAY_LABEL, {
    url: "overlay.html",
    title: "Deskly Session",
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    x,
    y,
    decorations: false,
    // Solid window (not transparent) so macOS DMG builds stay reliable.
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    focus: true,
    visible: true,
    shadow: true,
  });

  overlay.once("tauri://error", (e) => {
    console.error("overlay window error", e);
  });

  // Re-assert top-most after create (Windows can drop it during share).
  try {
    await overlay.setAlwaysOnTop(true);
    await overlay.setPosition(new LogicalPosition(x, y));
  } catch {
    /* window may still be creating */
  }

  // Keep main window accessible too
  try {
    await getCurrentWindow().show();
  } catch {
    /* ignore */
  }
}

export async function hideSessionOverlay(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(OVERLAY_LABEL);
  if (existing) {
    try {
      await existing.close();
    } catch (err) {
      console.warn("close overlay failed", err);
    }
  }
}
