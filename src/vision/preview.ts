import { PNG } from "pngjs";
import type { PixelImage, Rgb } from "./image.ts";
import type { ParsedScreen } from "./parser.ts";
import type { TapAction } from "../levels/play-plan.ts";

/** Diagnostic overlay only. Blue = detected cells; green = targets; yellow = existing cats. */
export function renderPreview(
  image: PixelImage,
  parsed: ParsedScreen,
  actions: readonly TapAction[],
): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data.set(image.data);
  function paint(x: number, y: number, color: Rgb): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
    const p = (y * image.width + x) * 4;
    png.data[p] = color[0];
    png.data[p + 1] = color[1];
    png.data[p + 2] = color[2];
    png.data[p + 3] = 255;
  }
  for (const row of parsed.grid.cells)
    for (const cell of row) {
      for (let x = cell.x; x < cell.x + cell.width; x++)
        for (let t = 0; t < 2; t++) {
          paint(x, cell.y + t, [0, 100, 255]);
          paint(x, cell.y + cell.height - 1 - t, [0, 100, 255]);
        }
      for (let y = cell.y; y < cell.y + cell.height; y++)
        for (let t = 0; t < 2; t++) {
          paint(cell.x + t, y, [0, 100, 255]);
          paint(cell.x + cell.width - 1 - t, y, [0, 100, 255]);
        }
    }
  const targets = [
    ...actions.map((p) => ({ ...p, color: [0, 220, 80] as Rgb })),
    ...(parsed.puzzle.fixedCats ?? []).map((p) => ({
      ...parsed.cellCenters[p.row]![p.col]!,
      color: [255, 210, 0] as Rgb,
    })),
  ];
  const radius = Math.max(6, Math.round(parsed.grid.cells[0]![0]!.width * 0.3));
  for (const target of targets) {
    for (let angle = 0; angle < Math.PI * 2; angle += 1 / (radius * 3))
      for (let t = 0; t < 3; t++) {
        paint(
          target.x + (radius + t) * Math.cos(angle),
          target.y + (radius + t) * Math.sin(angle),
          target.color,
        );
      }
  }
  return PNG.sync.write(png);
}
