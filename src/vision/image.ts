import { PNG } from "pngjs";
export type Rgb = readonly [number, number, number];
export interface PixelImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}
export function decodeScreenshot(png: Buffer): PixelImage {
  const image = PNG.sync.read(png);
  if (image.width * image.height > 25_000_000)
    throw new Error("Screenshot is too large");
  return image;
}
export function pixel(image: PixelImage, x: number, y: number): Rgb {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height)
    throw new Error("Pixel outside image");
  const offset = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return [
    image.data[offset]!,
    image.data[offset + 1]!,
    image.data[offset + 2]!,
  ];
}
export function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
export function isColored([r, g, b]: Rgb): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) > 25 && r + g + b > 240;
}
