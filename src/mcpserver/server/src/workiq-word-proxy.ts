import type { RequestHandler } from "express";
import { getAuthContext, getOboToken } from "./auth.js";

const AGENT365_HOST = "https://agent365.svc.cloud.microsoft";
const MCP_SERVER_NAME = process.env.WORKIQ_WORD_MCP_SERVER_NAME ?? "mcp_WordServer";

function upstreamUrl(tenantId: string): string {
  return `${AGENT365_HOST}/agents/tenants/${tenantId}/servers/${MCP_SERVER_NAME}`;
}

function upstreamScope(tenantId: string): string {
  return `${upstreamUrl(tenantId)}/.default`;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "authorization",
]);

export const workiqWordProxy: RequestHandler = async (req, res) => {
  try {
    const { tenantId } = getAuthContext();
    if (!tenantId) {
      res.status(500).json({ error: "Missing tenantId in auth context" });
      return;
    }

    const url = upstreamUrl(tenantId);
    const scope = upstreamScope(tenantId);
    const token = await getOboToken([scope]);

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: req.header("accept") ?? "application/json, text/event-stream",
      "content-type": req.header("content-type") ?? "application/json",
      "mcp-protocol-version": req.header("mcp-protocol-version") ?? "2025-06-18",
    };
    const sid = req.header("mcp-session-id");
    if (sid) headers["mcp-session-id"] = sid;

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const body = hasBody ? JSON.stringify(req.body ?? {}) : undefined;

    const upstream = await fetch(url, {
      method: req.method,
      headers,
      body,
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value);
    });

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    res.on("close", () => reader.cancel().catch(() => undefined));
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error("[workiq-word-proxy] error:", err);
    if (!res.headersSent) {
      res.status(502).json({
        error: "WorkIQ Word proxy failed",
        message: (err as Error).message,
      });
    } else {
      res.end();
    }
  }
};
