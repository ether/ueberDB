# Agent Guide — ueberDB2

Welcome to ueberDB2. This guide gives AI agents and developers the essential context for contributing to the codebase.

## Project Overview

ueberDB2 turns almost any database into a simple key/value store by sitting between your application and the database driver. It is published to npm as [`ueberdb2`](https://www.npmjs.com/package/ueberdb2) and is best known as the storage layer behind Etherpad.

Two things make it more than a thin wrapper:

- **Read cache** — reads are cached so repeated `get`s don't hit the backend.
- **Write buffer** — writes are batched and flushed in bulk (`doBulk`), reducing transaction overhead.

Both can be disabled per-instance via the wrapper settings (`cache: 0`, `writeInterval: 0`).

This is a **library**, not an application. There is no server, no UI, no plugin system. Anything in older docs referring to Etherpad, React, i18n, accessibility, Playwright, or a plugin framework does **not** apply here.

## Technical Stack

- **Runtime:** Node.js >= 22
- **Package manager:** pnpm (CI pins 22.22.0 / pnpm 10–11)
- **Language:** TypeScript, compiled to **ESM** (`"type": "module"`)
- **Build:** [rolldown](https://rolldown.rs/) for JS, `tsc --emitDeclarationOnly` for types → `dist/`
- **Lint / format:** [oxlint](https://oxc.rs/) and oxfmt
- **Tests:** [Vitest](https://vitest.dev/), with [testcontainers](https://testcontainers.com/) spinning up real database containers per backend

## Directory Structure

- `index.ts` — package entry point. Exports the `Database` class and types; lazily imports the selected driver in `initDB()`.
- `lib/AbstractDatabase.ts` — base class every driver extends; defines `Settings`, the `createFindRegex` glob helper, and the `doBulk` contract.
- `lib/CacheAndBufferLayer.ts` — the read cache + write buffer that wraps a raw driver. `Database.db` is an instance of this.
- `lib/logging.ts` — logger normalization (`normalizeLogger`, `ConsoleLogger`); accepts log4js, `console`, or any `{debug,info,warn,error}` object.
- `databases/<name>_db.ts` — one file per backend driver, each a `default`-exported class extending `AbstractDatabase`.
- `test/lib/test_lib.ts` — the shared `test_db(type)` suite run against every backend (get/set/remove/findKeys/findKeysPaged/getSub/setSub/speed).
- `test/lib/databases.ts` — connection settings and per-backend speed thresholds used by the shared suite.
- `test/<name>/*.spec.ts` — per-backend spec; container-backed ones start a `GenericContainer` in `beforeAll` then call `test_db('<name>')`.
- `dist/` — build output (git-ignored, published).
- `docker-compose.yml` — convenience stack for running DB-backed tests locally without testcontainers.

## Supported Backends

Driver `type` strings accepted by `new Database(type, ...)` (see `DatabaseType` in `index.ts`):

`cassandra`, `couch`, `dirty`, `dirtygit`, `elasticsearch`, `memory`, `mock`, `mongodb`, `mssql`, `mysql`, `postgres`, `postgrespool`, `redis`, `rethink`, `rustydb`, `sqlite`, `surrealdb`.

If `type` is omitted/falsy, it defaults to `sqlite`. Each backend's native driver (`pg`, `mysql2`, `redis`, …) is an **optional peer dependency** and is `import()`ed lazily — only the selected backend's package needs to be installed by consumers.

## Public API

```ts
import {Database} from 'ueberdb2';

const db = new Database('sqlite', {filename: 'var/db.sqlite'}, {cache: 1000, writeInterval: 100});
await db.init();
await db.set('key', {any: 'json'});
await db.get('key');
await db.findKeys('prefix:*', null);
await db.findKeysPaged('prefix:*', null, {limit: 100, after: lastKey});  // memory-bounded paging
await db.getSub('key', ['path', 'into', 'object']);
await db.setSub('key', ['path'], value);
await db.remove('key');
await db.flush();   // force pending writes out (doShutdown() is a deprecated alias)
await db.close();
```

Constructor: `new Database(type, dbSettings, wrapperSettings?, logger?)`. `dbSettings` may be a `Settings` object or a connection string (e.g. `'postgres://user:pass@host/db'`). `wrapperSettings` controls the cache/buffer layer.

## Coding Conventions

- **Indentation:** 2 spaces, no tabs.
- **TypeScript everywhere.** Keep `pnpm run ts-check` clean.
- **ESM only.** Use `import`/`export`; the package has no CJS build.
- **Comment the non-obvious.** Several existing comments explain backend quirks (e.g. couch/nano 401s, SurrealDB speed thresholds) — preserve that style.
- **Backward compatibility matters.** Assume code runs against an existing database written by an older version. Don't change the on-disk schema or public API lightly; deprecate (with a `WARN` log) rather than remove abruptly.

## Adding a New Backend

1. `databases/<name>_db.ts` — export a `default` class extending `AbstractDatabase`, implementing at least `init`, `close`, `get`, `set`, `remove`, `findKeys` (and `doBulk` if write buffering is supported). Override `findKeysPaged` for large keyspaces; the `CacheAndBufferLayer` fallback is correct but slices in memory.
2. Add the driver as an optional peer dependency in `package.json` (`peerDependencies` + `peerDependenciesMeta` `optional: true`), and as a dev dependency for tests.
3. Add the `type` string to the `DatabaseType` union and the `switch` in `index.ts`'s `initDB()`.
4. Add a settings entry in `test/lib/databases.ts`.
5. Add `test/<name>/test.<name>.spec.ts` that starts a container (if needed) and calls `test_db('<name>')`.
6. Add the backend to the `db` matrix in `.github/workflows/npmpublish.yml`.

> Note: the "How to add support for another database" section in `README.md` predates the TypeScript/Vitest/testcontainers migration and references `.js` files and `npmpublish.yml` services — follow the steps above instead.

## Build, Lint, Test

```bash
pnpm install

pnpm run lint            # oxlint
pnpm run lint:fix        # oxlint --fix
pnpm run format          # oxfmt --write .
pnpm run format:check    # oxfmt --check .

pnpm run ts-check        # tsc --noEmit
pnpm run build           # build:js (rolldown) + build:types (tsc) -> dist/

pnpm run test            # all backends (needs containers/services available)
pnpm run test <name>     # single backend, e.g. `pnpm run test sqlite`
```

- `sqlite`, `dirty`, `memory`, `mock`, and `rustydb` need no external services and are the fastest to iterate on.
- Container-backed backends (`postgres`, `mysql`, `mongodb`, `couch`, `redis`, `elasticsearch`, `cassandra`, `surrealdb`, `rethink`) start their own `GenericContainer` via testcontainers, so a working Docker daemon is required. Alternatively bring services up with `docker-compose up`.
- Test timeout is 120s (containers get longer). Vitest is configured to **retry up to 5×** because integration tests against real containers are inherently flaky on CI — a consistently failing test still surfaces, but a single transient blip won't fail the run.

## Testing Expectations

- **Bug fixes ship with a regression test** in the same PR. Prefer a first commit that demonstrates the failure, then the fix.
- The shared `test_db` suite already exercises the full key/value contract across read-cache × write-buffer combinations; new backends get that coverage for free by calling it.
- Run the relevant `pnpm run test <name>` locally (at minimum a no-container backend like `sqlite`) plus `lint` and `ts-check` before pushing.

## CI

- **`.github/workflows/ci.yml`** — on push to `main`/`master` and on PRs: install, `lint`, `ts-check`, `build`.
- **`.github/workflows/npmpublish.yml`** — runs `pnpm run test <db>` across a matrix of backends (`fail-fast: false` so one flaky container doesn't red the whole run), then publishes to npm on push to `main`/`master`/`v*`.

## Contribution Workflow

- Branch per feature; open PRs against `main`. Keep history **linear** (no merge commits — rebase instead).
- Commit messages: `area: short description`, with a longer body when useful and `Fixes #NN` for bug fixes.
- Keep the public API and on-disk format stable; deprecate before removing.

### Keep PRs small and single-purpose

Many small, focused PRs are strongly preferred over one large sweeping change. This is the project's expected workflow — do not bundle unrelated work.

- **One concern per PR.** A bug fix, a performance improvement, and a refactor are three PRs, not one — even if you noticed them in the same sitting.
- **One backend per PR.** Each `databases/<name>_db.ts` is independent and has its own container-matrix test job. A change that touches multiple drivers should be split into one PR per driver. Reviewers can then reason about a single backend in isolation, and a fix for one DB isn't held up by review or flaky CI on another.
- Small, independent PRs review faster, merge sooner, and bisect cleanly. Prefer five focused PRs over one big one.

> The repository's `CONTRIBUTING.md` is largely inherited from Etherpad and mentions a `develop`/`master` git-flow and front-end tests that don't exist here. For ueberDB2, treat `main` as the integration branch and this guide as authoritative for build/test commands.
