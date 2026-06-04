<div align="center">

# 📋 Probation Tracker

**An M365 Copilot Declarative Agent for line managers to track new‑hire probationers**

_Interactive dashboards, detail views, and analytics — rendered inline in Copilot via MCP Apps_

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Apps_SDK-8B5CF6)](https://github.com/modelcontextprotocol/ext-apps)
[![M365 Copilot](https://img.shields.io/badge/M365-Copilot-0078D4?logo=microsoft&logoColor=white)](https://learn.microsoft.com/microsoft-365-copilot/extensibility/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Fluent UI](https://img.shields.io/badge/Fluent_UI-9-0078D4)](https://react.fluentui.dev/)

</div>

---

## ✨ Features

| | |
|---|---|
| 📊 **Dashboard** | Overview of every probationer with search, department/status filters, progress bars, and quick-action cards. |
| 👤 **Probationer Detail** | Per-person view with objectives, monthly check-ins, timeline and notes. |
| 📈 **Reports** | Status distribution, department breakdown, objective/check-in stats, and upcoming reviews. |
| 📅 **Calendar** | Read & manage the signed-in manager's Outlook calendar — list events, find meeting times, book/update/cancel probation check-ins. |

The probation views are **interactive HTML widgets** built with React + Fluent UI, served by an MCP server, and rendered inline in the Copilot chat canvas. The calendar tools talk to Microsoft Graph via on-behalf-of (OBO) auth.

---

## 🏗️ Architecture

```
┌─────────────────────┐
│  M365 Copilot       │
│  Declarative Agent  │   single agent, two plugin actions
│  ┌───────────────┐  │
│  │ probation     │──┼──── HTTP POST ──────┐
│  │ plugin        │  │   (no auth)         │
│  └───────────────┘  │                     │
│  ┌───────────────┐  │                     │
│  │ calendar      │──┼──── HTTP POST ──────┤
│  │ plugin        │  │   (Bearer SSO)      │
│  └───────────────┘  │                     │
└─────────────────────┘                     │
                                            ▼
                       ┌─────────────────────────────────────────┐
                       │   Probation Tracker MCP Server  :3001   │
                       │   (single Node/Express process)         │
                       │                                         │
                       │   ┌──────────────┐    ┌──────────────┐  │
                       │   │  /mcp        │    │ /calendar-mcp│  │
                       │   │  no auth     │    │  Bearer +    │  │
                       │   │              │    │  OBO middlew.│  │
                       │   └──────┬───────┘    └──────┬───────┘  │
                       └──────────┼───────────────────┼──────────┘
                                  │                   │
                ┌─────────────────┘                   └────────────────┐
                ▼                                                      ▼
        ┌──────────────────┐                              ┌────────────────────┐
        │  Azurite Tables  │                              │  Microsoft Graph   │
        │  probationers /  │                              │  /me/events        │
        │  objectives /    │                              │  /me/findMeeting…  │
        │  check-ins       │                              │  /me/calendarView  │
        └──────────────────┘                              └────────────────────┘

        ▲                                                          ▲
        │ widgets render inline                                    │
        │ ui://probation/dashboard.html                            │ token: signed-in
        │ ui://probation/detail.html                               │ manager's identity
        │ ui://probation/reports.html                              │ (delegated)
```

**Key point:** it's **one MCP server** exposing **two endpoints** in the same Node process — not two servers. The endpoints differ only by URL path and auth posture; they share the dev tunnel, lifecycle, and deployment.

**One MCP server process, two endpoints:**

| Endpoint | Auth | Tools | Plugin |
|---|---|---|---|
| `/mcp` | none (anonymous) | `show-probation-dashboard`, `show-probationer-detail`, `show-probation-reports` | `probation-plugin.json` |
| `/calendar-mcp` | Bearer (Entra SSO → OBO → Graph) | `ListEvents`, `ListCalendarView`, `FindMeetingTimes`, `CreateEvent`, `UpdateEvent`, `DeleteEventById`, `CancelEvent`, `AcceptEvent`, `TentativelyAcceptEvent`, `DeclineEvent`, `WhoAmI` | `calendar-plugin.json` |

Both plugins are wired into a single declarative agent (`declarativeAgent.json` → 2 actions) so Copilot can mix tools from both in a single conversation (e.g. "Show me at-risk probationers and book a check-in with each one").

- **Server:** Express + `@modelcontextprotocol/sdk` (Streamable HTTP transport) + `@modelcontextprotocol/ext-apps/server`
- **Widgets:** React 18 + Fluent UI 9, bundled into single‑file HTML by Vite + `vite-plugin-singlefile`
- **Storage:** Azure Tables via `@azure/data-tables` (Azurite locally, real Azure in production)
- **Calendar auth:** Entra SSO from Copilot → server validates Bearer → MSAL OBO swap → Graph delegated calls (`Calendars.ReadWrite`, `MailboxSettings.Read`, `User.Read`)
- **Host bridge:** `@modelcontextprotocol/ext-apps/react` (`useApp`) handles the `ui/initialize` handshake and forwards tool results into the widget

---

## 📂 Project Structure

```
probation-tracker/
├── appPackage/
│   ├── manifest.json            # Teams app manifest
│   ├── declarativeAgent.json    # Agent definition (references 2 plugins)
│   ├── probation-plugin.json    # Probation tools (MCP /mcp, no auth)
│   ├── calendar-plugin.json     # Calendar tools (MCP /calendar-mcp, SSO+OBO)
│   └── instruction.txt          # System prompt for the agent
├── env/
│   └── .env.dev.sample          # Template for env files
├── src/mcpserver/
│   ├── server/                  # MCP server (Express + tools + resources)
│   ├── widgets/                 # React widget sources (dashboard / detail / reports)
│   ├── db/                      # Seed data (JSON)
│   ├── assets/                  # Built widget HTML (generated, gitignored)
│   └── package.json             # Convenience scripts (azurite, seed, dev, build)
├── m365agents.yml               # Provision lifecycle (dev/azure)
└── m365agents.local.yml         # Provision lifecycle (local)
```

---

## 🚀 Quick Start

### Prerequisites

| Tool | Install |
|---|---|
| Node.js 22+ | https://nodejs.org/ |
| Dev tunnel CLI | `winget install Microsoft.devtunnel` |
| M365 Agents Toolkit CLI | `npm install -g @microsoft/m365agentstoolkit-cli --force` |

### Setup

```powershell
# 1. Create env/.env.local
@"
TEAMSFX_ENV=local
APP_NAME_SUFFIX=local
MCP_SERVER_URL=
"@ | Set-Content env/.env.local

# 2. Sign in (one‑time)
devtunnel user login -d
teamsapp auth login m365 --interactive

# 3. Start the dev tunnel and copy the printed URL into env/.env.local
devtunnel host -p 3001 --allow-anonymous
# → https://<id>-3001.<region>.devtunnels.ms

# 4. In a new shell: start Azurite + seed data + MCP server
cd src/mcpserver
npm run install:all
npm run start:azurite      # background — leave running
npm run seed               # populates Tables with demo data
npm run build:widgets      # build the React widgets
npm run dev:server         # MCP server on http://localhost:3001/mcp

# 5. Provision the agent into M365 Copilot
teamsapp provision --env local

# 6. Open M365 Copilot and start chatting with the "probation-tracker (local)" agent
```

---

## 🧪 Try It

Once provisioned, open the **probation-tracker (local)** agent in M365 Copilot and try:

**Probation views:**
- _"Show me the probation dashboard"_
- _"Show details for Sarah Martinez"_
- _"Show me probation reports"_
- _"Who's at risk in Engineering?"_

**Calendar (signed-in manager):**
- _"What's on my calendar today?"_
- _"Find a 30-minute slot with sarah@contoso.com this week"_
- _"Book a probation check-in with Sarah next Tuesday at 2pm"_

**Combined (the point of one agent):**
- _"Find at-risk probationers and book a 30-minute check-in with each of them this week"_

---

## 🛠️ Useful Commands

| Command | Description |
|---|---|
| `npm run start:azurite` | Start Azurite Table service on `127.0.0.1:10002` |
| `npm run seed` | Re‑seed Tables with demo probationers, objectives, check‑ins |
| `npm run dev:server` | Run the MCP server with `tsx watch` |
| `npm run build:widgets` | Build the React widgets to `src/mcpserver/assets/` |
| `npm run inspector` | Launch the MCP Inspector against the running server |
| `teamsapp provision --env local` | Push the manifest to M365 Copilot |

---

## 🔐 Environment Files

| File | Purpose |
|---|---|
| `env/.env.local` | Local dev: `TEAMSFX_ENV`, `APP_NAME_SUFFIX`, `MCP_SERVER_URL` (dev tunnel URL) |
| `env/.env.local.user` | Auto‑created secret store |
| `env/.env.dev` | Azure dev environment (when deploying to a real backend) |

All `.env*` files (except the `.sample`) are **git‑ignored**.

---

## 📚 References

- [Microsoft 365 Copilot extensibility](https://learn.microsoft.com/microsoft-365-copilot/extensibility/)
- [Microsoft 365 Agents Toolkit](https://learn.microsoft.com/microsoft-365-copilot/extensibility/teams-toolkit)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP Apps SDK (`@modelcontextprotocol/ext-apps`)](https://github.com/modelcontextprotocol/ext-apps)
- [Dev tunnels](https://learn.microsoft.com/azure/developer/dev-tunnels/overview)

---

<div align="center">

Made with ❤️ for line managers everywhere.

</div>
