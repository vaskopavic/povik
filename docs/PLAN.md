# Povik: implementation plan

Status: draft, 2026-11-20

## 1. What povik is

A web-based API client with Postman's core workflow, built around three promises:

1. **Free team workspaces**: up to 5 per user, with up to 10 members each.
2. **Sandbox links** (`/s/{slug}`) that anyone can open without an account.
3. **Requests run on the user's side**: in the browser, through a small local agent, or in the desktop app. They never pass through our servers. That keeps hosting cost near zero and lets people reach `localhost`, VPN and private APIs.

It ships as a web app first. A desktop app (Electron) follows, built from the same frontend.

Everything is TypeScript in one pnpm + Turborepo monorepo. The request model, importers, variable resolution and the script sandbox are written once and run in the browser, the server, the desktop app, the agent and a CLI.

## 2. Decisions at a glance

| Area | Decision | Why |
|---|---|---|
| Language | TypeScript everywhere | One request model, one set of validators, no code generation |
| Monorepo | pnpm workspaces + Turborepo | pnpm links packages; Turborepo orders tasks and caches build, lint, typecheck and test |
| Runtime | Node (current LTS, pinned in `.nvmrc`) | Electron's main process is Node, so the executor behaves the same everywhere |
| Validation | Zod 4 | Shared by client, server, IPC and the agent protocol |
| Server | Hono on `@hono/node-server` | Static files, OAuth redirects, cookies, WebSocket upgrades |
| API | oRPC, contract-first, served as REST under `/api/v1` | End-to-end types from one contract; OpenAPI document for a public API later |
| Database | PostgreSQL 18, Drizzle ORM, postgres.js driver | `uuidv7()`, JSONB, `LISTEN/NOTIFY`; typed schema and SQL migrations |
| Auth | Arctic for OAuth (GitHub, Google), our own session code | The desktop login and sandbox tokens are custom anyway |
| Frontend | Vite + React 19, client-only SPA | One build runs on the web and in Electron |
| Routing | TanStack Router | Type-safe params and search params; works with any history mode |
| UI kit | Tailwind CSS v4, shadcn/ui, react-resizable-panels, cmdk | Standard parts for a dense, pane-based tool |
| Sidebar tree | dnd-kit + TanStack Virtual | Drag-and-drop and virtualisation we control |
| Editors | CodeMirror 6 for URL bar, body, scripts and response | One editor everywhere; `{{variable}}` highlighting |
| Server state | TanStack Query with oRPC's TanStack Query helpers | Typed query keys and mutations straight from the contract |
| Client state | Zustand | Tabs, drafts, layout |
| Local storage | Dexie (IndexedDB) | Signed-out data, drafts, history, secret values |
| Scripts | Postman-compatible `pm` API in QuickJS (wasm) | Same sandbox in a browser Worker and in Node; scripts can't reach app storage |
| HTTP engine | undici, in one `executor` package | Used by the agent, the desktop main process and the CLI |
| Agent | `npx @povik/agent`; the desktop app can also act as the agent | No separate binary to build and sign |
| CLI | `povik run` for collections in CI | Reuses executor, scripting, importers and runner |
| Browser extension | Not in v1 | The agent and the desktop app cover CORS and localhost |
| Saving | Explicit save (Cmd+S); unsaved edits stay in a local draft | Only saved state is shared, so there is no sync engine to build |
| Realtime | WebSockets from `@hono/node-server` (built in since 2.1) + Postgres `LISTEN/NOTIFY`, optimistic versioning, presence | Works with more than one server instance, no Redis |
| Builds | Vite (web), tsdown (server, agent, CLI, Electron main/preload), electron-builder | Each Node app is bundled into one file with everything it imports |
| Tests | Vitest, Playwright | One test runner across all packages |
| Deploy | Docker (`turbo prune`, bundled server, no `node_modules` in the image), Compose with Caddy + Postgres on one VPS | Cheap to run; the same files work for self-hosting |
| Desktop | Electron + electron-builder, served from an `app://` protocol | Phase 5; the SPA is built for it from day one |

## 3. Architecture

```text
React SPA (browser tab or Electron window)
 │
 ├── REST (oRPC) + WebSocket ───► apps/server (Hono, Node) ───► PostgreSQL
 │                                 stores workspaces, collections,
 │                                 environments (no secret values)
 │
 └── Transport (sends the user's API requests)
      ├── browser fetch ─────────► target API (only if it allows CORS)
      ├── WebSocket ──► agent on 127.0.0.1 ──────────► any API, incl. localhost / VPN
      │                 (npx @povik/agent, or the desktop app)
      └── Electron IPC ──► desktop main process ─────► any API
                           (@povik/executor in-process)
```

The server never sees the requests users send or the responses they get back. It also never sees secret variable values or request history.

## 4. Monorepo

### 4.1 Layout

```text
povik/
├── apps/
│   ├── web/                 # Vite + React SPA
│   ├── server/              # Hono + oRPC API, serves the SPA in production
│   ├── desktop/             # Electron shell (phase 5)
│   ├── agent/               # @povik/agent: npx-able local agent
│   └── cli/                 # @povik/cli: `povik run` (phase 2)
├── packages/
│   ├── spec/                # Zod schemas + types: request, folder, collection, environment,
│   │                        #   ExecRequest/ExecResult, agent messages
│   ├── contract/            # oRPC API contract (inputs, outputs, routes, errors)
│   ├── core/                # variable resolution, auth inheritance, building an ExecRequest
│   │                        #   from a saved request, collection runner, cURL export
│   ├── scripting/           # QuickJS `pm` sandbox + bundled require() modules
│   ├── importers/           # Postman v2.1, Postman environment, cURL, OpenAPI 3; Postman export
│   ├── executor/            # undici HTTP engine (Node only)
│   ├── agent-server/        # WebSocket server with pairing and origin checks (Node only)
│   ├── db/                  # Drizzle schema, migrations, query helpers (server only)
│   └── config/              # tsconfig bases and ESLint presets (base, isomorphic, react)
├── e2e/                     # Playwright tests against the built server + web
├── turbo.json
├── pnpm-workspace.yaml
├── package.json             # root scripts only; packageManager pinned
├── .nvmrc
├── Dockerfile
└── docker-compose.yml       # local Postgres and self-hosting
```

### 4.2 Where each package runs

| Package | Browser | Server | Desktop main | Agent | CLI |
|---|:-:|:-:|:-:|:-:|:-:|
| `spec` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `contract` | ✓ | ✓ | | | |
| `core` | ✓ | | | | ✓ |
| `scripting` | ✓ (Worker) | | | | ✓ |
| `importers` | ✓ | | | | ✓ |
| `executor` | | | ✓ | ✓ | ✓ |
| `agent-server` | | | ✓ | ✓ | |
| `db` | | ✓ | | | |

### 4.3 Package rules

- **Internal packages ship TypeScript source.** Each exports `./src/index.ts` and has no build step of its own. Vite compiles them for the web. The server, agent and CLI list every dependency, internal or not, under `devDependencies`, and tsdown bundles all `devDependencies` into the output. Nothing at runtime depends on an unbuilt internal package, which matters for `@povik/agent` and `@povik/cli` because they are published to npm.
- **Tool versions:** Node 26, pnpm 12 through corepack (Node 25+ no longer ships corepack, so it's installed once), TypeScript 6.0 (typescript-eslint doesn't support TypeScript 7 yet).
- **Packages that run in both browser and Node** (`spec`, `contract`, `core`, `scripting`, `importers`) don't list `@types/node`, so a `node:` import or a Node global fails type-checking.
- **Browser-only globals are a lint error in those packages.** Their tsconfig includes the DOM lib for `URL`, `fetch` and `TextEncoder`, which also lets `localStorage`, `document` and friends type-check. The `@povik/config/eslint/isomorphic` preset bans them, because they crash in the CLI and the agent.
- **Server-only and Node-only packages stay out of the web bundle.** pnpm only lets a package import what its own `package.json` lists, and `apps/web` doesn't list `db`, `executor` or `agent-server`.
- **Bundles can't silently depend on `node_modules`.** The server, agent and CLI builds set tsdown's `deps.onlyImport: []`, so the build fails if the output imports anything other than a Node built-in (for example, a package added under `dependencies` by mistake).
- **Code that runs on users' machines targets Node 22.** `executor`, `agent-server`, `agent` and `cli` type-check against `@types/node` 22 (the `node22` catalog), the agent and CLI declare `engines: node >=22`, and CI runs their packed tarballs on Node 22. Electron's bundled Node also lags the server's.
- **TypeScript settings:** `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`.
- **Lint and format:** ESLint (typescript-eslint) and Prettier, shared from `packages/config`.

### 4.4 Turborepo tasks

| Task | Notes |
|---|---|
| `dev` | Persistent and not cached. Runs `apps/web` (Vite on `:5180`) and `apps/server` (`tsx watch` on `:8080`). Vite proxies `/api` and `/auth` to the server |
| `build` | `dependsOn: ["^build"]`, outputs `dist/**`. Only apps have a real build |
| `transit` | No script. `typecheck` and `test` depend on it, which puts every workspace dependency's files into their cache key; without it, a change in `packages/spec` replays a cached, green web type check |
| `typecheck` | `tsc --noEmit` per package, in parallel |
| `lint` | ESLint per package |
| `test` | Vitest per package. `POVIK_TEST_DATABASE_URL` is part of the cache key, so setting it reruns the database tests instead of replaying a run that skipped them |
| `e2e` | Depends on `build` of `web` and `server` |
| `db:generate`, `db:migrate` | Drizzle Kit in `packages/db`; not cached |

`docker compose up -d postgres` starts the local database on `localhost:54329` (not 5432, to avoid clashing with a Postgres already installed). `pnpm dev` starts everything else.

## 5. Shared request model (`packages/spec`)

Every shape is a Zod schema with its type inferred from it. The same schema validates a form in the browser, an import file, an API input on the server, a JSONB column before it is written, an IPC message in Electron and a message to the agent.

| Schema | Fields |
|---|---|
| `RequestSpec` | `method`, `url`, `params`, `headers`, `body`, `auth`, `scripts {preRequest, test}`, `settings`, `description`, `examples` |
| `FolderSpec` | `description`, `auth`, `scripts` |
| `CollectionSpec` | `description`, `auth`, `scripts`, `variables` |
| `Environment` | `name`, `variables: {key, value, secret, enabled}[]` |
| `ExecRequest`, `ExecResult` | What a transport sends and gets back (section 7.1) |
| `AgentMessage` | `hello`, `exec`, `cancel`, `result`, `error` |

Every spec carries a `specVersion` so its shape can change later with a data migration. Fields povik doesn't model are kept under a `postman` key, so a Postman import exports back without loss.

## 6. Frontend (`apps/web`)

### 6.1 Client-only rules

- **No server rendering.** All data comes from the API through the oRPC client.
- **The API URL is configurable.** It's the same origin in production, `VITE_API_URL` in dev, and the configured server URL in the desktop app. Code never assumes the API shares the page's origin.
- **Platform features go through one module.** Storage of secrets, login, file dialogs, opening links and sending requests all go through `platform`. That module is the only code that differs between web and desktop.

```ts
export interface Platform {
  kind: 'web' | 'desktop';
  apiBaseUrl: string;
  transports(): Transport[]; // in preference order
  secrets: {
    get(envId: string, key: string): Promise<string | undefined>;
    set(envId: string, key: string, value: string): Promise<void>;
    delete(envId: string, key: string): Promise<void>;
  };
  auth: {
    login(provider: 'github' | 'google'): Promise<void>; // web: redirect; desktop: system browser
    bearerToken(): Promise<string | null>; // desktop only; web uses the cookie
  };
  openExternal(url: string): void;
  saveFile(name: string, data: Blob): Promise<void>;
  openFile(accept: string[]): Promise<File | null>;
}

export interface Transport {
  id: 'browser' | 'agent' | 'desktop';
  available(): Promise<boolean>;
  send(req: ExecRequest, signal: AbortSignal): Promise<ExecResult>;
}
```

### 6.2 Routes

| Route | Screen |
|---|---|
| `/` | Local workspace (signed out) or the user's personal workspace |
| `/w/$slug` | Team or personal workspace |
| `/s/$slug` | Sandbox |
| `/invite/$token` | Accept an invite |
| `/login`, `/settings` | Sign-in, account and agent settings |

The active request is a search param (`?r=<nodeId>`), so a link can point to one request.

### 6.3 Layout

- **Sidebar:** workspace switcher, collection tree, environments, history.
- **Tabs:** one per open request. Each tab holds a draft until it is saved.
- **Request editor:** method, URL bar, and tabs for Params, Headers, Body, Auth, Scripts and Settings.
- **Response panel:** status, time and size, plus tabs for Body (pretty, raw, preview), Headers, Timings (agent and desktop only), Console and Test results.
- **Environment selector** in the header, and a **command palette** on Cmd+K.

### 6.4 Request features in v1

- **Methods:** GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS and custom.
- **Body:** none; raw (JSON, text, XML, HTML, JavaScript); `x-www-form-urlencoded`; `form-data` with text fields and files; binary. File contents are never saved to the server, only their names.
- **Auth:** none, inherit, bearer, basic and API key (header or query). OAuth 2.0 client credentials comes in phase 2. Auth is inherited from collection to folder to request.
- **Per-request settings:** follow redirects, timeout, verify TLS (agent and desktop only).
- **Response viewer:**
  - JSON is pretty-printed with folding and search. Above 5 MB it opens in raw view.
  - HTML previews render in an `<iframe sandbox>` via `srcdoc`, never in the app's own origin.
  - Images are shown through blob URLs.
- **Copy as cURL.**

### 6.5 Variables (`packages/core`)

Resolution order, highest priority first:

1. Values set by a script during the run (`pm.variables.set`).
2. The environment's current value, which lives only on this device.
3. The environment's shared value, stored on the server.
4. Collection variables.

Dynamic variables: `{{$guid}}`, `{{$randomUUID}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`.

The URL bar highlights unresolved variables in red and shows each value on hover. Unresolved variables are sent as written.

### 6.6 Local data (Dexie)

| Table | Contents |
|---|---|
| `local_collections`, `local_nodes`, `local_environments` | The signed-out "Local" workspace |
| `drafts` | Unsaved edits per open tab |
| `secrets` | Current values of secret variables, keyed by environment and key (web only; desktop uses `safeStorage`) |
| `history` | Last 500 sends per workspace: the request and response metadata, with bodies capped at 256 KB |
| `settings` | Agent pairing token, layout, trusted collections |

History stays on the device and is never uploaded.

### 6.7 Import and export (`packages/importers`)

Parsing happens on the client (web or CLI). The server receives an already normalised collection through one bulk endpoint and validates it against `packages/spec`.

- **Postman Collection v2.1:** import and export, lossless round trip (section 5).
- **Postman environment** JSON.
- **cURL:** our own tokenizer for the common flags: `-X`, `-H`, `-d`/`--data*`, `-F`, `-u`, `-b`, `-k`, `--url`, `--compressed`.
- **OpenAPI 3.x** via `@scalar/openapi-parser`. It creates a folder per tag and a request per operation, with example bodies built from the schemas.

## 7. Running requests

### 7.1 Protocol

`ExecRequest` and `ExecResult` are Zod schemas in `packages/spec`. Every transport uses them, and every boundary validates them: the agent's WebSocket and Electron's IPC.

```ts
type ExecRequest = {
  id: string; // used for cancel
  method: string;
  url: string; // variables already resolved
  headers: [name: string, value: string][]; // order and duplicates kept
  body:
    | { kind: 'none' }
    | { kind: 'text'; text: string }
    | { kind: 'bytes'; base64: string }
    | { kind: 'multipart'; parts: MultipartPart[] };
  options: {
    followRedirects: boolean;
    maxRedirects: number;
    timeoutMs: number;
    verifyTls: boolean;
    maxBodyBytes: number;
  };
};

type ExecResult =
  | {
      id: string;
      ok: true;
      status: number;
      statusText: string;
      httpVersion: string;
      headers: [string, string][];
      body: { base64: string; truncated: boolean; encodedBytes: number; decodedBytes: number };
      redirects: { status: number; url: string }[];
      remoteAddress?: string;
      timings: { dnsMs?: number; connectMs?: number; tlsMs?: number; firstByteMs: number; totalMs: number };
    }
  | {
      id: string;
      ok: false;
      error: {
        code: 'cors' | 'network' | 'dns' | 'tls' | 'timeout' | 'aborted' | 'too_large';
        message: string;
      };
    };
```

### 7.2 Choosing a transport

The default order is desktop (inside Electron), then the agent (if paired and connected), then browser `fetch`. A user can pin one transport per workspace.

The browser transport has limits, and the UI states them instead of failing silently:

- It only reaches APIs that allow cross-origin requests. A CORS failure shows a prompt to start the agent.
- The browser drops forbidden headers (`Cookie`, `Host`, `Origin`, `Content-Length` and others). The header editor marks them.
- Every request uses `credentials: 'omit'`, so the user's own browser cookies never leak into requests.
- It can't show redirect hops or a timing breakdown, only the total time.

### 7.3 Executor (`packages/executor`)

- **Engine:** undici's `request()` on its own `Agent`, so headers keep their order and duplicates and nothing is decompressed or redirected behind our back.
- **Timings:** a custom connector times DNS lookup, TCP connect and the TLS handshake; first byte and total are timed around the request.
- **Redirects:** followed or not, per request. The executor follows them itself, so every hop is recorded.
- **Cookies:** one `tough-cookie` jar per agent, desktop or CLI session, which the user can clear.
- **Compression:** gzip, deflate, br and zstd are decoded with `node:zlib`. Both encoded and decoded sizes are reported.
- **Response size:** bodies are streamed, with a 50 MB default cap that can be changed in settings.
- **Proxies** come from the environment (undici's `EnvHttpProxyAgent`). **HTTP/2** is used when the server offers it (`allowH2`).
- **Cancellation** works by request id.

### 7.4 Agent (`packages/agent-server`, `apps/agent`)

- **Distribution:** `npx @povik/agent`. It needs Node, which nearly everyone testing a localhost API already has. The desktop app runs the same agent server, so someone with the desktop app needs nothing else. A standalone binary (Node single executable) can come later if people ask for it.
- **Listening:** `127.0.0.1:47123` only, using the `ws` package; the port can be changed.
- **Checks on every connection:**
  - The `Host` header must be `127.0.0.1` or `localhost`, which blocks DNS rebinding.
  - The `Origin` must be on the allowlist: the public app URL, plus `http://localhost:5180` in dev.
  - The pairing token must be valid.
  - Every message must parse as an `AgentMessage`.
- **Pairing:** on first run the agent shows a 6-digit code. The web app asks for it once and receives a token, stored in Dexie, which every connection's `hello` message must carry. Without this, any website the user visits could use the agent as a proxy into their network.
- **Chrome's permission prompt:** Chrome asks the user for local network permission the first time a public site connects to `127.0.0.1`. The onboarding screen explains this before it appears.

## 8. Scripts (`packages/scripting`)

**Engine.** `quickjs-emscripten`:

- **In the browser** it runs inside a dedicated Web Worker. A plain Worker without QuickJS isn't enough, because a same-origin Worker can read IndexedDB (where secrets live) and make any request it likes.
- **Build:** use the QuickJS variant that embeds its wasm in the JavaScript file, so neither Vite nor tsdown needs extra asset handling. The Worker entry type-checks with the `WebWorker` lib.
- **In the CLI** it runs in Node with the same host code.
- **Every run** gets a fresh context, with a 5-second timeout and a 64 MB memory cap.
- **Scripts have no ambient APIs:** no `fetch`, no storage, no DOM. Everything comes through `pm`.

**Run order:** collection pre-request → folder pre-request → request pre-request → resolve variables → send → collection tests → folder tests → request tests.

**`pm` API in v1:**

- **Request and response:**
  - `pm.request`: method, url, headers and body, editable in pre-request scripts.
  - `pm.response`: `code`, `status`, `headers`, `json()`, `text()`, `responseTime`.
- **Variables:** `pm.variables`, `pm.environment` and `pm.collectionVariables`, each with `get`, `set`, `unset` and `has`.
- **Tests:** `pm.test`, and `pm.expect` (chai).
- **Flow:**
  - `pm.sendRequest`, with callback and promise forms. It goes through the same transport as the main request.
  - `pm.execution.setNextRequest` and `pm.execution.skipRequest`, used by the runner.
- **Run info:** `pm.info`.
- **Legacy API:** the common old forms (`postman.setEnvironmentVariable`, `tests[...]`, `responseBody`), because older collections still use them.
- **`require()`:** crypto-js, ajv, uuid, lodash, moment and chai, bundled at build time into one prelude file that is loaded into each context.
- **Utilities:** `atob`/`btoa`, and a `console` captured into the Console tab.

**Variable writes from scripts** update the local current values only. They are never saved to the server automatically.

**Trust.** Workspace collections run their scripts. Collections from sandbox links and imported files don't run any script until the user clicks "Trust scripts" for that collection. A script can read every variable, including secrets, and send it anywhere through `pm.sendRequest`. The trust prompt is the real safeguard. The CLI runs scripts in any file it is given; running a file from the command line is the trust decision.

**Collection runner** (`packages/core`). It runs a folder or collection in order, follows `setNextRequest` and `skipRequest`, supports an iteration count and a delay, and reports pass/fail per test. The web app and the CLI use the same runner with different transports.

**CLI** (`apps/cli`). `povik run collection.json -e env.json` runs a Postman or povik collection through the executor and exits non-zero when a test fails. JUnit output is included, for CI.

**Acceptance fixtures** live in `packages/scripting/fixtures/` and run in CI against a local test server, both in the browser (Vitest browser mode) and through `povik run`. They cover:

- fetching a token with `pm.sendRequest` and passing it to the next request
- HMAC request signing with crypto-js
- ajv schema assertions
- a `setNextRequest` loop

## 9. Backend (`apps/server`)

### 9.1 Server process

- **Commands:** `node dist/index.mjs serve` (the default) and `node dist/index.mjs migrate`.
- **Migrations:** Drizzle Kit generates SQL files in `packages/db/src/migrations`, which are committed. `serve` applies pending migrations on start while holding a Postgres advisory lock, so two instances starting together don't race. Set `POVIK_AUTO_MIGRATE=false` to turn that off.
  - **Rule for migrations from branches:** Drizzle only applies migrations newer than the last one applied. A migration generated on an older branch and merged after a newer one is skipped silently, so after rebasing, delete it and run `pnpm db:generate` again.
- **Database connection:** `LISTEN` (realtime) and the migration lock need a session-level connection. A PgBouncer in transaction mode breaks both; if a host forces one, add a separate direct database URL for them.
- **Config** comes from environment variables, parsed with Zod at start: `POVIK_DATABASE_URL`, `POVIK_PUBLIC_URL`, `POVIK_GITHUB_CLIENT_ID`/`_SECRET`, `POVIK_GOOGLE_CLIENT_ID`/`_SECRET`, `POVIK_ALLOWED_ORIGINS`.
- **Logging:** pino, JSON to stdout. Request and collection bodies are never logged, because they contain credentials.
- **Health checks:** `/healthz` for the process, `/readyz` for the database.

### 9.2 API

- **The contract** in `packages/contract` declares every procedure's input and output (Zod schemas from `packages/spec`), its HTTP method and path, and its typed errors.
- **The server** implements the contract and serves it as REST under `/api/v1` with oRPC's OpenAPI handler, mounted in Hono.
- **The web app** calls it through oRPC's OpenAPI client link with the same contract, and gets typed TanStack Query options from oRPC's TanStack Query helpers. There's no code generation step.
- **An OpenAPI document** is generated from the contract and served at `/api/v1/openapi.json`, ready for a public API later.

| Endpoint | Purpose |
|---|---|
| `GET /auth/{provider}/start`, `GET /auth/{provider}/callback` | OAuth for web and desktop (plain Hono routes) |
| `POST /api/v1/auth/desktop/exchange` | Desktop: one-time code + PKCE verifier → bearer token |
| `POST /api/v1/auth/logout` | End the session |
| `GET /api/v1/me` | Current user and their workspaces |
| `GET, POST /api/v1/workspaces` | List workspaces, create a team workspace |
| `GET, PATCH, DELETE /api/v1/workspaces/{id}` | Read, rename or delete a workspace |
| `GET /api/v1/workspaces/{id}/members`, `PATCH, DELETE …/members/{userId}` | Members and roles |
| `POST /api/v1/workspaces/{id}/invites`, `DELETE …/invites/{id}`, `POST /api/v1/invites/{token}/accept` | Invite links |
| `GET, POST /api/v1/workspaces/{id}/collections` | List or create collections |
| `GET /api/v1/collections/{id}` | A collection with its whole node tree, in one call |
| `PATCH, DELETE /api/v1/collections/{id}` | Update or delete a collection |
| `POST /api/v1/collections/{id}/nodes`, `PATCH, DELETE /api/v1/nodes/{id}`, `POST /api/v1/nodes/{id}/move` | Folders and requests |
| `POST /api/v1/workspaces/{id}/import` | Create a parsed collection in one transaction |
| `GET, POST /api/v1/workspaces/{id}/environments`, `PATCH, DELETE /api/v1/environments/{id}` | Environments |
| `POST /api/v1/sandboxes`, `GET /api/v1/sandboxes/{slug}`, `POST /api/v1/sandboxes/{slug}/claim` | Create (anonymous allowed), open, move into a workspace |
| `POST /api/v1/realtime/ticket`, `GET /api/v1/realtime` | WebSocket ticket and connection |

A sandbox is a workspace (section 10), so the collection, node and environment endpoints serve sandboxes too. For sandboxes they accept the edit token in `X-Povik-Sandbox-Token` instead of a session.

### 9.3 Serving the SPA

- **Files.** In production the server serves `apps/web/dist`, copied into the image, with Hono's static middleware.
- **Fallback.** Paths that aren't API or asset paths serve `index.html`.
- **Caching.** Hashed files under `/assets/*` are cached as immutable; `index.html` is sent with `no-cache`.
- **Link previews.** For `/s/{slug}`, the server fills `<title>` and the Open Graph tags with the sandbox's name before sending `index.html`, so links unfurl properly in Slack and similar.
- **Security headers:**
  - CSP with `script-src 'self' 'wasm-unsafe-eval'` and `frame-ancestors 'none'`. `connect-src` has to allow any URL because the browser transport calls arbitrary APIs.
  - `Referrer-Policy: no-referrer`.
  - `X-Robots-Tag: noindex` on sandbox pages.

### 9.4 Authentication

- **OAuth:** GitHub and Google through Arctic, with a state cookie, and PKCE where the provider supports it.
- **Accounts:** `users` plus an `identities` table. A first sign-in with a provider whose provider-verified email matches an existing user links to that user; otherwise it creates a new one. Every new user gets a personal workspace.
- **Sessions** (our own code, about 200 lines):
  - The token is 32 random bytes, base64url-encoded. Only its SHA-256 hash is stored.
  - **Web:** cookie `__Host-povik_session` on HTTPS (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`), 30 days, renewed while in use. The `__Host-` prefix stops a sibling subdomain from planting a session cookie, which matters on self-hosted installs. Plain `povik_session` on `http://localhost` in dev, where the prefix's `Secure` requirement can't be met everywhere. Decide the name before the first session is issued: renaming it later signs everyone out.
  - **Desktop:** the same kind of token, sent as `Authorization: Bearer`.
- **CSRF:** a cookie-authenticated request other than GET must carry an `Origin` equal to `POVIK_PUBLIC_URL`. This check is the main defence, not a backup: oRPC also accepts form-encoded and multipart bodies, so a plain cross-site HTML form would reach the handlers.
- **Who is calling:** the API context gets an `auth` field saying how the request authenticated (cookie, bearer token or sandbox edit token) instead of a raw cookie value, so every handler checks permissions the same way.
- **Client IP:** taken from `X-Forwarded-For` only when the request comes from the reverse proxy (Caddy); otherwise anyone could fake their IP to dodge rate limits.
- **Desktop login:**
  1. The app opens the system browser at `/auth/{provider}/start?client=desktop&challenge=…`.
  2. After OAuth, the server redirects to `povik://auth/callback?code=…`. The code is single-use and expires in 60 seconds.
  3. The app posts the code and its PKCE verifier to `/api/v1/auth/desktop/exchange` and stores the returned token with `safeStorage`.

  Sign-in never happens inside an Electron window: Google blocks OAuth in embedded browsers.
- **WebSocket auth:** `POST /api/v1/realtime/ticket` returns a single-use ticket valid for 30 seconds, which the client passes as `?ticket=…`. Browsers can't set headers on WebSocket connections, so every client uses this flow.
- **CORS:** the API allows the desktop origin `app://povik` for bearer-token calls, without credentials.
- **Rate limits:** per IP on auth and sandbox creation, counted in a small Postgres table. Counters in memory would reset on every deploy and wouldn't be shared once a second instance runs (phase 4).

### 9.5 Roles

| Role | Can |
|---|---|
| owner | Everything, including deleting the workspace and transferring ownership |
| admin | Manage members and invites, plus everything an editor can do |
| editor | Create, edit and delete collections, requests and environments |
| viewer | Read, run requests, and copy a collection into a workspace of their own |

In a sandbox, anyone with the view link can read and run, and anyone with the edit token can edit.

**Member limit.** A team workspace holds at most 10 members, the owner included.

- **Where it's checked:** when someone accepts an invite. The accept transaction locks the workspace row (`SELECT … FOR UPDATE`), counts the members, and fails with a typed `WORKSPACE_FULL` error (409) at 10. Two people accepting at the same moment therefore can't make it 11.
- **Pending invites** don't hold a seat.
- **In the UI:** the members screen shows seats used ("7 of 10"), and an invite link opened while the workspace is full says so instead of failing silently. Removing a member frees a seat.
- **One constant:** `MAX_WORKSPACE_MEMBERS` in `packages/spec`, so the server and the web app always agree.
- **Personal workspaces** have exactly one member and no invites.

**Workspace limit.** A user can own at most 5 team workspaces.

- **What counts:** team workspaces where the user is the owner. Their personal workspace, sandboxes, and team workspaces they were invited to don't count, so being a member of many teams is fine.
- **Where it's checked:** when a user creates a team workspace, and when ownership is transferred to them. The transaction locks the user's row (`SELECT … FOR UPDATE`), counts the team workspaces they own, and fails with a typed `WORKSPACE_LIMIT_REACHED` error (409) at 5. Two creates at the same moment therefore can't make it 6.
- **In the UI:** the workspace switcher shows "3 of 5 team workspaces". At 5 the create button explains the limit, and a transfer to someone at the limit says so before it's sent. Deleting a workspace, or transferring one away, frees a slot.
- **One constant:** `MAX_OWNED_TEAM_WORKSPACES` in `packages/spec`.

## 10. Data model (`packages/db`)

The source of truth is the Drizzle schema in `packages/db/src/schema.ts`. JSONB columns are typed with the matching `packages/spec` type and validated with its Zod schema before every write. The SQL below is the resulting schema. Everything in it can be expressed in Drizzle; the `COLLATE "C"` column uses a small custom column type.

Every piece of content belongs to a workspace. **A sandbox is a workspace with `kind = 'sandbox'`.** That gives one permission check, one realtime channel and one query shape for everything.

```sql
CREATE TABLE users (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    email       text NOT NULL,
    name        text NOT NULL,
    avatar_url  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE identities (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider          text NOT NULL CHECK (provider IN ('github', 'google')),
    provider_user_id  text NOT NULL,
    email             text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id)
);

CREATE TABLE sessions (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    bytea NOT NULL UNIQUE,
    client        text NOT NULL CHECK (client IN ('web', 'desktop')),
    user_agent    text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL
);

CREATE TABLE workspaces (
    id               uuid PRIMARY KEY DEFAULT uuidv7(),
    kind             text NOT NULL CHECK (kind IN ('personal', 'team', 'sandbox')),
    slug             text NOT NULL UNIQUE,
    name             text NOT NULL,
    created_by       uuid REFERENCES users(id) ON DELETE SET NULL, -- NULL for anonymous sandboxes
    edit_token_hash  bytea,                                        -- sandboxes only
    expires_at       timestamptz,                                  -- anonymous sandboxes only
    last_opened_at   timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'sandbox') = (edit_token_hash IS NOT NULL)),
    CHECK (kind = 'sandbox' OR expires_at IS NULL)
);

CREATE TABLE workspace_members (
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role          text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
    joined_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE UNIQUE INDEX one_owner_per_workspace ON workspace_members (workspace_id) WHERE role = 'owner';
CREATE INDEX ON workspace_members (user_id);

CREATE TABLE invites (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    token_hash    bytea NOT NULL UNIQUE,
    role          text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    created_by    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    max_uses      int,                    -- NULL = unlimited
    use_count     int NOT NULL DEFAULT 0,
    expires_at    timestamptz NOT NULL,
    revoked_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collections (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          text NOT NULL,
    spec          jsonb NOT NULL DEFAULT '{}',  -- CollectionSpec
    version       bigint NOT NULL DEFAULT 1,
    created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON collections (workspace_id);

-- Folders and requests in one tree, so they can be interleaved.
CREATE TABLE nodes (
    id             uuid PRIMARY KEY DEFAULT uuidv7(),
    collection_id  uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    parent_id      uuid REFERENCES nodes(id) ON DELETE CASCADE,  -- NULL = collection root
    kind           text NOT NULL CHECK (kind IN ('folder', 'request')),
    name           text NOT NULL,
    sort_key       text COLLATE "C" NOT NULL,                    -- fractional index
    spec           jsonb NOT NULL,                               -- FolderSpec or RequestSpec
    version        bigint NOT NULL DEFAULT 1,
    updated_by     uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (collection_id, parent_id, sort_key)
);

CREATE TABLE environments (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          text NOT NULL,
    variables     jsonb NOT NULL DEFAULT '[]',  -- [{key, value, secret, enabled}]
    version       bigint NOT NULL DEFAULT 1,
    updated_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON environments (workspace_id);
```

**Notes:**

- **Ordering.** `sort_key` is a fractional index. The client generates it with the `fractional-indexing` package. The server checks the format, and the unique constraint rejects collisions, which return 409; the client then picks a new key. `COLLATE "C"` makes keys compare byte by byte.
- **Tree integrity.** A node's parent must be a folder in the same collection. A move is rejected if the target is the node itself or one of its descendants; a recursive CTE checks this in the same transaction.
- **Concurrent edits.** Every update is `… SET version = version + 1 WHERE id = $1 AND version = $2`. Zero rows updated returns a typed `CONFLICT` error (409) with the current row.
- **Secret variables.** For variables with `secret: true`, the server always stores an empty `value`, and the API strips any value sent. The real value stays on the user's device.
- **Ownership.** A personal or team workspace's owner is the member with role `owner`. Deleting an account means transferring or deleting the team workspaces it owns first.

**Limits:**

| What | Limit |
|---|---|
| One request, folder or collection spec | 1 MB |
| Saved example response | 1 MB |
| One collection, all nodes together | 20 MB |
| Anonymous sandbox | 5 MB; deleted 30 days after it was last opened |
| Anonymous sandbox creation | 20 per IP per day |
| Members per team workspace | 10, owner included (section 9.5) |
| Team workspaces a user owns | 5; personal workspace and sandboxes not counted (section 9.5) |

## 11. Realtime and editing model

- **Explicit save.** Edits go into a local draft until the user presses Cmd+S. Only saved state is shared, which keeps conflicts rare and means there's no sync engine to write.
- **Change events.** On every write, the transaction calls `pg_notify('povik', …)` with `{workspaceId, entity, id, version, actorId, op}`. Postgres delivers it only if the transaction commits. The payload carries IDs only, well under NOTIFY's 8 KB limit.
- **Fan-out.** Each server instance holds one `LISTEN` connection (postgres.js `sql.listen`) and a hub of WebSockets keyed by workspace. Clients receive the event and invalidate the matching TanStack Query keys.
- **Presence.** Clients send `{viewing: nodeId}` every 15 seconds. Presence events also go through NOTIFY, so they work with more than one instance from the start.
- **Message types.** WebSocket messages are Zod schemas in `packages/spec`, validated on both ends.
- **Conflicts:**
  - If a tab has unsaved edits and someone else saves the same request, the tab shows: "Ana saved this request. Reload / keep mine."
  - A save that loses the race gets 409 and the same choice, plus a diff.
- **Shutdown:** the server closes the hub's WebSockets before `server.close()`, which otherwise waits on open sockets until the platform kills the process.
- **Not in v1:** live co-editing of the same field (Yjs).

## 12. Sandboxes

- **Creating one.** "Share as sandbox" copies a local or workspace collection into a new sandbox workspace: the collection, its nodes, and the chosen environment with secret values blank. It's a copy, not a live view of the original.
- **Secret scan before sharing.** It looks for literal values (not `{{variables}}`) in `Authorization`, `Cookie` and API-key headers, in auth fields, and in query params such as `token`, `key` and `secret`. It lists what it found and offers to replace each value with a variable.
- **Links:**
  - The view link is `/s/{slug}`; the slug is 10 random base62 characters.
  - The edit link is `/s/{slug}#edit={token}`. The token sits in the URL fragment, so it never reaches server logs or `Referer` headers. The client sends it in `X-Povik-Sandbox-Token`.
- **Lifetime.** A signed-out creator keeps the edit token in their browser, and the sandbox is deleted 30 days after it was last opened. A signed-in creator's sandbox doesn't expire and can be moved into one of their workspaces.
- **Viewers** can run requests (through their own transport) and copy the collection into their local or a workspace collection. Scripts need "Trust scripts" first.
- **Abuse handling:** `noindex`, rate limits, a report link, and an admin command, `node dist/index.mjs sandbox delete <slug>`.

## 13. Desktop app (`apps/desktop`, Electron)

- **Shell.**
  - **Tooling:** Electron with electron-builder. `main` and `preload` are bundled with tsdown, with `@povik/*` packages bundled in.
  - **Loading the SPA:** in dev, the window loads the Vite dev server. In production it loads the `apps/web` build through an `app://povik/` protocol (`protocol.handle`). Unknown paths return `index.html`, so routing works as on the web. Keep browser history routing: hash routing would collide with the `#edit=` token in sandbox links.
  - **Choosing the platform:** the web app picks the desktop implementation at runtime when `window.povik` (the preload bridge) exists, so one build serves both.
  - **CSP:** the server's Content-Security-Policy doesn't apply to `app://`, so the protocol handler sets the same policy on the responses it serves.
  - **Registering the scheme:** `app://` is registered with `protocol.registerSchemesAsPrivileged` (`standard`, `secure`, `supportFetchAPI`, `corsEnabled`). Without that, fetch and IndexedDB don't work on that origin.
- **Requests.** The main process imports `@povik/executor` and runs requests in-process. There's no sidecar.
- **Agent mode.** An opt-in setting, "Let povik in the browser use this app", starts `@povik/agent-server` on `127.0.0.1:47123` with the same pairing and origin checks as the CLI agent.
- **Security settings:**
  - `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
  - The preload exposes only `window.povik` (`send`, `cancel`, `secrets`, `login`, `openExternal`, file dialogs).
  - `main` checks the sender of every IPC call and validates every payload with the Zod schemas from `packages/spec`.
  - All permission requests are denied, navigation away from `app://povik` is blocked, and `window.open` goes to the system browser.
- **Login** follows the desktop flow in 9.4. The token is stored with `safeStorage` (encrypted with the OS keychain).
- **Deep links.** The app holds a single-instance lock and handles `povik://auth/callback` and `povik://s/{slug}`.
- **Server URL** defaults to the hosted service and can be changed for self-hosted servers.
- **Updates** come through electron-updater from GitHub Releases.
- **Code signing** needs an Apple Developer ID with notarisation for macOS, and a Windows signing certificate (Azure Trusted Signing is the cheapest route).

## 14. Infrastructure

- **Docker image:**
  1. `turbo prune @povik/server @povik/web --docker` produces a pruned workspace and lockfile.
  2. Install, then build `apps/web` and `apps/server`.
  3. The final stage is a slim Node image with only `apps/server/dist` (one bundled file plus the SQL migrations) and the web build. It has no `node_modules`.
- **`docker-compose.yml`:** Caddy (TLS), the server, and `postgres:18` with a volume. The same file is the self-hosting setup.
- **Backups:** a nightly `pg_dump` to S3-compatible storage, kept for 14 days. Test a restore before launch.
- **CI (GitHub Actions):**
  - `turbo run lint typecheck test` with a Postgres service container for `packages/db` and `apps/server`. CI doesn't keep Turborepo's cache between runs yet, so every run checks everything.
  - Fails if `packages/db/src/migrations` is out of date with the schema (`drizzle-kit generate` produces a diff).
  - Packs `@povik/agent` and `@povik/cli` and runs the tarballs on Node 22 from a folder with no `node_modules`.
  - Starts the built image against Postgres and checks it serves the app, the API and cached assets.
  - `turbo run e2e`: Playwright against the built server serving the built web app.
  - Builds the image on merge to `main`.
- **Releases:** changesets version and publish `@povik/agent` and `@povik/cli` to npm. The desktop app is released from GitHub Actions with electron-builder.

## 15. Testing

- **Unit (Vitest):** `spec`, `core`, `importers` (Postman, cURL and OpenAPI fixtures, with round-trip export), `contract`.
- **Scripting:** the acceptance fixtures, run in Vitest browser mode and through the CLI in Node.
- **Executor:** tests against local Node HTTP servers covering redirects, compression, timeouts, large bodies and TLS errors.
- **Database and API:** run against real Postgres. Each test file gets its own database, created from a migrated template database.
- **End to end (Playwright):** the main flows against the built app.
- **Security tests:**
  - The agent rejects a wrong `Origin`, a wrong `Host`, a missing token or a malformed message.
  - A viewer can't write.
  - A sandbox can't be edited without its token.
  - The API never returns secret values.

## 16. Phases

No dates: each phase ends when its exit check passes.

### Phase 0: Scaffolding
- The monorepo: every app and package in section 4, Turborepo tasks, shared configs and CI.
- Compose for local Postgres, and the first Drizzle migration.
- One procedure (`GET /api/v1/me`) wired end to end through the contract.
- The Docker image.

**Exit:**
- `pnpm dev` runs web and server against local Postgres.
- Changing a field in the contract breaks the web build's type check.
- The image builds and serves the SPA.
- CI is green.

### Phase 1: Single-player client
- Request editor and response viewer, with tabs and drafts.
- Local workspace in Dexie, history, environments with secret values.
- Variable resolution.
- Import: Postman v2.1, Postman environment, cURL, OpenAPI 3. Export: Postman v2.1 and cURL.
- The executor, `@povik/agent` with pairing, and the browser transport.

**Exit:** import a public Postman collection, run it through the agent against an API on `localhost`, export it again, and the diff with the original shows only expected differences.

### Phase 2: Scripts, runner and CLI
- The `pm` sandbox, bundled modules and the trust prompt.
- The collection runner in the web app.
- `povik run` with JUnit output.
- OAuth 2.0 client credentials.

**Exit:** all scripting fixtures pass in the browser and through `povik run` in CI, and an untrusted collection runs no script.

### Phase 3: Accounts, workspaces, sandboxes
- OAuth sign-in and sessions.
- Personal and team workspaces, invites and roles, with the 10-member and 5-workspace limits.
- Collections and environments saved on the server, and moving the local workspace into an account.
- Sandboxes, including the secret scan and link previews.
- Rate limits.

**Exit:**
- Two accounts in one team workspace edit and run the same collection.
- An 11th person can't join a full workspace, including when two people accept invites at the same moment.
- A user can't own a 6th team workspace, whether by creating one (also two at the same moment) or by receiving ownership.
- An anonymous sandbox link works in a private window.
- The permission tests pass.

### Phase 4: Realtime
NOTIFY fan-out, conflict handling and presence.
**Exit:** with two server instances behind one proxy, a save in one browser shows up within a second in a browser connected to the other instance. Two saves of the same request at once give one 409, which the UI resolves.

### Phase 5: Desktop
The Electron shell with the executor in the main process, agent mode, deep-link login, `safeStorage`, signing and auto-update.
**Exit:** signed macOS and Windows builds install, sign in through the system browser, run a request against `localhost`, serve as the agent for the web app, open a `povik://s/{slug}` link, and update themselves to the next version.

### Later (not in v1)
- Browser extension.
- Standalone agent binary for people without Node.
- OAuth 2.0 authorization code; Digest and AWS SigV4 auth.
- GraphQL, WebSocket, SSE and gRPC requests.
- Code snippets beyond cURL.
- Live co-editing (Yjs).
- Git-backed collections.
- Mock servers, and scheduled monitors (which would make the server send requests; needs SSRF protection).
- Client certificates UI.
- Data-file iterations in the runner.
- Live read-only public links to a workspace collection.

## 17. Risks to check early

- **Safari and `ws://127.0.0.1` from an HTTPS page.** Check in phase 1. If Safari blocks it, Safari users need the desktop app.
- **Chrome's local network permission prompt.** Test the onboarding wording with real users.
- **QuickJS speed with ajv-heavy scripts.** Benchmark a large schema in phase 2.
- **Large responses in the renderer.** CodeMirror memory use above about 20 MB; test with the 50 MB cap.
- **Bundling internal packages.** Check in phase 0 that tsdown bundles `@povik/*` into the server, agent and CLI, and that a packed `@povik/agent` runs from a clean folder with `npx`.
- **Two Node versions.** Electron ships its own Node, which can lag the server's. Keep `executor` and `agent-server` on APIs both versions support, and run their tests on both.

## 18. Not decided here

- **Positioning against Hoppscotch** (MIT-licensed, self-hostable, with teams and an agent) **and Bruno** (offline and git-friendly): what does povik do that they don't?
- **Licence.** Open source or not. The self-hosting offer and the published npm packages depend on it.
- **Product name, domain and npm scope.** `@povik` is a placeholder until the scope is registered.
- **Sandbox abuse policy:** what gets removed, and who handles reports.
