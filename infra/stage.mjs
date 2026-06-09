import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MCP_ROOT = path.join(__dirname, "..", "src", "mcpserver");
const SERVER_DIR = path.join(MCP_ROOT, "server");
const ASSETS_DIR = path.join(MCP_ROOT, "assets");
const STAGE_DIR = path.join(MCP_ROOT, "deploy-stage");

function rimraf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

console.log("🧹 Cleaning stage directory...");
rimraf(STAGE_DIR);
fs.mkdirSync(STAGE_DIR, { recursive: true });

console.log("📦 Installing production dependencies in server/...");
execSync("npm install --omit=dev --no-audit --no-fund", { cwd: SERVER_DIR, stdio: "inherit" });

const stagedServer = path.join(STAGE_DIR, "server");
fs.mkdirSync(stagedServer, { recursive: true });

console.log("📂 Copying server/dist, server/node_modules, server/package.json...");
copyDir(path.join(SERVER_DIR, "dist"), path.join(stagedServer, "dist"));
copyDir(path.join(SERVER_DIR, "node_modules"), path.join(stagedServer, "node_modules"));
fs.copyFileSync(path.join(SERVER_DIR, "package.json"), path.join(stagedServer, "package.json"));

if (fs.existsSync(ASSETS_DIR)) {
  console.log("📂 Copying assets/...");
  copyDir(ASSETS_DIR, path.join(STAGE_DIR, "assets"));
}

console.log(`✅ Stage ready: ${STAGE_DIR}`);
