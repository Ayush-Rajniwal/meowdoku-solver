import { PSM } from "tesseract.js";
import { createLocalOcrWorker } from "./ocr-worker.ts";
import { decodeScreenshot } from "./image.ts";
export type LevelHeader =
  { kind: "numbered"; number: number } | { kind: "golden-fish" };
export interface HeaderReader {
  read(png: Buffer): Promise<LevelHeader>;
  close(): Promise<void>;
}
/** OCR stays local: engine, worker, and English language data are npm dependencies. */
export async function createHeaderReader(): Promise<HeaderReader> {
  const worker = await createLocalOcrWorker();
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  return {
    async read(png) {
      const image = decodeScreenshot(png);
      async function text(left: number, right: number) {
        return (
          await worker.recognize(png, {
            rectangle: {
              left: Math.round(image.width * left),
              top: Math.round(image.height * 0.035),
              width: Math.round(image.width * (right - left)),
              height: Math.round(image.height * 0.062),
            },
          })
        ).data;
      }
      // Hard levels shift the Level/number block left to make room for the badge.
      for (const [left, right] of [
        [0.29, 0.45],
        [0.21, 0.39],
      ] as const) {
        const numbered = await text(left, right);
        const match = /\blevel\s*([0-9]{1,6})\b/i.exec(numbered.text);
        if (match && numbered.confidence >= 70)
          return { kind: "numbered", number: Number(match[1]) };
      }
      const unnamed = await text(0.43, 0.59);
      if (/\bscore\D*[0-9]+/i.test(unnamed.text) && unnamed.confidence >= 70)
        return { kind: "golden-fish" };
      throw new Error(
        "Level header not recognized; waiting for a clear game screen",
      );
    },
    async close() {
      await worker.terminate();
    },
  };
}
