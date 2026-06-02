import { ensureTables, probationersTable, objectivesTable, checkInsTable } from "./db.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_DIR = path.resolve(__dirname, "..", "..", "db");

async function seed() {
  console.log("🌱 Seeding database...");
  await ensureTables();

  const probationers = JSON.parse(fs.readFileSync(path.join(DB_DIR, "probationers.json"), "utf-8"));
  for (const p of probationers) {
    try {
      await probationersTable.createEntity({ partitionKey: "default", rowKey: p.id, ...p });
      console.log(`  ✅ Probationer: ${p.fullName}`);
    } catch { console.log(`  ⏭️  Probationer ${p.id} already exists`); }
  }

  const objectives = JSON.parse(fs.readFileSync(path.join(DB_DIR, "objectives.json"), "utf-8"));
  for (const o of objectives) {
    try {
      await objectivesTable.createEntity({ partitionKey: o.probationerId, rowKey: o.id, ...o });
      console.log(`  ✅ Objective: ${o.objective}`);
    } catch { console.log(`  ⏭️  Objective ${o.id} already exists`); }
  }

  const checkIns = JSON.parse(fs.readFileSync(path.join(DB_DIR, "checkins.json"), "utf-8"));
  for (const c of checkIns) {
    try {
      await checkInsTable.createEntity({ partitionKey: c.probationerId, rowKey: c.id, ...c });
      console.log(`  ✅ CheckIn: ${c.checkInName} for ${c.probationerId}`);
    } catch { console.log(`  ⏭️  CheckIn ${c.id} already exists`); }
  }

  console.log("\n✅ Seeding complete!");
}

seed().catch(console.error);
