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

  return server;
}
