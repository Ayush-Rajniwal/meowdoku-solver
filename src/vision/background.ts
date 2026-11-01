import { distance, isColored, pixel } from "./image.ts";
import type { PixelImage, Rgb } from "./image.ts";
import type { CellRect } from "./grid.ts";

export interface BackgroundSample {
  readonly rgb: Rgb;
  readonly agreement: number;
}
/** Samples outer corner patches, clear of cat ears, whiskers, and X strokes. */
export function sampleBackground(
  image: PixelImage,
  cell: CellRect,
): BackgroundSample {
  const samples: Rgb[] = [];
  for (const [x0, x1] of [
    [0.08, 0.18],
    [0.82, 0.92],
  ] as const) {
    for (const [y0, y1] of [
      [0.08, 0.18],
      [0.82, 0.92],
    ] as const) {
      for (
        let y = cell.y + Math.ceil(cell.height * y0);
        y < cell.y + cell.height * y1;
        y += 2
      ) {
        for (
          let x = cell.x + Math.ceil(cell.width * x0);
          x < cell.x + cell.width * x1;
          x += 2
        ) {
          samples.push(pixel(image, x, y));
        }
      }
    }
  }
  const bins = new Map<string, Rgb[]>();
  for (const color of samples) {
    if (!isColored(color)) continue;
    const key = color.map((v) => Math.round(v / 8)).join(",");
    const bin = bins.get(key) ?? [];
    bin.push(color);
    bins.set(key, bin);
  }
  const dominant = [...bins.values()].sort((a, b) => b.length - a.length)[0];
  if (!dominant) throw new Error("Cell background is not recognizable");
  const median = (channel: number) =>
    dominant.map((c) => c[channel]!).sort((a, b) => a - b)[
      Math.floor(dominant.length / 2)
    ]!;
  const rgb: Rgb = [median(0), median(1), median(2)];
  const agreement =
    samples.filter((color) => distance(color, rgb) <= 18).length /
    samples.length;
  if (agreement < 0.72)
    throw new Error("Cell corners are obscured or animated");
  return { rgb, agreement };
}

/** Labels equal colors, retaining the same ID for disconnected parts of a region. */
export function classifyRegions(
  samples: readonly (readonly BackgroundSample[])[],
): {
  regions: number[][];
  palette: Rgb[];
} {
  const palette: Rgb[] = [];
  const regions = samples.map((row) =>
    row.map(({ rgb }) => {
      const distances = palette.map((color) => distance(color, rgb));
      const closest = Math.min(...distances);
      if (closest <= 22) return distances.indexOf(closest);
      if (closest < 32)
        throw new Error("Two cell colors are too similar to classify reliably");
      palette.push(rgb);
      return palette.length - 1;
    }),
  );
  return { regions, palette };
}
