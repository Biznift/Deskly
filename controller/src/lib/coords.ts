/** Map pointer inside a video (object-fit: contain) to normalized 0–1. */
export function videoNormCoords(
  videoEl: HTMLVideoElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = videoEl.getBoundingClientRect();
  const vw = videoEl.videoWidth || 1;
  const vh = videoEl.videoHeight || 1;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const contentW = vw * scale;
  const contentH = vh * scale;
  const offsetX = rect.left + (rect.width - contentW) / 2;
  const offsetY = rect.top + (rect.height - contentH) / 2;
  const x = (clientX - offsetX) / contentW;
  const y = (clientY - offsetY) / contentH;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}
