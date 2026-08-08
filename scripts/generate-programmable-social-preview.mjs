import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDirectory, "..");
const source = join(
  root,
  "public/og/programmable-night-garden-og-2400x1260.png",
);
const mark = join(
  root,
  "public/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png",
);
const master = join(
  root,
  "public/og/programmable-night-garden-loop-og-v2-2400x1260.png",
);
const social = join(
  root,
  "public/og/programmable-night-garden-loop-og-v2-1200x630.png",
);

await mkdir(dirname(master), { recursive: true });

const logo = await sharp(mark)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .resize({ height: 520, fit: "inside", withoutEnlargement: false })
  .png()
  .toBuffer({ resolveWithObject: true });

const left = Math.round((2400 - logo.info.width) / 2);
const top = Math.round((1260 - logo.info.height) / 2);

await sharp(source)
  .resize(2400, 1260, { fit: "fill" })
  .composite([{ input: logo.data, left, top }])
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(master);

await sharp(master)
  .resize(1200, 630, { kernel: sharp.kernel.lanczos3 })
  .removeAlpha()
  .png({ compressionLevel: 9 })
  .toFile(social);

console.log(`Generated ${master}`);
console.log(`Generated ${social}`);
