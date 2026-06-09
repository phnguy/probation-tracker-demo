---
name: m365-agents-iac-wireup
description: |
  Wire an existing Microsoft 365 Agents Toolkit project so that the Agent Toolkit
  "Provision" and "Deploy" buttons (or `npx teamsapp provision/deploy --env <env>`)
  do real Azure work — create resources via Bicep and push code to Azure App Service.
when_to_use:
  - "make Provision and Deploy buttons work in Agent Toolkit"
  - "wire m365agents.yml to Azure"
  - "scaffold provision and deploy lifecycle"
  - "add Bicep / arm/deploy to an M365 agent project"
  - "deploy MCP server to Azure App Service from Agent Toolkit"
schema_version: m365agents v1.11
---

# m365-agents-iac-wireup

This skill rewrites `m365agents.yml` and the supporting files (`infra/`, `env/.env.*`,
`.gitignore`, `.deployignore`) of a Microsoft 365 Agents Toolkit project so that
**Provision** creates Azure infrastructure with Bicep and **Deploy** ships the code
to Azure App Service. After running it, the user can click Provision then Deploy
in the Agent Toolkit VS Code extension and get a working remote environment.

## What this skill is NOT

- It is **not** for a fresh `azd init` — it patches an existing M365 Agents Toolkit
  project (a `m365agents.yml` already exists with at least `teamsApp/create`,
  `teamsApp/zipAppPackage`, `teamsApp/update`, `teamsApp/extendToM365`).
- It does **not** ask the user clarifying questions — it inspects the repo and
  infers the right answers. Only stop and ask if a critical fact (target Azure
  resource type, build commands) cannot be inferred.

## Step 1 — Inspect the repo

Read these files (parallel where possible) and remember what you find:

| File | What to extract |
| --- | --- |
| `m365agents.yml` | current `provision` actions; absence of `deploy:` stage |
| `m365agents.local.yml` | local debug commands (gives hints on dev script names) |
| `env/.env.*` | which envs exist; existing keys; existing values |
| `env/.env.*.user` | secret keys (must start with `SECRET_`) |
| `.gitignore` | confirm `env/.env.*.user` and `env/.env.<env>` are ignored |
| `appPackage/manifest.json` and any `*-plugin.json` | which `${{VARS}}` are referenced (e.g. `MCP_SERVER_URL`) |
| `infra/*.bicep` | existing infra (App Service / Functions / Storage / etc.) |
| `package.json` (root) | npm workspaces? scripts? |
| `src/**/package.json` | per-project build commands; production deps |
| Any `widgets/build.*` or `vite.config.*` | ad-hoc build scripts that must run before zip |

From this, infer:

- **Target compute**: Azure App Service (Linux Node.js) is the default. Azure
  Functions or SWA only if the project clearly requires it (e.g. `host.json`,
  `staticwebapp.config.json`).
- **What to build**: list every workspace that has a `build` script and produces
  output consumed at runtime (server `dist/`, widgets `assets/*.html`, etc.).
- **What to ship**: the runtime closure — `dist/`, prod-only `node_modules/`,
  `package.json`, plus any built assets. Not source, tests, or markdown.
- **Runtime app settings the server expects**: scan `process.env.*` references in
  the server source code. Each one must end up as an App Service setting.
- **Which `${{VARS}}` the manifest interpolates**: those must exist in `env/.env.<env>`
  by the time `teamsApp/zipAppPackage` runs.

## Step 2 — Generate `infra/azure.bicep`

Required structure (App Service path):

```bicep
@description('Base name used for all resources')
param baseName string = '<short-project-key>'

@description('Environment suffix, e.g. dev/test/prod')
param envSuffix string = 'dev'

@description('Location for all resources')
param location string = resourceGroup().location

@description('SKU for the App Service Plan')
param appServicePlanSku string = 'F1'   // pick F1 only if dev tenant has no B1 quota

@description('Node runtime version for the App Service')
param nodeVersion string = 'NODE|22-lts'

// Add @secure() params for any secret your server needs:
@secure()
param aadAppClientSecret string
param aadAppClientId string
param teamsAppTenantId string
// ... add more as needed

// Resources: storage / tables / app service plan / site
// (omit storage if the server doesn't need it)

resource site 'Microsoft.Web/sites@2023-12-01' = {
  // ...
  properties: {
    siteConfig: {
      linuxFxVersion: nodeVersion
      appCommandLine: 'node server/dist/index.js'  // adjust to staged layout
      alwaysOn: appServicePlanSku != 'F1' && appServicePlanSku != 'D1'
      appSettings: [
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~22' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'AAD_APP_CLIENT_ID', value: aadAppClientId }
        { name: 'AAD_APP_CLIENT_SECRET', value: aadAppClientSecret }
        { name: 'TEAMS_APP_TENANT_ID', value: teamsAppTenantId }
        // ... one entry per process.env.* the server reads
      ]
    }
  }
}

// Outputs: emit anything the toolkit / yaml needs downstream
output appServiceResourceId string = site.id
output mcpServerUrl string = 'https://${site.properties.defaultHostName}'
```

### CRITICAL — Bicep output → env-var naming

Toolkit takes each Bicep `output` and writes it to `env/.env.<env>` by
**uppercasing the camelCase identifier and stripping underscores**:

| Bicep output name      | Resulting env var      |
| ---------------------- | ---------------------- |
| `appServiceResourceId` | `APPSERVICERESOURCEID` |
| `mcpServerUrl`         | `MCPSERVERURL`         |
| `storageAccountName`   | `STORAGEACCOUNTNAME`   |

**Always** reference these in `m365agents.yml` exactly as written — e.g.
`${{APPSERVICERESOURCEID}}`. Using `APP_SERVICE_RESOURCE_ID` will fail with
`Unresolved placeholders`.

If the manifest already references something like `${{MCP_SERVER_URL}}` (with
underscores), keep that variable manually written in `env/.env.<env>` AND emit
the same value as a no-underscore output — or rename the manifest var to match
the no-underscore form.

## Step 3 — Generate `infra/azure.parameters.json`

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "envSuffix": { "value": "${{TEAMSFX_ENV}}" },
    "appServicePlanSku": { "value": "F1" },
    "aadAppClientId": { "value": "${{AAD_APP_CLIENT_ID}}" },
    "aadAppClientSecret": { "value": "${{SECRET_AAD_APP_CLIENT_SECRET}}" },
    "teamsAppTenantId": { "value": "${{TEAMS_APP_TENANT_ID}}" }
  }
}
```

Only `${{SECRET_*}}` values may come from `env/.env.<env>.user` — all other
interpolations must come from `env/.env.<env>`.

## Step 4 — Generate a stage script (only if shipping a non-trivial layout)

For projects where `azureAppService/zipDeploy` cannot just zip a single
`dist/` folder (e.g. Node.js apps that need prod-only `node_modules` + extra
asset folders), create `infra/stage.mjs`:

```js
// installs --omit=dev in server/, copies dist + node_modules + package.json
// + assets/ into a clean stage directory referenced by zipDeploy.
```

Layout the script must produce, matching the Bicep `appCommandLine`:

```
deploy-stage/
  server/
    package.json
    dist/
    node_modules/      # production only
  assets/              # only if the server serves static HTML
```

Skip this whole step if a single `dist/` folder is enough.

## Step 5 — Rewrite `m365agents.yml`

```yaml
# yaml-language-server: $schema=https://aka.ms/m365-agents-toolkits/v1.11/yaml.schema.json
version: v1.11
environmentFolderPath: ./env

provision:
  - uses: arm/deploy
    with:
      subscriptionId: ${{AZURE_SUBSCRIPTION_ID}}
      resourceGroupName: ${{AZURE_RESOURCE_GROUP_NAME}}
      bicepCliVersion: v0.30.23           # download Bicep CLI if not on PATH
      templates:
        - path: ./infra/azure.bicep
          parameters: ./infra/azure.parameters.json
          deploymentName: <project-key>-${{TEAMSFX_ENV}}
  - uses: teamsApp/create
    with:
      name: <app-name>${{APP_NAME_SUFFIX}}
    writeToEnvironmentFile:
      teamsAppId: TEAMS_APP_ID
  - uses: teamsApp/zipAppPackage
    with:
      manifestPath: ./appPackage/manifest.json
      outputZipPath: ./appPackage/build/appPackage.${{TEAMSFX_ENV}}.zip
      outputFolder: ./appPackage/build
  - uses: teamsApp/update
    with:
      appPackagePath: ./appPackage/build/appPackage.${{TEAMSFX_ENV}}.zip
  - uses: teamsApp/extendToM365
    with:
      appPackagePath: ./appPackage/build/appPackage.${{TEAMSFX_ENV}}.zip
    writeToEnvironmentFile:
      titleId: M365_TITLE_ID
      appId: M365_APP_ID

deploy:
  - uses: cli/runNpmCommand
    with:
      workingDirectory: src/<server>
      args: install --no-audit --no-fund
  - uses: cli/runNpmCommand
    with:
      workingDirectory: src/<server>
      args: run build
  # repeat for every workspace that has runtime-consumed build output (widgets, etc.)
  - uses: script
    with:
      run: node infra/stage.mjs       # only if Step 4 produced a stage script
  - uses: azureAppService/zipDeploy
    with:
      artifactFolder: <stage-output-or-dist-folder>
      ignoreFile: .deployignore
      resourceId: ${{APPSERVICERESOURCEID}}   # NOTE: no underscores
```

## Step 6 — Update env files

`env/.env.<env>` (committed, no secrets):
```
TEAMSFX_ENV=<env>
APP_NAME_SUFFIX=<env>
AZURE_SUBSCRIPTION_ID=<subId>
AZURE_RESOURCE_GROUP_NAME=<rg-name>
TEAMS_APP_TENANT_ID=<tenantId>
AAD_APP_CLIENT_ID=<clientId>
# Any var the manifest already references (MCP_SERVER_URL etc.)
```

`env/.env.<env>.user` (gitignored, secrets only — must start with `SECRET_`):
```
SECRET_AAD_APP_CLIENT_SECRET=<secret>
```

`env/.env.<env>.sample` (committed, doc-only):
- mirror keys with empty values + comment for the `.user` keys.

## Step 7 — `.gitignore` and `.deployignore`

`.gitignore` must ignore:
```
env/.env.*.user
env/.env.<each-non-local-env>
```

Create `.deployignore` so `zipDeploy` skips dev-only files:
```
.git/
.github/
.vscode/
*.md
src/                   # source — only the staged dist is shipped
tests/
*.test.*
node_modules/.cache/
```

## Step 8 — Verify, do not just edit

After writing files, run (or instruct the user to run):

1. `npx teamsapp provision --env <env>` — must succeed end-to-end.
2. `curl -I https://<app-service>.azurewebsites.net/<health-route>` — must
   eventually return 2xx (App Service may need ~30s to warm up after first deploy).
3. `npx teamsapp deploy --env <env>` — must succeed end-to-end.

If anything fails, consult the troubleshooting table below before changing
unrelated things.

## Troubleshooting cheatsheet

| Error | Root cause | Fix |
| --- | --- | --- |
| `InvalidYamlSchemaError ... Unable to parse yaml file` | Action key not in v1.11 schema, or extra property like `writeToEnvironmentFile` on `arm/deploy`, or `script.shell: pwsh` (must be a path) | Validate against `https://aka.ms/m365-agents-toolkits/v1.11/yaml.schema.json`. `arm/deploy` has no `writeToEnvironmentFile` — outputs are auto-saved. Drop `shell:` from `script` and rely on default. |
| `CompileBicepError ... spawn bicep ENOENT` | Bicep CLI not on PATH | Add `bicepCliVersion: v0.30.23` (or any released version) under `arm/deploy.with`. |
| `Unresolved placeholders ["FOO_BAR"]` in deploy | Variable name in yaml does not match what `arm/deploy` wrote | Bicep outputs become `UPPERCASENOUNDERSCORE`. Use `${{APPSERVICERESOURCEID}}`, not `${{APP_SERVICE_RESOURCE_ID}}`. |
| `MissingEnvironmentVariablesError ... SECRET_X` | Secret missing from `env/.env.<env>.user` | Secrets must be prefixed `SECRET_` and live in `.user` file. |
| App Service responds 404 / Cannot GET /mcp | Wrong `appCommandLine` or wrong `artifactFolder` layout | Make `appCommandLine` match the staged layout (`server/dist/index.js`, etc.). |
| App Service 401/500 on a specific route | Runtime app settings missing (e.g. `AAD_APP_CLIENT_SECRET`) | Add to Bicep `appSettings`; re-provision; remember secret comes from `${{SECRET_*}}` parameter. |
| `arm/deploy` leaks a secret in deployment outputs | `output ... = ...storageConnectionString` | Either don't output it, or annotate `#disable-next-line outputs-should-not-contain-secrets` and accept the warning. |

## Conventions to remember

1. **Bicep output naming**: camelCase becomes UPPERCASE-NO-UNDERSCORES. Always.
2. **Secrets**: `@secure()` Bicep param ⇐ `${{SECRET_*}}` parameters file ⇐ `env/.env.<env>.user`.
3. **Order in `provision`**: `arm/deploy` first, then `teamsApp/create`, `teamsApp/zipAppPackage`, `teamsApp/update`, `teamsApp/extendToM365`. The Teams package step runs **after** Bicep so the manifest can interpolate Bicep outputs (e.g. `${{MCPSERVERURL}}`).
4. **Stage before zipDeploy**: never zip the source repo. Always stage a clean folder.
5. **Idempotence**: `arm/deploy` with the same `deploymentName` is a safe upsert.
