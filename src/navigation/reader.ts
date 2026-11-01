import { PSM } from "tesseract.js";
import { createLocalOcrWorker } from "../vision/ocr-worker.ts";
import {
  decodeScreenshot,
  fractionRect,
  orangeButton,
  overlayVisible,
  textMask,
} from "./vision.ts";
export interface NavigationAction {
  kind: "leaderboard" | "continue" | "next-level" | "golden-fish";
  label: string;
  x: number;
  y: number;
  key: string;
}
export interface NavigationDecision {
  action?: NavigationAction;
  reason: string;
}
export interface NavigationReader {
  read(png: Buffer): Promise<NavigationDecision>;
  close(): Promise<void>;
}
/** Recognizes only observed game continuation controls. It never sends input. */
export async function createNavigationReader(): Promise<NavigationReader> {
  const worker = await createLocalOcrWorker();
  await worker.setParameters({ user_defined_dpi: "150" });
  async function recognize(
    png: Buffer,
    psm: PSM,
  ): Promise<{ text: string; confidence: number }> {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const result = await worker.recognize(png);
    return {
      text: result.data.text.replace(/\s+/g, " ").trim(),
      confidence: result.data.confidence,
    };
  }
  return {
    async read(png) {
      const image = decodeScreenshot(png);
      if (!overlayVisible(image))
        return { reason: "No supported completion overlay" };
      const header = await recognize(
        textMask(image, fractionRect(image, 0.2, 0.035, 0.8, 0.1), "dark"),
        PSM.SINGLE_BLOCK,
      );
      if (!/\bscore\b/i.test(header.text))
        return { reason: "Game header not recognized on this overlay" };
      const identity = (header.text.match(/[0-9]+/g) ?? []).join(",");
      const button = orangeButton(image);
      if (button) {
        const label = await recognize(
          textMask(image, button, "white"),
          PSM.SINGLE_LINE,
        );
        if (label.confidence < 75)
          return { reason: "Continuation button text is uncertain" };
        let kind: NavigationAction["kind"];
        if (/^continue[!.]?$/i.test(label.text)) kind = "continue";
        else if (/^level\s*\d+[!.]?$/i.test(label.text)) kind = "next-level";
        else if (/^golden\s*fish[!.]?$/i.test(label.text)) kind = "golden-fish";
        else return { reason: "Unrecognized orange button: " + label.text };
        return {
          reason: "Recognized continuation button",
          action: {
            kind,
            label: label.text,
            x: Math.round(button.x + button.width / 2),
            y: Math.round(button.y + button.height / 2),
            key: identity + "|" + kind + "|" + label.text,
          },
        };
      }
      const title = await recognize(
        textMask(image, fractionRect(image, 0.1, 0.13, 0.9, 0.21), "white"),
        PSM.SINGLE_LINE,
      );
      if (!/^leaderboard[!.]?$/i.test(title.text) || title.confidence < 75)
        return { reason: "No supported completion control" };
      const rect = fractionRect(image, 0.15, 0.84, 0.85, 0.96);
      const label = await recognize(
        textMask(image, rect, "yellow"),
        PSM.SINGLE_LINE,
      );
      if (
        !/^tap\s+to\s+continue[!.]?$/i.test(label.text) ||
        label.confidence < 75
      )
        return { reason: "Leaderboard continuation prompt is not visible" };
      return {
        reason: "Recognized leaderboard continuation",
        action: {
          kind: "leaderboard",
          label: "Tap to Continue",
          x: Math.round(image.width * 0.5),
          y: Math.round(image.height * 0.892),
          key: identity + "|leaderboard",
        },
      };
    },
    async close() {
      await worker.terminate();
    },
  };
}
