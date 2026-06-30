import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as db from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.resolve(__dirname, "..", "..", "assets");

async function readWidgetHtml(name: string): Promise<string> {
  const filePath = path.join(ASSETS_DIR, `${name}.html`);
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return `<html><body><p>Widget "${name}" not built yet. Run: npm run build:widgets</p></body></html>`;
  }
}

type DerivedStatus = "on-track" | "attention" | "overdue" | "passed" | "failed" | "extended";

function getDerivedStatus(probationer: db.ProbationerEntity, checkIns: db.CheckInEntity[]): DerivedStatus {
  if (probationer.status === "Completed") return "passed";
  if (probationer.status === "Failed") return "failed";
  if (probationer.status === "Extended") return "extended";
  if (probationer.status === "At Risk") return "attention";
  if (new Date(probationer.endDate) < new Date()) return "overdue";
  const hasMissed = checkIns.some(c => c.status === "Missed");
  const hasAtRisk = checkIns.some(c => c.overallRating === "At Risk");
  if (hasMissed || hasAtRisk) return "attention";
  return "on-track";
}

function getStatusLabel(status: DerivedStatus): string {
  const map: Record<DerivedStatus, string> = {
    "on-track": "On Track", "attention": "Attention Needed",
    "overdue": "Overdue", "passed": "Passed", "failed": "Failed", "extended": "Extended"
  };
  return map[status];
}

function getStatusColor(status: DerivedStatus): string {
  const map: Record<DerivedStatus, string> = {
    "on-track": "#4caf50", "attention": "#ff9800",
    "overdue": "#f44336", "passed": "#2196f3", "failed": "#f44336", "extended": "#ff9800"
  };
  return map[status];
}

function getTimelineProgress(probationer: db.ProbationerEntity): number {
  const start = new Date(probationer.startDate).getTime();
  const end = new Date(probationer.endDate).getTime();
  const now = Date.now();
  if (now >= end) return 100;
  if (now <= start) return 0;
  return Math.round(((now - start) / (end - start)) * 100);
}

function getDaysRemaining(probationer: db.ProbationerEntity): number {
  const end = new Date(probationer.endDate).getTime();
  const now = Date.now();
  return Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
}

function getCurrentMonth(probationer: db.ProbationerEntity): number {
  const start = new Date(probationer.startDate).getTime();
  const now = Date.now();
  const months = Math.floor((now - start) / (1000 * 60 * 60 * 24 * 30)) + 1;
  return Math.min(6, Math.max(1, months));
}

const DASHBOARD_URI = "ui://probation/dashboard.html";
const DETAIL_URI = "ui://probation/detail.html";
const REPORTS_URI = "ui://probation/reports.html";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "probation-tracker-mcp",
    version: "1.0.0",
  });

  registerAppResource(server, "Probation Dashboard", DASHBOARD_URI, {
    mimeType: RESOURCE_MIME_TYPE,
    description: "Probation dashboard interactive widget",
  }, async (): Promise<ReadResourceResult> => {
    const html = await readWidgetHtml("dashboard");
    return { contents: [{ uri: DASHBOARD_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });

  registerAppResource(server, "Probationer Detail", DETAIL_URI, {
    mimeType: RESOURCE_MIME_TYPE,
    description: "Probationer detail interactive widget",
  }, async (): Promise<ReadResourceResult> => {
    const html = await readWidgetHtml("detail");
    return { contents: [{ uri: DETAIL_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });

  registerAppResource(server, "Probation Reports", REPORTS_URI, {
    mimeType: RESOURCE_MIME_TYPE,
    description: "Probation reports interactive widget",
  }, async (): Promise<ReadResourceResult> => {
    const html = await readWidgetHtml("reports");
    return { contents: [{ uri: REPORTS_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });

  registerAppTool(server, "show-probation-dashboard", {
    title: "Show Probation Dashboard",
    description: "Displays the probation dashboard showing all probationers with status overview, filters, and summary metrics. Supports filtering by department, status, and name search. When the user mentions a person's name, pass it as the search parameter.",
    inputSchema: {
      department: z.string().optional().describe("Filter by department (e.g. 'Engineering', 'Sales', 'Marketing', 'Operations', 'HR', 'Finance')"),
      status: z.string().optional().describe("Filter by status (e.g. 'In Progress', 'At Risk', 'Completed', 'Extended', 'Failed')"),
      search: z.string().optional().describe("Search by name or job title. Case-insensitive partial match."),
    },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: DASHBOARD_URI } },
  }, async ({ department, status, search }): Promise<CallToolResult> => {
    let probationers = await db.getAllProbationers();
    if (department) {
      const d = department.toLowerCase();
      probationers = probationers.filter(p => p.department.toLowerCase().includes(d));
    }
    if (status) {
      const s = status.toLowerCase();
      probationers = probationers.filter(p => p.status.toLowerCase().includes(s));
    }
    if (search) {
      const q = search.toLowerCase();
      probationers = probationers.filter(p =>
        p.fullName.toLowerCase().includes(q) || p.jobTitle.toLowerCase().includes(q)
      );
    }

    const allCheckIns = await db.getAllCheckIns();
    const allObjectives = await db.getAllObjectives();

    const enriched = probationers.map(p => {
      const pCheckIns = allCheckIns.filter(c => c.probationerId === p.id);
      const pObjectives = allObjectives.filter(o => o.probationerId === p.id);
      const derivedStatus = getDerivedStatus(p, pCheckIns);
      return {
        ...p,
        derivedStatus,
        statusLabel: getStatusLabel(derivedStatus),
        statusColor: getStatusColor(derivedStatus),
        timelineProgress: getTimelineProgress(p),
        daysRemaining: getDaysRemaining(p),
        currentMonth: getCurrentMonth(p),
        completedCheckIns: pCheckIns.filter(c => c.status === "Completed").length,
        totalCheckIns: 6,
        objectivesCompleted: pObjectives.filter(o => o.status === "Completed").length,
        totalObjectives: pObjectives.length,
      };
    });

    const stats = {
      active: enriched.filter(p => p.derivedStatus === "on-track").length,
      atRisk: enriched.filter(p => ["attention", "overdue"].includes(p.derivedStatus)).length,
      reviewsDueSoon: enriched.filter(p => p.daysRemaining <= 30 && !["passed", "failed"].includes(p.derivedStatus)).length,
      completed: enriched.filter(p => p.derivedStatus === "passed").length,
    };

    const allDepartments = [...new Set(probationers.map(p => p.department))].sort();
    const allStatuses = [...new Set(probationers.map(p => p.status))].sort();

    return {
      content: [{ type: "text", text: `Showing ${enriched.length} probationers. Active: ${stats.active}, Need Attention: ${stats.atRisk}, Completed: ${stats.completed}.` }],
      structuredContent: { stats, probationers: enriched, allDepartments, allStatuses },
    };
  });

  registerAppTool(server, "show-probationer-detail", {
    title: "Show Probationer Detail",
    description: "Displays detailed information about a specific probationer including objectives, check-ins, and timeline progress. Use probationer ID (e.g. 'PR001') or name.",
    inputSchema: {
      probationer_id: z.string().optional().describe("Probationer ID (e.g. 'PR001')"),
      name: z.string().optional().describe("Full or partial name to search (case-insensitive)"),
    },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: DETAIL_URI } },
  }, async ({ probationer_id, name }): Promise<CallToolResult> => {
    let probationer: db.ProbationerEntity | null = null;

    if (probationer_id) {
      probationer = await db.getProbationerById(probationer_id);
    }
    if (!probationer && name) {
      const all = await db.getAllProbationers();
      const n = name.toLowerCase();
      probationer = all.find(p => p.fullName.toLowerCase().includes(n)) ?? null;
    }
    if (!probationer) {
      return { content: [{ type: "text", text: `Probationer not found.` }] };
    }

    const objectives = await db.getObjectivesByProbationerId(probationer.id);
    const checkIns = await db.getCheckInsByProbationerId(probationer.id);
    const derivedStatus = getDerivedStatus(probationer, checkIns);

    const enriched = {
      ...probationer,
      derivedStatus,
      statusLabel: getStatusLabel(derivedStatus),
      statusColor: getStatusColor(derivedStatus),
      timelineProgress: getTimelineProgress(probationer),
      daysRemaining: getDaysRemaining(probationer),
      currentMonth: getCurrentMonth(probationer),
    };

    const completedObjectives = objectives.filter(o => o.status === "Completed").length;
    const completedCheckIns = checkIns.filter(c => c.status === "Completed").length;

    return {
      content: [{ type: "text", text: `${probationer.fullName} (${probationer.jobTitle}, ${probationer.department}) — Status: ${getStatusLabel(derivedStatus)}. ${completedObjectives}/${objectives.length} objectives completed. ${completedCheckIns}/6 check-ins completed.` }],
      structuredContent: { probationer: enriched, objectives, checkIns },
    };
  });

  registerAppTool(server, "show-probation-reports", {
    title: "Show Probation Reports",
    description: "Displays probation analytics with status distribution, department breakdown, objective/check-in stats, and upcoming reviews.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: REPORTS_URI } },
  }, async (): Promise<CallToolResult> => {
    const probationers = await db.getAllProbationers();
    const allObjectives = await db.getAllObjectives();
    const allCheckIns = await db.getAllCheckIns();

    const totalProbationers = probationers.length;
    const totalObjectives = allObjectives.length;
    const completedObjectives = allObjectives.filter(o => o.status === "Completed").length;
    const completedCheckIns = allCheckIns.filter(c => c.status === "Completed").length;
    const totalCheckIns = allCheckIns.length;
    const checkInRate = totalCheckIns > 0 ? Math.round((completedCheckIns / totalCheckIns) * 100) : 0;

    const completedProbationers = probationers.filter(p => p.status === "Completed").length;
    const finishedProbationers = probationers.filter(p => ["Completed", "Failed"].includes(p.status)).length;
    const successRate = finishedProbationers > 0 ? Math.round((completedProbationers / finishedProbationers) * 100) : 100;

    const statusCounts: Record<string, number> = {};
    for (const p of probationers) {
      const pCheckIns = allCheckIns.filter(c => c.probationerId === p.id);
      const ds = getDerivedStatus(p, pCheckIns);
      const label = getStatusLabel(ds);
      statusCounts[label] = (statusCounts[label] ?? 0) + 1;
    }
    const statusDistribution = Object.entries(statusCounts).map(([label, count]) => {
      const dsKey = Object.entries({ "on-track": "On Track", "attention": "Attention Needed", "overdue": "Overdue", "passed": "Passed", "failed": "Failed", "extended": "Extended" })
        .find(([, v]) => v === label)?.[0] as DerivedStatus | undefined;
      return { label, count, color: dsKey ? getStatusColor(dsKey) : "#666" };
    });

    const deptMap: Record<string, { total: number; active: number }> = {};
    for (const p of probationers) {
      if (!deptMap[p.department]) deptMap[p.department] = { total: 0, active: 0 };
      deptMap[p.department].total++;
      if (["In Progress", "At Risk"].includes(p.status)) deptMap[p.department].active++;
    }
    const departmentBreakdown = Object.entries(deptMap).map(([department, data]) => ({ department, ...data }));

    const objectiveStats = {
      total: totalObjectives,
      completed: completedObjectives,
      inProgress: allObjectives.filter(o => o.status === "In Progress").length,
      notStarted: allObjectives.filter(o => o.status === "Not Started").length,
    };

    const checkInStats = {
      total: totalCheckIns,
      completed: completedCheckIns,
      missed: allCheckIns.filter(c => c.status === "Missed").length,
      scheduled: allCheckIns.filter(c => c.status === "Scheduled").length,
    };

    const now = new Date();
    const sixtyDaysFromNow = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const upcomingReviews = probationers
      .filter(p => {
        const end = new Date(p.endDate);
        return end >= now && end <= sixtyDaysFromNow && !["Completed", "Failed"].includes(p.status);
      })
      .map(p => ({ id: p.id, fullName: p.fullName, department: p.department, endDate: p.endDate, daysRemaining: getDaysRemaining(p) }));

    return {
      content: [{ type: "text", text: `Probation Reports: ${totalProbationers} total probationers, ${completedObjectives}/${totalObjectives} objectives completed, ${checkInRate}% check-in rate, ${successRate}% success rate.` }],
      structuredContent: { stats: { totalProbationers, totalObjectives, checkInRate, successRate }, statusDistribution, departmentBreakdown, objectiveStats, checkInStats, upcomingReviews },
    };
  });

  registerAppTool(server, "add-probationer", {
    title: "Add Probationer",
    description: "Create a new probationer record. Required: fullName, email. Optional: managerEmail, jobTitle, department, startDate (YYYY-MM-DD, defaults to today), endDate (YYYY-MM-DD, defaults to 6 months after startDate), status, notes. The new probationer appears in the dashboard returned by this tool.",
    inputSchema: {
      fullName: z.string().describe("Full name of the probationer (required)."),
      email: z.string().describe("Work email of the probationer (required)."),
      managerEmail: z.string().optional().describe("Line manager's UPN / email. Used later to filter 'my probationers'."),
      jobTitle: z.string().optional().describe("Job title, e.g. 'Software Engineer'."),
      department: z.string().optional().describe("Department, e.g. 'Engineering', 'Sales', 'Marketing'."),
      startDate: z.string().optional().describe("Probation start date as YYYY-MM-DD. Defaults to today."),
      endDate: z.string().optional().describe("Probation end date as YYYY-MM-DD. Defaults to 6 months after startDate."),
      status: z.string().optional().describe("Status. One of: 'In Progress' (default), 'At Risk', 'Completed', 'Extended', 'Failed'."),
      notes: z.string().optional().describe("Free-text notes (e.g. onboarding context)."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    _meta: { ui: { resourceUri: DASHBOARD_URI } },
  }, async ({ fullName, email, managerEmail, jobTitle, department, startDate, endDate, status, notes }): Promise<CallToolResult> => {
    const created = await db.createProbationer({ fullName, email, managerEmail, jobTitle, department, startDate, endDate, status, notes });
    const probationers = await db.getAllProbationers();
    const allCheckIns = await db.getAllCheckIns();
    const allObjectives = await db.getAllObjectives();
    const enriched = probationers.map(p => {
      const pCheckIns = allCheckIns.filter(c => c.probationerId === p.id);
      const pObjectives = allObjectives.filter(o => o.probationerId === p.id);
      const derivedStatus = getDerivedStatus(p, pCheckIns);
      return {
        ...p,
        derivedStatus,
        statusLabel: getStatusLabel(derivedStatus),
        statusColor: getStatusColor(derivedStatus),
        timelineProgress: getTimelineProgress(p),
        daysRemaining: getDaysRemaining(p),
        currentMonth: getCurrentMonth(p),
        completedCheckIns: pCheckIns.filter(c => c.status === "Completed").length,
        totalCheckIns: 6,
        objectivesCompleted: pObjectives.filter(o => o.status === "Completed").length,
        totalObjectives: pObjectives.length,
      };
    });
    const stats = {
      active: enriched.filter(p => p.derivedStatus === "on-track").length,
      atRisk: enriched.filter(p => ["attention", "overdue"].includes(p.derivedStatus)).length,
      reviewsDueSoon: enriched.filter(p => p.daysRemaining <= 30 && !["passed", "failed"].includes(p.derivedStatus)).length,
      completed: enriched.filter(p => p.derivedStatus === "passed").length,
    };
    const allDepartments = [...new Set(probationers.map(p => p.department))].sort();
    const allStatuses = [...new Set(probationers.map(p => p.status))].sort();
    return {
      content: [{ type: "text", text: `Added probationer ${created.fullName} (${created.id}). Probation period: ${created.startDate} → ${created.endDate}. Total probationers: ${enriched.length}.` }],
      structuredContent: { created, stats, probationers: enriched, allDepartments, allStatuses },
    };
  });

  registerAppTool(server, "update-probationer", {
    title: "Update Probationer",
    description: "Update fields on an existing probationer (profile, dates, status, notes). Pass only the fields you want to change.",
    inputSchema: {
      probationer_id: z.string().optional().describe("Probationer ID (e.g. 'PR001'). Provide this OR name."),
      name: z.string().optional().describe("Full or partial name to locate the probationer if probationer_id is not provided."),
      fullName: z.string().optional(),
      email: z.string().optional(),
      managerEmail: z.string().optional().describe("Line manager's UPN / email."),
      jobTitle: z.string().optional(),
      department: z.string().optional(),
      startDate: z.string().optional().describe("YYYY-MM-DD"),
      endDate: z.string().optional().describe("YYYY-MM-DD. Use to extend probation."),
      status: z.string().optional().describe("'In Progress', 'At Risk', 'Completed', 'Extended', 'Failed'."),
      notes: z.string().optional(),
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
    _meta: { ui: { resourceUri: DETAIL_URI } },
  }, async ({ probationer_id, name, ...patch }): Promise<CallToolResult> => {
    let target: db.ProbationerEntity | null = null;
    if (probationer_id) target = await db.getProbationerById(probationer_id);
    if (!target && name) {
      const all = await db.getAllProbationers();
      const n = name.toLowerCase();
      target = all.find(p => p.fullName.toLowerCase().includes(n)) ?? null;
    }
    if (!target) return { content: [{ type: "text", text: "Probationer not found." }], isError: true };

    const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const updated = await db.updateProbationer(target.id, cleanPatch);
    if (!updated) return { content: [{ type: "text", text: "Update failed." }], isError: true };

    const objectives = await db.getObjectivesByProbationerId(updated.id);
    const checkIns = await db.getCheckInsByProbationerId(updated.id);
    const derivedStatus = getDerivedStatus(updated, checkIns);
    const enriched = {
      ...updated,
      derivedStatus,
      statusLabel: getStatusLabel(derivedStatus),
      statusColor: getStatusColor(derivedStatus),
      timelineProgress: getTimelineProgress(updated),
      daysRemaining: getDaysRemaining(updated),
      currentMonth: getCurrentMonth(updated),
    };
    const changed = Object.keys(cleanPatch).join(", ") || "(no fields)";
    return {
      content: [{ type: "text", text: `Updated ${updated.fullName} (${updated.id}). Changed: ${changed}. Status: ${getStatusLabel(derivedStatus)}.` }],
      structuredContent: { probationer: enriched, objectives, checkIns },
    };
  });

  registerAppTool(server, "upsert-objective", {
    title: "Add or Update Objective",
    description: "Create a new objective for a probationer, or update an existing one if objective_id is passed.",
    inputSchema: {
      probationer_id: z.string().optional().describe("Probationer ID. Provide this OR probationer_name."),
      probationer_name: z.string().optional().describe("Probationer name to look up if probationer_id is not provided."),
      objective_id: z.string().optional().describe("Existing objective ID to update. Omit to create a new one."),
      objective: z.string().describe("Short title of the objective."),
      description: z.string().optional().describe("Longer description / acceptance criteria."),
      targetDate: z.string().optional().describe("YYYY-MM-DD target completion date."),
      status: z.string().optional().describe("'Not Started' (default), 'In Progress', 'Completed', 'Blocked'."),
      progress: z.number().int().min(0).max(100).optional().describe("Percent complete 0-100."),
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
    _meta: { ui: { resourceUri: DETAIL_URI } },
  }, async ({ probationer_id, probationer_name, objective_id, objective, description, targetDate, status, progress }): Promise<CallToolResult> => {
    let target: db.ProbationerEntity | null = null;
    if (probationer_id) target = await db.getProbationerById(probationer_id);
    if (!target && probationer_name) {
      const all = await db.getAllProbationers();
      const n = probationer_name.toLowerCase();
      target = all.find(p => p.fullName.toLowerCase().includes(n)) ?? null;
    }
    if (!target) return { content: [{ type: "text", text: "Probationer not found." }], isError: true };

    const saved = await db.upsertObjective({ id: objective_id, probationerId: target.id, objective, description, targetDate, status, progress });
    const objectives = await db.getObjectivesByProbationerId(target.id);
    const checkIns = await db.getCheckInsByProbationerId(target.id);
    const derivedStatus = getDerivedStatus(target, checkIns);
    const enriched = {
      ...target,
      derivedStatus,
      statusLabel: getStatusLabel(derivedStatus),
      statusColor: getStatusColor(derivedStatus),
      timelineProgress: getTimelineProgress(target),
      daysRemaining: getDaysRemaining(target),
      currentMonth: getCurrentMonth(target),
    };
    const verb = objective_id ? "Updated" : "Added";
    return {
      content: [{ type: "text", text: `${verb} objective for ${target.fullName} (${target.id}): "${saved.objective}" — ${saved.status} (${saved.progress}%).` }],
      structuredContent: { probationer: enriched, objectives, checkIns, savedObjective: saved },
    };
  });

  registerAppTool(server, "log-check-in", {
    title: "Log Monthly Check-In",
    description: "Record or update a monthly check-in for a probationer (rating, notes, completion). Use this after a 1:1 to capture how it went.",
    inputSchema: {
      probationer_id: z.string().optional().describe("Probationer ID. Provide this OR probationer_name."),
      probationer_name: z.string().optional().describe("Probationer name to look up if probationer_id is not provided."),
      checkInNumber: z.number().int().min(1).max(6).describe("Which monthly check-in (1-6)."),
      status: z.string().optional().describe("'Scheduled', 'Completed', 'Missed'. Defaults to 'Completed' if completedDate is given, else 'Scheduled'."),
      scheduledDate: z.string().optional().describe("YYYY-MM-DD."),
      completedDate: z.string().optional().describe("YYYY-MM-DD. When set, status defaults to 'Completed'."),
      overallRating: z.string().optional().describe("'Exceeding', 'Meeting', 'Below', 'At Risk'."),
      notes: z.string().optional().describe("Notes from the conversation."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
    _meta: { ui: { resourceUri: DETAIL_URI } },
  }, async ({ probationer_id, probationer_name, checkInNumber, status, scheduledDate, completedDate, overallRating, notes }): Promise<CallToolResult> => {
    let target: db.ProbationerEntity | null = null;
    if (probationer_id) target = await db.getProbationerById(probationer_id);
    if (!target && probationer_name) {
      const all = await db.getAllProbationers();
      const n = probationer_name.toLowerCase();
      target = all.find(p => p.fullName.toLowerCase().includes(n)) ?? null;
    }
    if (!target) return { content: [{ type: "text", text: "Probationer not found." }], isError: true };

    const effectiveStatus = status ?? (completedDate ? "Completed" : undefined);
    const saved = await db.upsertCheckIn({ probationerId: target.id, checkInNumber, status: effectiveStatus, scheduledDate, completedDate, overallRating, notes });
    const objectives = await db.getObjectivesByProbationerId(target.id);
    const checkIns = await db.getCheckInsByProbationerId(target.id);
    const derivedStatus = getDerivedStatus(target, checkIns);
    const enriched = {
      ...target,
      derivedStatus,
      statusLabel: getStatusLabel(derivedStatus),
      statusColor: getStatusColor(derivedStatus),
      timelineProgress: getTimelineProgress(target),
      daysRemaining: getDaysRemaining(target),
      currentMonth: getCurrentMonth(target),
    };
    return {
      content: [{ type: "text", text: `Logged Month ${saved.checkInNumber} check-in for ${target.fullName} (${target.id}) — ${saved.status}${saved.overallRating ? `, ${saved.overallRating}` : ""}.` }],
      structuredContent: { probationer: enriched, objectives, checkIns, savedCheckIn: saved },
    };
  });

  return server;
}
