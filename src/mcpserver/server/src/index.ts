import "dotenv/config";
import express from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp-server.js";
import { createCalendarMcpServer } from "./calendar-mcp-server.js";
import { authMiddleware } from "./auth.js";
import { workiqCalendarProxy } from "./workiq-calendar-proxy.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "probation-tracker-mcp",
    status: "ok",
    endpoints: {
      probation: "/mcp (Bearer auth required)",
      calendar: "/calendar-mcp (Bearer auth required)",
      workiqCalendar: "/workiq-calendar-mcp (Bearer auth required, OBO to agent365)",
    },
  });
});

// ── Probation MCP (Bearer auth via Copilot SSO; OBO not needed) ───────────
app.all("/mcp", authMiddleware, async (req, res) => {
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

// ── Calendar MCP (Bearer auth via Copilot SSO + OBO to Graph) ─────────────
app.all("/calendar-mcp", authMiddleware, async (req, res) => {
  try {
    const server = createCalendarMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Calendar MCP error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

// ── WorkIQ Calendar MCP (Bearer auth via Copilot SSO + OBO to agent365) ───
app.all("/workiq-calendar-mcp", authMiddleware, workiqCalendarProxy);

app.listen(PORT, () => {
  console.log(`🚀 Probation Tracker MCP server running at http://localhost:${PORT}`);
  console.log(`   Probation MCP        : http://localhost:${PORT}/mcp (Bearer token required)`);
  console.log(`   Calendar MCP (Graph) : http://localhost:${PORT}/calendar-mcp (Bearer token required)`);
  console.log(`   WorkIQ Calendar MCP  : http://localhost:${PORT}/workiq-calendar-mcp (Bearer + OBO to agent365)`);
});
