import "dotenv/config";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { ensureTables, probationersTable } from "./db.js";

const TENANT = process.env.TEAMS_APP_TENANT_ID ?? process.env.AAD_APP_TENANT_ID ?? "";
const CLIENT_ID = process.env.AAD_APP_CLIENT_ID ?? "";
const CLIENT_SECRET =
  process.env.AAD_APP_CLIENT_SECRET ?? process.env.SECRET_AAD_APP_CLIENT_SECRET ?? "";
const COUNT = parseInt(process.env.SEED_ENTRA_COUNT ?? "10", 10);

if (!TENANT || !CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "❌ Missing env. Need TEAMS_APP_TENANT_ID, AAD_APP_CLIENT_ID, (SECRET_)AAD_APP_CLIENT_SECRET.",
  );
  process.exit(1);
}

async function getAppToken(): Promise<string> {
  const cca = new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${TENANT}`,
    },
  });
  const result = await cca.acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });
  if (!result?.accessToken) throw new Error("No token returned (client credentials flow)");
  return result.accessToken;
}

interface GraphUser {
  id: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  mail?: string | null;
  jobTitle?: string | null;
  department?: string | null;
}

async function fetchUsers(token: string, top: number): Promise<GraphUser[]> {
  const url = `https://graph.microsoft.com/v1.0/users?$top=${top}&$select=id,displayName,userPrincipalName,mail,jobTitle,department&$filter=accountEnabled eq true and userType eq 'Member'`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      "consistencylevel": "eventual",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { value: GraphUser[] };
  return json.value ?? [];
}

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildProbationer(user: GraphUser, index: number) {
  const start = new Date();
  start.setDate(start.getDate() - (index * 5)); // stagger start dates a bit
  const end = new Date(start);
  end.setMonth(end.getMonth() + 6);
  const id = `PRENT${String(index + 1).padStart(3, "0")}`;
  const email = user.mail ?? user.userPrincipalName ?? "";
  return {
    partitionKey: "default",
    rowKey: id,
    id,
    fullName: user.displayName ?? email ?? id,
    email,
    jobTitle: user.jobTitle ?? "Member of Staff",
    department: user.department ?? "General",
    startDate: isoDateOnly(start),
    endDate: isoDateOnly(end),
    status: "In Progress",
    notes: "Seeded from Microsoft Entra ID.",
    imageUrl: `https://i.pravatar.cc/150?img=${(index * 7) % 70 + 1}`,
  };
}

async function main() {
  console.log(`🌱 Seeding ${COUNT} probationers from Entra (tenant ${TENANT})…`);
  await ensureTables();
  const token = await getAppToken();
  const users = await fetchUsers(token, COUNT);
  if (!users.length) {
    console.warn("⚠️ Graph returned zero users.");
    return;
  }
  console.log(`📥 Got ${users.length} user(s) from Graph.`);
  for (let i = 0; i < users.length; i++) {
    const entity = buildProbationer(users[i], i);
    try {
      await probationersTable.upsertEntity(entity, "Replace");
      console.log(`  ✅ ${entity.id}  ${entity.fullName}  <${entity.email}>`);
    } catch (err) {
      console.error(`  ❌ ${entity.id} failed:`, (err as Error).message);
    }
  }
  console.log("\n✅ Done.");
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
