/*
 * Rasterises public/brand/profitkit-mark.svg into the PNG sizes Shopify and the
 * embedded app need. The SVG is the source of truth; run this after editing it.
 *
 *   node scripts/build-brand.mjs
 *
 * sharp is resolved from ../marketing/node_modules because the app itself has no
 * image dependency and does not need one at runtime — this is a build-time tool
 * for brand assets, run by hand, not part of `npm run build`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const brandDir = path.join(root, "public", "brand");

const require = createRequire(path.join(root, "..", "marketing", "package.json"));
let sharp;
try {
  sharp = require("sharp");
} catch {
  console.error(
    "sharp not found. It is resolved from ../marketing/node_modules — run\n" +
      "`npm install` in ../marketing, or install sharp here, then retry.",
  );
  process.exit(1);
}

/*
 * 1200 is Shopify's App Store listing icon size. 512 and 192 cover the embedded
 * app and PWA-style surfaces; 32 is the browser tab. Every size is generated from
 * the same vector so none of them can drift.
 */
const SIZES = [
  { px: 1200, name: "profitkit-icon-1200.png", note: "Shopify App Store listing" },
  { px: 512, name: "profitkit-icon-512.png", note: "embedded app / general use" },
  { px: 192, name: "profitkit-icon-192.png", note: "small surfaces" },
  { px: 32, name: "profitkit-icon-32.png", note: "browser tab" },
];

const svgPath = path.join(brandDir, "profitkit-mark.svg");
const svg = await readFile(svgPath);

await mkdir(brandDir, { recursive: true });

for (const size of SIZES) {
  // density scales the vector rasteriser so edges stay crisp at large sizes
  // rather than being upscaled from the SVG's nominal 48px box.
  const out = await sharp(svg, { density: Math.max(72, (size.px / 48) * 72) })
    .resize(size.px, size.px, { fit: "contain" })
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeFile(path.join(brandDir, size.name), out);
  console.log(`${size.name.padEnd(28)} ${String(size.px).padStart(4)}px  ${size.note}`);
}

// The app's tab icon. Kept as PNG at the root of public/ so the browser finds it
// without a manifest, replacing the template's stock favicon.ico.
await writeFile(
  path.join(root, "public", "icon.png"),
  await sharp(svg, { density: 768 }).resize(512, 512).png({ compressionLevel: 9 }).toBuffer(),
);
console.log("icon.png                      512px  app tab icon");
