import type { PixelImage } from "./image.ts";

export interface CellRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface DetectedGrid {
  readonly size: number;
  readonly cells: readonly (readonly CellRect[])[];
}

/** Finds isolated colored squares. White gutters and white X marks are background. */
function coloredSquares(image: PixelImage): CellRect[] {
  const { width, height, data } = image;
  const count = width * height;
  const mask = new Uint8Array(count);
  const queue = new Int32Array(count);
  for (let p = 0; p < count; p++) {
    const i = p * 4;
    const r = data[i]!,
      g = data[i + 1]!,
      b = data[i + 2]!;
    mask[p] =
      Math.max(r, g, b) - Math.min(r, g, b) > 25 &&
      r + g + b > 240 &&
      data[i + 3]! > 240
        ? 1
        : 0;
  }
  const squares: CellRect[] = [];
  function push(p: number, end: number): number {
    if (mask[p] === 1) {
      mask[p] = 0;
      queue[end++] = p;
    }
    return end;
  }
  for (let p = 0; p < count; p++) {
    if (mask[p] !== 1) continue;
    let start = 0,
      end = 1;
    queue[0] = p;
    mask[p] = 0;
    let left = width,
      right = 0,
      top = height,
      bottom = 0;
    while (start < end) {
      const current = queue[start++]!;
      const x = current % width,
        y = Math.floor(current / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      if (x > 0) end = push(current - 1, end);
      if (x + 1 < width) end = push(current + 1, end);
      if (y > 0) end = push(current - width, end);
      if (y + 1 < height) end = push(current + width, end);
    }
    const w = right - left + 1,
      h = bottom - top + 1;
    if (
      w >= width / 40 &&
      h >= width / 40 &&
      w <= width * 0.49 &&
      w / h >= 0.85 &&
      w / h <= 1.18 &&
      end / (w * h) >= 0.35
    ) {
      squares.push({ x: left, y: top, width: w, height: h });
    }
  }
  return squares;
}
function centerX(cell: CellRect): number {
  return cell.x + (cell.width - 1) / 2;
}
function centerY(cell: CellRect): number {
  return cell.y + (cell.height - 1) / 2;
}
function regular(values: number[], cellSize: number): boolean {
  if (values.length < 2) return false;
  const step = (values.at(-1)! - values[0]!) / (values.length - 1);
  if (step < cellSize * 1.01 || step > cellSize * 1.35) return false;
  return values.every(
    (value, i) => Math.abs(value - (values[0]! + step * i)) <= cellSize * 0.06,
  );
}

/** Requires a complete, evenly spaced square lattice. Does not infer missing cells. */
export function detectGrid(image: PixelImage): DetectedGrid {
  const components = coloredSquares(image);
  const candidates = new Map<string, DetectedGrid>();
  const triedSizes: number[] = [];
  for (const seed of components) {
    const size = (seed.width + seed.height) / 2;
    if (triedSizes.some((s) => Math.abs(s - size) < Math.max(2, size * 0.04)))
      continue;
    triedSizes.push(size);
    const tolerance = Math.max(3, size * 0.08);
    const similar = components.filter(
      (c) =>
        Math.abs(c.width - size) <= tolerance &&
        Math.abs(c.height - size) <= tolerance,
    );
    const rows: CellRect[][] = [];
    for (const cell of similar.sort((a, b) => centerY(a) - centerY(b))) {
      const row = rows.at(-1);
      if (row && Math.abs(centerY(cell) - centerY(row[0]!)) < size * 0.12)
        row.push(cell);
      else rows.push([cell]);
    }
    for (const row of rows) row.sort((a, b) => centerX(a) - centerX(b));
    for (const first of rows) {
      const n = first.length;
      if (n < 2 || !regular(first.map(centerX), size)) continue;
      const aligned = rows.filter(
        (row) =>
          row.length === n &&
          row.every(
            (cell, c) =>
              Math.abs(centerX(cell) - centerX(first[c]!)) < size * 0.08,
          ) &&
          regular(row.map(centerX), size),
      );
      for (let offset = 0; offset + n <= aligned.length; offset++) {
        const cells = aligned.slice(offset, offset + n);
        if (
          !regular(
            cells.map((row) => centerY(row[0]!)),
            size,
          )
        )
          continue;
        const key =
          n +
          ":" +
          Math.round(centerX(cells[0]![0]!)) +
          ":" +
          Math.round(centerY(cells[0]![0]!));
        candidates.set(key, { size: n, cells });
      }
    }
  }
  if (candidates.size !== 1) {
    throw new Error(
      candidates.size === 0
        ? "No complete puzzle grid found; screen may be obscured, animated, or unsupported"
        : "Multiple puzzle grids found; refusing to guess",
    );
  }
  return [...candidates.values()][0]!;
}
