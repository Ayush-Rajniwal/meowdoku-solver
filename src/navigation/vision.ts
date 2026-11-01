import { PNG } from "pngjs";
import { decodeScreenshot, pixel } from "../vision/image.ts";
import type { PixelImage } from "../vision/image.ts";
export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function overlayVisible(image: PixelImage): boolean {
  const values = [
    [0.03, 0.12],
    [0.97, 0.12],
    [0.5, 0.025],
  ]
    .map(([x, y]) => {
      const c = pixel(image, image.width * x!, image.height * y!);
      return (c[0] + c[1] + c[2]) / 3;
    })
    .sort((a, b) => a - b);
  return values[1]! >= 16 && values[1]! <= 115;
}
export function orangeButton(image: PixelImage): Rectangle | undefined {
  const bands: { start: number; end: number }[] = [];
  let active: { start: number; end: number } | undefined;
  for (let y = Math.floor(image.height * 0.6); y < image.height * 0.88; y++) {
    let count = 0;
    for (let x = Math.floor(image.width * 0.1); x < image.width * 0.9; x += 2) {
      const [r, g, b] = pixel(image, x, y);
      if (r > 170 && g > 70 && g < 190 && b < 90 && r - g > 40 && g - b > 40)
        count += 2;
    }
    if (count > image.width * 0.4) {
      if (!active) {
        const previous = bands.at(-1);
        if (previous && y - previous.end <= image.height * 0.007) {
          active = previous;
          active.end = y;
        } else {
          active = { start: y, end: y };
          bands.push(active);
        }
      } else active.end = y;
    } else active = undefined;
  }
  const candidates = bands.filter(
    (b) =>
      b.end - b.start > image.height * 0.025 &&
      b.end - b.start < image.height * 0.12,
  );
  if (candidates.length !== 1) return undefined;
  const band = candidates[0]!,
    cy = Math.round((band.start + band.end) / 2);
  const xs: number[] = [];
  for (let x = 0; x < image.width; x++) {
    const [r, g, b] = pixel(image, x, cy);
    if (r > 170 && g > 70 && g < 190 && b < 90 && r - g > 40 && g - b > 40)
      xs.push(x);
  }
  if (!xs.length) return undefined;
  return {
    x: xs[0]!,
    y: band.start,
    width: xs.at(-1)! - xs[0]! + 1,
    height: band.end - band.start + 1,
  };
}
export function fractionRect(
  image: PixelImage,
  left: number,
  top: number,
  right: number,
  bottom: number,
): Rectangle {
  return {
    x: Math.round(image.width * left),
    y: Math.round(image.height * top),
    width: Math.round(image.width * (right - left)),
    height: Math.round(image.height * (bottom - top)),
  };
}
/** Converts only the expected text color into black ink on a padded white image. */
export function textMask(
  image: PixelImage,
  rect: Rectangle,
  kind: "white" | "yellow" | "dark",
): Buffer {
  const out = new PNG({ width: rect.width + 24, height: rect.height + 24 });
  out.data.fill(255);
  for (let y = 0; y < rect.height; y++)
    for (let x = 0; x < rect.width; x++) {
      const [r, g, b] = pixel(image, rect.x + x, rect.y + y);
      const ink =
        kind === "white"
          ? r > 210 && g > 200 && b > 170
          : kind === "yellow"
            ? r > 180 && g > 150 && b < 170
            : r + g + b < 90;
      const i = ((y + 12) * out.width + x + 12) * 4;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = ink ? 0 : 255;
    }
  return PNG.sync.write(out);
}
export { decodeScreenshot };
