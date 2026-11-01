import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("blank OCR crops cannot print native numeric diagnostics over the TUI", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {createLocalOcrWorker} from './src/vision/ocr-worker.ts';
    import {PNG} from 'pngjs';
    import {PSM} from 'tesseract.js';
    const worker=await createLocalOcrWorker();
    try {
      await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE});
      const png=new PNG({width:800,height:240});
      png.data.fill(255);
      await worker.recognize(PNG.sync.write(png));
      console.log("OCR complete");
    } finally {await worker.terminate();}
  `,
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      timeout: 20_000,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "OCR complete\n");
  assert.equal(result.stderr, "");
});
