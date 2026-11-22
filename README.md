# povik

A web-based API client with Postman's core workflow: free team workspaces, shareable sandbox links,
and requests that run on your side. See [docs/PLAN.md](docs/PLAN.md) for the full plan.

## Requirements

- Node 26 (see `.nvmrc`)
- pnpm through corepack. Node 25+ no longer ships corepack, so install it once with
  `npm install --global corepack@latest && corepack enable`. The pnpm version pinned in
  `package.json` is then used automatically.
- Docker, for the local Postgres

## Getting started

```bash
pnpm install
docker compose up -d postgres
pnpm dev
```

`pnpm dev` runs the web app on http://localhost:5180 and the API on http://127.0.0.1:8080, against
Postgres on `localhost:54329`. The server applies migrations when it starts.

## Commands

| Command            | What it does                                                     |
| ------------------ | ---------------------------------------------------------------- |
| `pnpm dev`         | Web app and API with reload                                      |
| `pnpm check`       | Lint, typecheck and test every package                           |
| `pnpm build`       | Production builds of every app                                   |
| `pnpm e2e`         | Builds the server and web app, then runs Playwright against them |
| `pnpm format`      | Formats the repo with Prettier                                   |
| `pnpm db:generate` | Generates a SQL migration from `packages/db/src/schema.ts`       |
| `pnpm db:migrate`  | Applies migrations to `POVIK_DATABASE_URL`                       |

Database tests run when `POVIK_TEST_DATABASE_URL` is set, for example
`POVIK_TEST_DATABASE_URL=postgres://povik:povik@localhost:54329/povik pnpm test`.

## Database migrations

Change `packages/db/src/schema.ts`, run `pnpm db:generate`, and commit the generated SQL with
the change. Drizzle only applies migrations newer than the last one applied, so a migration from a
branch that is merged after a newer one is skipped without an error. After rebasing, delete your
migration and run `pnpm db:generate` again.

## Layout

```text
apps/      web, server, desktop, agent, cli
packages/  spec, contract, core, scripting, importers, executor, agent-server, db, config
e2e/       Playwright tests
```

Internal packages ship TypeScript source; each app bundles what it uses. See section 4 of the plan.
