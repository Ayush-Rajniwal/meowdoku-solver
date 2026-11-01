import { createRequire } from "node:module";
import { createWorker } from "tesseract.js";

/** Shared local OCR setup. Native diagnostics must not write over the terminal UI. */
export async function createLocalOcrWorker() {
  const data = createRequire(import.meta.url)("@tesseract.js-data/eng") as {
    langPath: string;
    gzip: boolean;
  };
  const worker = await createWorker("eng", 1, { ...data, cacheMethod: "none" });
  // Tesseract's virtual /dev/null silences native debug output; JS errors still reject.
  await worker.setParameters({ debug_file: "/dev/null" });
  return worker;
}
