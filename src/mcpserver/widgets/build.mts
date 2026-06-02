import { build } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WIDGETS_DIR = path.join(__dirname, "src");
const ASSETS_DIR = path.join(__dirname, "..", "assets");

const widgetDirs = fs
  .readdirSync(WIDGETS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && fs.existsSync(path.join(WIDGETS_DIR, d.name, "index.html")))
  .map(d => d.name);

console.log(`🔨 Building ${widgetDirs.length} widgets: ${widgetDirs.join(", ")}\n`);

if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

for (const widget of widgetDirs) {
  console.log(`  📦 Building ${widget}...`);
  await build({
    root: path.join(WIDGETS_DIR, widget),
    plugins: [react(), viteSingleFile()],
    build: {
      outDir: ASSETS_DIR,
      emptyOutDir: false,
      rollupOptions: {
        output: { entryFileNames: `${widget}.js` },
      },
    },
    logLevel: "warn",
  });

  const srcHtml = path.join(ASSETS_DIR, "index.html");
  const destHtml = path.join(ASSETS_DIR, `${widget}.html`);
  if (fs.existsSync(srcHtml)) {
    fs.renameSync(srcHtml, destHtml);
  }
  console.log(`  ✅ ${widget}.html\n`);
}

console.log("✅ All widgets built to assets/");
