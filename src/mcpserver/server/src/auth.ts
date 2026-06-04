import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { Client as GraphClient } from "@microsoft/microsoft-graph-client";
import "isomorphic-fetch";

export interface AuthContext {
  userAssertion: string;
  userId: string;
  userPrincipalName?: string;
  tenantId: string;
}

const storage = new AsyncLocalStorage<AuthContext>();

export function getAuthContext(): AuthContext {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("No auth context - request was not authenticated");
  return ctx;
}

const TENANT = process.env.TEAMS_APP_TENANT_ID ?? process.env.AAD_APP_TENANT_ID ?? "";
const CLIENT_ID = process.env.AAD_APP_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.AAD_APP_CLIENT_SECRET ?? process.env.SECRET_AAD_APP_CLIENT_SECRET ?? "";

let msal: ConfidentialClientApplication | null = null;
function getMsal(): ConfidentialClientApplication {
  if (!msal) {
    if (!TENANT || !CLIENT_ID || !CLIENT_SECRET) {
      throw new Error(
        `Missing OBO config. Need TEAMS_APP_TENANT_ID, AAD_APP_CLIENT_ID, AAD_APP_CLIENT_SECRET. Got tenant=${!!TENANT} clientId=${!!CLIENT_ID} secret=${!!CLIENT_SECRET}`,
      );
    }
    msal = new ConfidentialClientApplication({
      auth: {
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        authority: `https://login.microsoftonline.com/${TENANT}`,
      },
    });
  }
  return msal;
}

async function getGraphToken(scopes: string[]): Promise<string> {
  const { userAssertion } = getAuthContext();
  const result = await getMsal().acquireTokenOnBehalfOf({
    oboAssertion: userAssertion,
    scopes,
  });
  if (!result?.accessToken) throw new Error("OBO exchange returned no token");
  return result.accessToken;
}

export function getDelegatedGraphClient(
  scopes: string[] = ["User.Read", "Calendars.ReadWrite", "MailboxSettings.Read"],
): GraphClient {
  return GraphClient.init({
    authProvider: async (done) => {
      try {
        const token = await getGraphToken(scopes);
        done(null, token);
      } catch (err) {
        done(err as Error, null);
      }
    },
  });
}

const EXPECTED_SCOPE = "access_as_user";

interface JwtPayload {
  oid?: string;
  sub?: string;
  tid?: string;
  scp?: string;
  aud?: string;
  preferred_username?: string;
  upn?: string;
}

function decodeJwt(token: string): JwtPayload {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("Malformed JWT");
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  const json = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  return JSON.parse(json);
}

function fromBearer(authHeader: string): AuthContext {
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const payload = decodeJwt(token);
  const scopes = (payload.scp ?? "").split(" ");
  if (!scopes.includes(EXPECTED_SCOPE)) {
    throw new Error(`Missing required scope ${EXPECTED_SCOPE} (got: ${payload.scp})`);
  }
  return {
    userAssertion: token,
    userId: payload.oid ?? payload.sub ?? "",
    userPrincipalName: payload.preferred_username ?? payload.upn,
    tenantId: payload.tid ?? TENANT,
  };
}

export const authMiddleware: RequestHandler = (req, res, next) => {
  try {
    const ctx = fromBearer(req.header("authorization") ?? "");
    storage.run(ctx, () => next());
  } catch (err) {
    const msg = (err as Error).message;
    console.warn("[auth] rejected:", msg);
    res.status(401).json({ error: "Unauthorized", message: msg });
  }
};
