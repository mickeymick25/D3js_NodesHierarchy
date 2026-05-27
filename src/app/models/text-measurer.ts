// ─────────────────────────────────────────────────────────────────────────────
// TextMeasurer — Canvas-based text measurement to avoid getBBox() layout thrashing
// P10 — Pre-calcul des badges
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uses an off-screen canvas to measure text width, avoiding synchronous layout
 * reflows caused by SVGElement.getBBox(). Results are cached for O(1) lookups.
 *
 * Impact: ~100 getBBox() calls eliminated per render for a site with 50 links,
 * and ~50 getBBox() calls eliminated per simulation tick.
 */

let canvasCtx: CanvasRenderingContext2D | null = null;

function getCanvasContext(): CanvasRenderingContext2D {
  if (!canvasCtx) {
    const canvas = document.createElement("canvas");
    canvasCtx = canvas.getContext("2d")!;
  }
  return canvasCtx;
}

export interface TextMetrics {
  /** Measured text width in pixels */
  width: number;
  /** Estimated line height (fontSize × 1.2) */
  height: number;
}

const cache = new Map<string, TextMetrics>();

/**
 * Measures text dimensions using an off-screen canvas.
 * Results are cached by (fontWeight, fontSize, text) key.
 */
export function measureText(
  text: string,
  fontSize: number,
  fontWeight: string = "700",
): TextMetrics {
  const key = `${fontWeight}|${fontSize}|${text}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const ctx = getCanvasContext();
  ctx.font = `${fontWeight} ${fontSize}px sans-serif`;
  const width = ctx.measureText(text).width;

  const result: TextMetrics = {
    width,
    height: fontSize * 1.2,
  };

  cache.set(key, result);
  return result;
}

/**
 * Computes rect dimensions for a badge where text is centered at the origin.
 * Assumes text-anchor: "middle" and dy: "0.35em".
 *
 * @param paddingX Horizontal padding around text (e.g., 4 for 4px each side)
 * @param paddingY Vertical padding around text (e.g., 2 for 2px each side)
 */
export function computeCenteredBadgeRect(
  text: string,
  fontSize: number,
  fontWeight: string = "700",
  paddingX: number = 4,
  paddingY: number = 2,
): { x: number; y: number; width: number; height: number } {
  const metrics = measureText(text, fontSize, fontWeight);
  return {
    x: -(metrics.width / 2 + paddingX),
    y: -(metrics.height / 2 + paddingY),
    width: metrics.width + 2 * paddingX,
    height: metrics.height + 2 * paddingY,
  };
}

/**
 * Computes rect dimensions for a SIGMPR-style tag where text is centered
 * at a specific (textX, textY) position with text-anchor: "middle".
 *
 * @param textX Text x position (usually 0 for centered tags)
 * @param textY Text y position (e.g., NODE_RADIUS[type] + 32)
 */
export function computeCenteredTagRect(
  text: string,
  fontSize: number,
  fontWeight: string,
  textX: number,
  textY: number,
  paddingX: number,
  paddingY: number,
): { x: number; y: number; width: number; height: number } {
  const metrics = measureText(text, fontSize, fontWeight);
  // For text-anchor: "middle" at (textX, textY), the text center is at (textX, textY)
  // The bbox origin is approximately at (textX - width/2, textY - fontSize*0.65)
  const bboxX = textX - metrics.width / 2;
  const bboxY = textY - fontSize * 0.65;
  return {
    x: bboxX - paddingX,
    y: bboxY - paddingY,
    width: metrics.width + 2 * paddingX,
    height: metrics.height + 2 * paddingY,
  };
}

/**
 * Computes rect dimensions for a tag where text uses text-anchor: "start"
 * at a specific (textX, textY) position.
 */
export function computeStartAnchorTagRect(
  text: string,
  fontSize: number,
  fontWeight: string,
  textX: number,
  textY: number,
  paddingX: number,
  paddingY: number,
): { x: number; y: number; width: number; height: number } {
  const metrics = measureText(text, fontSize, fontWeight);
  // For text-anchor: "start" at (textX, textY), baseline is at textY
  // The bbox origin is approximately at (textX, textY - fontSize*0.8)
  const bboxY = textY - fontSize * 0.8;
  return {
    x: textX - paddingX,
    y: bboxY - paddingY,
    width: metrics.width + 2 * paddingX,
    height: metrics.height + 2 * paddingY,
  };
}
