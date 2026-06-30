import { ensureTables, probationersTable, objectivesTable, checkInsTable } from "./db.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_DIR = path.resolve(__dirname, "..", "..", "db");

async function seed() {
  console.log("🌱 Seeding database (upsert)...");
  await ensureTables();

  const probationers = JSON.parse(fs.readFileSync(path.join(DB_DIR, "probationers.json"), "utf-8"));
  for (const p of probationers) {
    try {
      await probationersTable.upsertEntity({ partitionKey: "default", rowKey: p.id, ...p }, "Replace");
      console.log(`  ✅ Probationer: ${p.fullName}`);
    } catch (err) { console.log(`  ❌ Probationer ${p.id}: ${(err as Error).message}`); }
  }

  const objectives = JSON.parse(fs.readFileSync(path.join(DB_DIR, "objectives.json"), "utf-8"));
  for (const o of objectives) {
    try {
      await objectivesTable.upsertEntity({ partitionKey: o.probationerId, rowKey: o.id, ...o }, "Replace");
      console.log(`  ✅ Objective: ${o.objective}`);
    } catch (err) { console.log(`  ❌ Objective ${o.id}: ${(err as Error).message}`); }
  }

  const checkIns = JSON.parse(fs.readFileSync(path.join(DB_DIR, "checkins.json"), "utf-8"));
  for (const c of checkIns) {
    try {
      await checkInsTable.upsertEntity({ partitionKey: c.probationerId, rowKey: c.id, ...c }, "Replace");
      console.log(`  ✅ CheckIn: ${c.checkInName} for ${c.probationerId}`);
    } catch (err) { console.log(`  ❌ CheckIn ${c.id}: ${(err as Error).message}`); }
  }

  console.log("\n✅ Seeding complete!");
}

seed().catch(console.error);
