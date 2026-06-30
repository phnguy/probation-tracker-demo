import { TableClient } from "@azure/data-tables";

const AZURITE_CONNECTION_STRING =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;";

const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING ?? AZURITE_CONNECTION_STRING;

// Allow insecure (HTTP) only when targeting Azurite locally.
const isAzurite = /devstoreaccount1/i.test(CONNECTION_STRING) || /127\.0\.0\.1|localhost/i.test(CONNECTION_STRING);
const opts = isAzurite ? { allowInsecureConnection: true } : {};

export const probationersTable = TableClient.fromConnectionString(CONNECTION_STRING, "Probationers", opts);
export const objectivesTable = TableClient.fromConnectionString(CONNECTION_STRING, "Objectives", opts);
export const checkInsTable = TableClient.fromConnectionString(CONNECTION_STRING, "CheckIns", opts);

export async function ensureTables() {
  const tables = [probationersTable, objectivesTable, checkInsTable];
  for (const table of tables) {
    try { await table.createTable(); } catch { /* already exists */ }
  }
}

export interface ProbationerEntity {
  partitionKey: string;
  rowKey: string;
  id: string;
  fullName: string;
  email: string;
  /** UPN / email of the line manager. Used to scope "my probationers" views. */
  managerEmail: string;
  jobTitle: string;
  department: string;
  startDate: string;
  endDate: string;
  status: string;
  /** Free-form notes. Azure Table Storage allows up to ~32 KB per string property. */
  notes: string;
  imageUrl: string;
}

export interface ObjectiveEntity {
  partitionKey: string;
  rowKey: string;
  id: string;
  probationerId: string;
  objective: string;
  description: string;
  targetDate: string;
  status: string;
  progress: number;
}

export interface CheckInEntity {
  partitionKey: string;
  rowKey: string;
  id: string;
  probationerId: string;
  checkInName: string;
  checkInNumber: number;
  scheduledDate: string;
  completedDate: string;
  status: string;
  overallRating: string;
  /**
   * Free-form notes / full check-in report.
   * Azure Table Storage allows up to ~32 KB per string property — enough to hold
   * multi-section/multi-paragraph reports for a single check-in. Newlines are
   * preserved; renderers should use white-space: pre-wrap.
   */
  notes: string;
}

async function listAll<T extends object>(table: TableClient): Promise<T[]> {
  const results: T[] = [];
  for await (const entity of table.listEntities<T>()) {
    results.push(entity);
  }
  return results;
}

async function getById<T extends object>(table: TableClient, partition: string, id: string): Promise<T | null> {
  try {
    return await table.getEntity<T>(partition, id);
  } catch { return null; }
}

export const getAllProbationers = () => listAll<ProbationerEntity>(probationersTable);
export const getProbationerById = (id: string) => getById<ProbationerEntity>(probationersTable, "default", id);

export async function createProbationer(
  input: Partial<ProbationerEntity> & { fullName: string; email: string },
): Promise<ProbationerEntity> {
  await ensureTables();
  const existing = await getAllProbationers();
  const maxNum = existing.reduce((m, p) => {
    const n = parseInt((p.id ?? p.rowKey ?? "").replace(/^PR/i, ""), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  const id = input.id ?? `PR${String(maxNum + 1).padStart(3, "0")}`;
  const today = new Date();
  const startDate = input.startDate ?? today.toISOString().slice(0, 10);
  const endDate =
    input.endDate ??
    new Date(new Date(startDate).setMonth(new Date(startDate).getMonth() + 6))
      .toISOString()
      .slice(0, 10);
  const entity: ProbationerEntity = {
    partitionKey: "default",
    rowKey: id,
    id,
    fullName: input.fullName,
    email: input.email,
    managerEmail: input.managerEmail ?? "",
    jobTitle: input.jobTitle ?? "",
    department: input.department ?? "",
    startDate,
    endDate,
    status: input.status ?? "In Progress",
    notes: input.notes ?? "",
    imageUrl: input.imageUrl ?? "",
  };
  await probationersTable.createEntity(entity);
  return entity;
}

export async function updateProbationer(
  id: string,
  patch: Partial<Omit<ProbationerEntity, "partitionKey" | "rowKey" | "id">>,
): Promise<ProbationerEntity | null> {
  const current = await getProbationerById(id);
  if (!current) return null;
  const merged: ProbationerEntity = { ...current, ...patch, partitionKey: "default", rowKey: id, id };
  await probationersTable.updateEntity(merged, "Replace");
  return merged;
}

export async function upsertObjective(
  input: Partial<ObjectiveEntity> & { probationerId: string; objective: string },
): Promise<ObjectiveEntity> {
  await ensureTables();
  let id = input.id;
  if (!id) {
    const all = await getAllObjectives();
    const forProb = all.filter(o => o.probationerId === input.probationerId);
    const maxNum = forProb.reduce((m, o) => {
      const n = parseInt((o.id ?? o.rowKey ?? "").split("-").pop() ?? "0", 10);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    id = `OBJ-${input.probationerId}-${String(maxNum + 1).padStart(2, "0")}`;
  }
  const entity: ObjectiveEntity = {
    partitionKey: "default",
    rowKey: id,
    id,
    probationerId: input.probationerId,
    objective: input.objective,
    description: input.description ?? "",
    targetDate: input.targetDate ?? "",
    status: input.status ?? "Not Started",
    progress: input.progress ?? 0,
  };
  await objectivesTable.upsertEntity(entity, "Replace");
  return entity;
}

export async function upsertCheckIn(
  input: Partial<CheckInEntity> & { probationerId: string; checkInNumber: number },
): Promise<CheckInEntity> {
  await ensureTables();
  const id = input.id ?? `CHK-${input.probationerId}-${String(input.checkInNumber).padStart(2, "0")}`;
  const existing = await getById<CheckInEntity>(checkInsTable, "default", id);
  const entity: CheckInEntity = {
    partitionKey: "default",
    rowKey: id,
    id,
    probationerId: input.probationerId,
    checkInName: input.checkInName ?? existing?.checkInName ?? `Month ${input.checkInNumber} Check-In`,
    checkInNumber: input.checkInNumber,
    scheduledDate: input.scheduledDate ?? existing?.scheduledDate ?? "",
    completedDate: input.completedDate ?? existing?.completedDate ?? "",
    status: input.status ?? existing?.status ?? "Scheduled",
    overallRating: input.overallRating ?? existing?.overallRating ?? "",
    notes: input.notes ?? existing?.notes ?? "",
  };
  await checkInsTable.upsertEntity(entity, "Replace");
  return entity;
}

export const getObjectivesByProbationerId = async (probationerId: string): Promise<ObjectiveEntity[]> => {
  const all = await listAll<ObjectiveEntity>(objectivesTable);
  return all.filter(o => o.probationerId === probationerId);
};
export const getAllObjectives = () => listAll<ObjectiveEntity>(objectivesTable);
export const getAllCheckIns = () => listAll<CheckInEntity>(checkInsTable);
export const getCheckInsByProbationerId = async (probationerId: string): Promise<CheckInEntity[]> => {
  const all = await listAll<CheckInEntity>(checkInsTable);
  return all.filter(c => c.probationerId === probationerId);
};
