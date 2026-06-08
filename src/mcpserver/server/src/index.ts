import "dotenv/config";
import express from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp-server.js";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "probation-tracker-mcp",
    status: "ok",
    endpoints: {
      probation: "/mcp",
    },
  });
});

// ── Probation MCP (no auth) ───────────────────────────────────────────────
app.all("/mcp", async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`🚀 Probation Tracker MCP server running at http://localhost:${PORT}`);
  console.log(`   Probation MCP : http://localhost:${PORT}/mcp`);
});
