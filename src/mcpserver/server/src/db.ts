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
  jobTitle: string;
  department: string;
  startDate: string;
  endDate: string;
  status: string;
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
export const getAllObjectives = () => listAll<ObjectiveEntity>(objectivesTable);
export const getObjectivesByProbationerId = async (probationerId: string): Promise<ObjectiveEntity[]> => {
  const all = await listAll<ObjectiveEntity>(objectivesTable);
  return all.filter(o => o.probationerId === probationerId);
};
export const getAllCheckIns = () => listAll<CheckInEntity>(checkInsTable);
export const getCheckInsByProbationerId = async (probationerId: string): Promise<CheckInEntity[]> => {
  const all = await listAll<CheckInEntity>(checkInsTable);
  return all.filter(c => c.probationerId === probationerId);
};
