# ueberDB Rust Port — Design

**Status:** Approved (brainstorming phase)
**Date:** 2026-05-06
**Owner:** SamTV12345
**Source repos:** `ueberDB` (TS, current), `fast-kv` (Rust, in progress)
**Target consumer:** Etherpad

## Goal

Port `ueberdb2` — both the database backends and the wrapper layer (cache, write buffer, sub-path access, findKeys, bulk, metrics) — to safe Rust, exposed to Node.js via `napi-rs`. The published npm package keeps the name `ueberdb2` and the existing JS API so Etherpad consumes it without code changes.

## Scope decisions

1. **Backends in scope (12):** cassandra, couch, dirty, dirty_git, elasticsearch, memory, mongodb, mssql, mysql/maria, postgres (single + pool), redis, rusty, sqlite, surrealdb. **rethink is dropped.**
2. **Implementation language:** all in safe Rust — backends *and* the wrapper layer (LRU cache, write buffer, scheduling, locking, getSub/setSub, findKeys glob, bulk, metrics, logger pass-through).
3. **JS API:** drop-in compatible with current `ueberdb2`. Same package name, same `Database` class, same `Settings` shape, same Promise-returning method surface.
4. **Release model:** big-bang. No npm release until the existing vitest suite passes against the napi build for all 12 backends.
5. **Distribution:** one fat `.node` per platform; all driver crates always linked. Existing napi-rs CI matrix produces 10 platform prebuilts.

## Architecture overview

The core abstraction is a single `Backend` trait (mirrors today's `lib/AbstractDatabase.ts`) with one implementation per database. A `Database` type owns a `Box<dyn Backend>` plus the wrapper layer; only the `Database` is exposed through napi.

```
+---------------------------------------------+
|  napi class  Database  (src/lib.rs)         |
|    init/get/set/getSub/setSub/findKeys/...  |
+----------------------+----------------------+
                       |
+----------------------v----------------------+
|  Wrapper layer (src/wrapper/)               |
|   cache · write_buffer · locks · sub_path   |
|   find_keys · metrics · logger              |
+----------------------+----------------------+
                       |
+----------------------v----------------------+
|  trait Backend (src/backends/mod.rs)        |
|     get / set / remove / find_keys /        |
|     do_bulk / init / close                  |
+----------------------+----------------------+
                       |
        ┌──────────────┼──────────────┐
        |              |              |
   sqlite, postgres, mysql, mongodb, redis,
   cassandra, mssql, couch, elasticsearch,
   surrealdb, dirty, dirty_git, memory, rusty
```

## Project layout

Crate name: `ueberdb` (in `Cargo.toml`). npm package name: `ueberdb2`.

```
fast-kv/
├── Cargo.toml
├── build.rs
├── package.json                 # name: "ueberdb2"
├── index.js / index.d.ts        # napi-rs generated, re-exports Database
├── src/
│   ├── lib.rs                   # napi class Database, Settings, factory wiring
│   ├── error.rs                 # UeberError (thiserror) + napi::Error mapping
│   ├── wrapper/
│   │   ├── mod.rs
│   │   ├── cache.rs             # moka LRU
│   │   ├── write_buffer.rs      # buffered ops + flush task
│   │   ├── locks.rs             # per-key tokio mutex map
│   │   ├── sub_path.rs          # getSub/setSub on serde_json::Value
│   │   ├── find_keys.rs         # simpleGlobToRegExp
│   │   ├── metrics.rs
│   │   └── logger.rs            # ThreadsafeFunction wrapper
│   └── backends/
│       ├── mod.rs               # trait Backend + factory(type_, settings)
│       ├── memory.rs
│       ├── dirty.rs
│       ├── dirty_git.rs
│       ├── sqlite.rs
│       ├── rusty.rs             # redb-backed (existing KeyValueDB)
│       ├── postgres.rs          # single + pool, gated by settings.pool
│       ├── mysql.rs             # also serves maria
│       ├── mssql.rs
│       ├── mongodb.rs
│       ├── redis.rs
│       ├── cassandra.rs
│       ├── couch.rs
│       ├── elasticsearch.rs
│       └── surrealdb.rs
└── __test__/                    # vitest suite (port of ueberDB's test/)
```

## JS-facing API (frozen)

Mirrors current `ueberdb2`. All methods return native Promises (`napi-rs` `tokio_rt`).

```ts
export class Database {
  constructor(type: string, settings: Settings, wrapperSettings?: WrapperSettings)
  init(): Promise<void>
  close(): Promise<void>
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  setSub(key: string, path: string[], value: unknown): Promise<void>
  getSub(key: string, path: string[]): Promise<unknown>
  findKeys(key: string, notKey?: string | null): Promise<string[]>
  remove(key: string): Promise<void>
  flush(): Promise<void>
  metrics(): Metrics
}
```

`Settings` is a typed object that matches `lib/AbstractDatabase.ts` `Settings` field-for-field. `WrapperSettings` carries `cache`, `writeInterval`, `bulkLimit`, `json`, `logger`. Values cross the napi boundary as `serde_json::Value` (napi-rs supports this directly), preserving today's "any JSON" behavior.

Error messages match the existing ueberdb2 strings so Etherpad code that string-matches keeps working.

## Backend trait

```rust
#[async_trait]
pub trait Backend: Send + Sync {
    async fn init(&mut self) -> Result<()>;
    async fn close(&mut self) -> Result<()>;
    async fn get(&self, key: &str) -> Result<Option<Value>>;
    async fn set(&self, key: &str, value: &Value) -> Result<()>;
    async fn remove(&self, key: &str) -> Result<()>;
    async fn find_keys(&self, key: &str, not_key: Option<&str>) -> Result<Vec<String>>;
    async fn do_bulk(&self, ops: &[BulkOp]) -> Result<()>;
    fn supports_native_glob(&self) -> bool { false }
}

pub enum BulkOp {
    Set { key: String, value: Value },
    Remove { key: String },
}

pub fn factory(type_: &str, settings: &Settings) -> Result<Box<dyn Backend>>;
```

`Database` (in napi) wraps this with the wrapper layer; the trait is internal.

### Driver crates per backend

| Backend       | Crate                                          |
|---------------|------------------------------------------------|
| memory        | in-process `HashMap` + `tokio::sync::RwLock`   |
| dirty         | append-only log file via `tokio::fs`           |
| dirty_git     | `git2` (commits + push on every `set`)         |
| sqlite        | `sqlx` (with the existing `libsqlite3-sys`)    |
| rusty         | `redb` (existing `KeyValueDB`)                 |
| postgres      | `tokio-postgres` + `bb8-postgres` for pool     |
| mysql / maria | `sqlx` (mysql driver)                          |
| mssql         | `tiberius` + `bb8-tiberius`                    |
| mongodb       | `mongodb`                                      |
| redis         | `redis` (`redis::aio::ConnectionManager`)      |
| cassandra     | `scylla`                                       |
| couch         | `couch_rs`                                     |
| elasticsearch | `elasticsearch`                                |
| surrealdb     | `surrealdb`                                    |

Backends that natively support pattern matching (sql `LIKE`, redis `SCAN MATCH`, mongo regex, etc.) implement `find_keys` directly and override `supports_native_glob`. The rest fall back to a wrapper-side scan.

## Wrapper layer

### Cache
- `moka::future::Cache<String, Arc<Value>>`, capacity = `wrapperSettings.cache` (default 1000), bounded LRU.
- Read path: write buffer → cache → backend.
- Cache invalidated on every `set`/`remove` (including buffered ones).

### Write buffer
- `DashMap<String, BufferedOp>` of pending writes/removes.
- Tokio interval task fires every `writeInterval` ms (default 100), drains the map, builds a `Vec<BulkOp>`, calls `backend.do_bulk()`. Errors propagate to a `broadcast` channel that pending awaiters listen on.
- `bulkLimit` (default 100) caps a single flush; remainder rolls into the next tick.
- `flush()` triggers immediate drain and awaits.

### Per-key locking
- `DashMap<String, Arc<tokio::sync::Mutex<()>>>`. `set`/`setSub`/`get` (when going past the cache) take the per-key lock to keep operations on the same key strictly ordered, while different keys proceed in parallel — matches today's ueberDB invariants.

### getSub / setSub
- `setSub`: load value (going through cache + buffer), walk path through `serde_json::Value`, mutate, store back through the normal `set` path so cache + buffer stay coherent.
- Empty objects auto-created on missing path segments. Setting a property on a non-object errors with the same `TypeError` message as today.
- `getSub` returns `null` when the path doesn't resolve (matches current behavior).

### findKeys
- `simpleGlobToRegExp` ported from `lib/AbstractDatabase.ts`: escape `.+?^${}()|[]\` then replace `*` with `.*`.
- If the backend supports native pattern matching, the wrapper translates the glob into the backend's native form and delegates. Otherwise, the wrapper requests all keys from the backend and filters locally.
- Pending writes in the buffer are folded into the result so reads-after-writes see the right keys.

### Metrics
Atomic counters via `std::sync::atomic`: `reads`, `writes`, `removes`, `cache_hits`, `cache_misses`, `flushes`, `bulks`. Exposed as a plain object from `db.metrics()`.

### Logger
JS callback in `wrapperSettings.logger` is wrapped in a `ThreadsafeFunction` and called from Rust without blocking the tokio runtime. Levels: `debug`, `info`, `warn`, `error`.

## Async runtime

`napi-rs`'s `tokio_rt` feature is already on. Every `#[napi]` `async fn` returns a JS Promise. The flush task is spawned via `tokio::spawn` in `init()` and shut down in `close()` through a `CancellationToken`. `Drop` on `Database` triggers a best-effort cancel as a safety net.

## Error handling

```rust
#[derive(thiserror::Error, Debug)]
pub enum UeberError {
    #[error("the doBulk method must be implemented if write caching is enabled")]
    DoBulkNotImplemented,
    #[error("Cannot set property \"{prop}\" on non-object \"{value}\"")]
    SetSubOnNonObject { prop: String, value: String },
    #[error("backend init failed: {0}")]
    BackendInit(String),
    #[error("backend error: {0}")]
    Backend(#[from] anyhow::Error),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("invalid configuration: {0}")]
    Config(String),
}
```
Mapped to `napi::Error::new(napi::Status::GenericFailure, msg)` with the same message strings the TS implementation produces today, so any consumer that pattern-matches errors keeps working.

## Testing

- **Conformance:** the existing ueberDB vitest suite (`test/**`) is the source of truth. Copy it under `__test__/` in fast-kv and run it against the napi build. Tests pass = port complete.
- **Integration (per-backend):** spin up real databases with `testcontainers-rs` for postgres, mongo, mysql, mssql, redis, cassandra, elasticsearch, couch, surrealdb. Tests run from Rust via `tokio::test`.
- **In-process backends:** memory, dirty, dirty_git, sqlite, rusty test against tempdirs (`tempfile`).
- **Wrapper layer unit tests:** Rust tests against a stub `Backend` implementation that records calls — covers cache hit/miss, buffer coalescing, flush ordering, getSub/setSub edge cases, findKeys with and without native glob, per-key lock ordering.
- **JS-side smoke:** the `__test__/*.spec.ts` files validate the exact JS API surface from Node.

## CI & distribution

- Existing napi-rs GitHub Actions matrix (10 platforms) produces prebuilts.
- During the port, publish under `ueberdb2@next` dist-tag; only flip `latest` once the conformance suite is green on all 12 backends across all platforms.
- `index.js` / `index.d.ts` + per-platform optionalDependencies layout (the napi-rs default) replaces the existing `dist/` from the TS package.

## Migration notes / risks

- **Postgres single vs pool:** today's `databases/postgres_db.ts` and `databases/postgrespool_db.ts` collapse into one Rust backend. To preserve drop-in compatibility, the factory accepts both `type: "postgres"` and `type: "postgrespool"` and routes them to the same backend with the pool flag set accordingly — Etherpad config keeps working unchanged.
- **dirty_git:** `git2` (libgit2 binding) handles commit/push without shelling out.
- **Cassandra (`scylla`), MSSQL (`tiberius`), SurrealDB, Elasticsearch:** Rust crates exist; thin wrappers acceptable per scope decision.
- **Binary size:** all drivers always linked. Accepted; revisit if it becomes a real problem.
- **npm name handover:** the name `ueberdb2` is already taken by the current TS package. Coordinate publish access with current maintainer before flipping `latest`.
- **Package rename in fast-kv:** crate `rusty-store-kv` → `ueberdb`; existing `KeyValueDB` becomes the `rusty` backend.

## Out of scope

- Rethink (dropped per scope decision).
- Wrapper-layer redesign or new features beyond what ueberdb2 already does.
- Re-implementing Etherpad-side database access — this remains a drop-in.
- Cargo feature gating per backend; single fat binary is the chosen distribution shape.

## Next step

Hand off to the `superpowers:writing-plans` skill to produce a step-by-step implementation plan covering: trait + factory scaffolding, wrapper layer, per-backend porting order (memory → dirty → sqlite → rusty → postgres → mysql → mongo → redis → couch → cassandra → mssql → elasticsearch → surrealdb → dirty_git), test porting, CI, and release flip.
