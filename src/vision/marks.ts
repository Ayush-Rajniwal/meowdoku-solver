import { distance, pixel } from "./image.ts";
import type { PixelImage, Rgb } from "./image.ts";
import type { CellRect } from "./grid.ts";

export type CellMark = "empty" | "cross" | "cat";
/** Game-specific face detector: dark fur plus white face/eyes; X marks have no dark fur. */
export function detectMark(
  image: PixelImage,
  cell: CellRect,
  background: Rgb,
): CellMark {
  let dark = 0,
    white = 0,
    unexpected = 0,
    total = 0;
  const step = Math.max(1, Math.floor(cell.width / 60));
  for (
    let y = cell.y + Math.ceil(cell.height * 0.12);
    y < cell.y + cell.height * 0.9;
    y += step
  ) {
    for (
      let x = cell.x + Math.ceil(cell.width * 0.12);
      x < cell.x + cell.width * 0.9;
      x += step
    ) {
      const color = pixel(image, x, y);
      const max = Math.max(...color),
        min = Math.min(...color);
      total++;
      const isDark = max < 110 && max - min < 45;
      const isWhite = min > 230;
      if (isDark) dark++;
      if (isWhite) white++;
      if (!isDark && !isWhite && distance(color, background) > 35) unexpected++;
    }
  }
  const darkRatio = dark / total,
    whiteRatio = white / total;
  if (darkRatio >= 0.1 && whiteRatio >= 0.025 && darkRatio < 0.7) return "cat";
  if (darkRatio > 0.015 || unexpected / total > 0.075) {
    throw new Error(
      "Unrecognized cell contents; capture a settled, unobscured board",
    );
  }
  if (whiteRatio >= 0.08) return "cross";
  if (whiteRatio > 0.015) throw new Error("Partial mark or animation detected");
  return "empty";
}
