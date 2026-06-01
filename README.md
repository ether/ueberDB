# UeberDB2: Abstract your databases

## About

✓ UeberDB turns every database into a simple key value store by providing a
layer of abstraction between your software and your database.

✓ UeberDB uses a cache and buffer to make databases faster. Reads are cached and
writes are done in a bulk. This can be turned off.

✓ UeberDB does bulk writing ergo reduces the overhead of database transactions.

✓ UeberDB uses a simple and clean syntax ergo getting started is easy.

## Database Support

- Couch
- Dirty
- Elasticsearch
- Maria
- `memory`: An in-memory ephemeral database.
- Mongo
- MsSQL
- MySQL
- Postgres (single connection and with connection pool)
- Redis
- Rethink
- `rustydb`
- SQLite
- Surrealdb
-

## Install

```
npm install ueberdb2
```

## Examples

### Basic

```javascript
const ueberdb = require("ueberdb2");

(async () => {
  // mysql
  const db = new ueberdb.Database("mysql", {
    user: "root",
    host: "localhost",
    password: "",
    database: "store",
    engine: "InnoDB",
  });
  // dirty to file system
  //const db = new ueberdb.Database('dirty', {filename: 'var/dirty.db'});

  await db.init();
  try {
    await db.set("valueA", { a: 1, b: 2 });
    console.log("valueA is", await db.get("valueA"));
  } finally {
    await db.close();
  }
})();
```

### findKeys

```javascript
const ueberdb = require("ueberdb2");

(async () => {
  const db = new ueberdb.Database("dirty", { filename: "var/dirty.db" });
  await db.init();
  try {
    await Promise.all([
      db.set("valueA", { a: 1, b: 2 }),
      db.set("valueA:h1", { a: 1, b: 2 }),
      db.set("valueA:h2", { a: 3, b: 4 }),
    ]);
    // prints [ 'valueA:h1', 'valueA:h2' ]
    console.log(await db.findKeys("valueA:*", null));
  } finally {
    await db.close();
  }
})();
```

### findKeysPaged (memory-bounded iteration)

`findKeys()` materialises every matching key into a single array. On very
large keyspaces that loads the whole result set into memory at once — see
[ether/etherpad#7830][7830] where a multi-million-row `sessionstorage:*`
sweep OOMed the host. `findKeysPaged()` walks the same keyspace in
fixed-size pages using an exclusive `after` cursor:

```javascript
const ueberdb = require("ueberdb2");

(async () => {
  const db = new ueberdb.Database("mysql", settings);
  await db.init();
  try {
    let after;
    let total = 0;
    while (true) {
      const page = await db.findKeysPaged("sessionstorage:*", null, {
        limit: 500,
        ...(after != null ? { after } : {}),
      });
      if (page.length === 0) break;
      total += page.length;
      for (const key of page) {
        // ...process key...
      }
      after = page[page.length - 1];
    }
    console.log(`processed ${total} keys`);
  } finally {
    await db.close();
  }
})();
```

Semantics:

- Keys are returned in ascending byte-order, up to `limit` per call.
- `after` is **exclusive** — pass the last returned key as the next
  `after` value. Final page is when the returned array is empty.
- `limit` must be a positive integer; non-positive or non-integer values
  throw.
- Native implementations: **mysql** (ranged `BINARY \`key\` > ?`),
**postgres** (`key > $n`). All other backends fall back to
`findKeys() + JS-side slicing` via the cache layer — correct, but
  defeats the OOM-mitigation purpose. PRs for native paged paths on
  other backends welcome.

[7830]: https://github.com/ether/etherpad/issues/7830

### Getting and setting subkeys

ueberDB can store complex JSON objects. Sometimes you only want to get or set a
specific (sub-)property of the stored object. The `.getSub()` and `.setSub()`
methods make this easier.

#### `getSub`

```javascript
const value = await db.getSub(key, propertyPath);
db.getSub(key, propertyPath, callback);
```

Fetches the object stored at `key`, walks the property path given in
`propertyPath`, and returns the value at that location. `propertyPath` must be
an array. If `propertyPath` is an empty array then `getSub()` is equivalent to
`get()`. Returns a nullish value (`null` or `undefined`) if the record does not
exist or if the given property path does not exist.

Examples:

```javascript
async () => {
  await db.set(key, { prop1: { prop2: ["value"] } });

  const val1 = await db.getSub(key, ["prop1", "prop2", "0"]);
  console.log("1.", val1); // prints "1. value"

  const val2 = await db.getSub(key, ["prop1", "prop2"]);
  console.log("2.", val2); // prints "2. [ 'value' ]"

  const val3 = await db.getSub(key, ["prop1"]);
  console.log("3.", val3); // prints "3. { prop2: [ 'value' ] }"

  const val4 = await db.getSub(key, []);
  console.log("4.", val4); // prints "4. { prop1: { prop2: [ 'value' ] } }"

  const val5 = await db.getSub(key, ["does", "not", "exist"]);
  console.log("5.", val5); // prints "5. null" or "5. undefined"
};
```

#### `setSub`

```javascript
await db.setSub(key, propertyPath, value);
db.setSub(key, propertyPath, value, callback);
```

Fetches the object stored at `key`, walks the property path given in
`propertyPath`, and sets the value at that location to `value`. `propertyPath`
must be an array. If `propertyPath` is an empty array then `setSub()` is
equivalent to `set()`. Empty objects are created as needed if the property path
does not exist (including if `key` does not exist in the database). It is an
error to attempt to set a property on a non-object.

Examples:

```javascript
// Assumption: db does not yet have any records.
(async () => {
  // Equivalent to db.set('key1', 'value'):
  await db.setSub('key1', [], 'value');

  // Equivalent to db.set('key2', {prop1: {prop2: {0: 'value'}}}):
  await db.setSub('key2', ['prop1', 'prop2', '0'], 'value'):

  await db.set('key3', {prop1: 'value'});

  // Equivalent to db.set('key3', {prop1: 'value', prop2: 'other value'}):
  await db.setSub('key3', ['prop2'], 'other value');

  // TypeError: Cannot set property "badProp" on non-object "value":
  await db.setSub('key3', ['prop1', 'badProp'], 'foo');
});
```

### Disable the read cache

Set the `cache` wrapper option to 0 to force every read operation to go directly
to the database driver (except for reads of written values that have not yet
been committed to the database):

```javascript
const ueberdb = require("ueberdb2");

(async () => {
  const db = new ueberdb.Database("dirty", { filename: "var/dirty.db" }, { cache: 0 });
  await db.init();
  try {
    await db.set("valueA", { a: 1, b: 2 });
    const value = await db.get("valueA");
    console.log(JSON.stringify(value));
  } finally {
    await db.close();
  }
})();
```

### Disable write buffering

Set the `writeInterval` wrapper option to 0 to force writes to go directly to
the database driver:

```javascript
const ueberdb = require("ueberdb2");

(async () => {
  const db = new ueberdb.Database("dirty", { filename: "var/dirty.db" }, { writeInterval: 0 });
  await db.init();
  try {
    await db.set("valueA", { a: 1, b: 2 });
    const value = await db.get("valueA");
    console.log(JSON.stringify(value));
  } finally {
    await db.close();
  }
})();
```

## Feature support

|               | Get | Set | findKeys | findKeysPaged | Remove | getSub | setSub | doBulk | CI Coverage |
| ------------- | --- | --- | -------- | ------------- | ------ | ------ | ------ | ------ | ----------- |
| cassandra     | ✓   | ✓   | \*       | ✓             | ✓      | ✓      | ✓      | ✓      | ✓           |
| couchdb       | ✓   | ✓   | ✓        | ✓             | ✓      | ✓      | ✓      | ✓      | ✓           |
| dirty         | ✓   | ✓   | ✓        | ✓             | ✓      | ✓      | ✓      |        | ✓           |
| dirty_git     | ✓   | ✓   | ✓        | ✓             | ✓      | ✓      | ✓      |        | ✓           |
| elasticsearch | ✓   | ✓   | \*       | ✓             | ✓      | ✓      | ✓      | ✓      | ✓           |
| maria         | ✓   | ✓   | ✓        | ✓             | ✓      | ✓      | ✓      | ✓      | ✓           |
| mysql         | ✓   | ✓   | ✓        | ✓             | ✓      | ✓      | ✓      | ✓      | ✓           |
| postgres      | ✓   | ✓   | ✓        | ✓             | ✓      | ✓      | ✓      | ✓      | ✓           |
| redis         | ✓   | ✓   | \*       | ✓             | ✓      | ✓      | ✓      | ✓      | ✓           |
| rethinkdb     | ✓   | ✓   | \*       | ✓             | ✓      | ✓      | ✓      | ✓      |
| rustydb       | ✓   | ✓   | ✓        | ✓             | ✓      | ✓      | ✓      | ✓      | ✓           |
| sqlite        | ✓   | ✓   | ✓        | ✓             | ✓      | ✓      | ✓      | ✓      | ✓           |
| surrealdb     | ✓   | ✓   | ✓        | ✓             | ✓      | ✓      | ✓      | ✓      | ✓           |

## Limitations

### findKeys query support

The following characters should be avoided in keys `\^$.|?*+()[{` as they will
cause findKeys to fail.

### findKeys database support\*

The following have limitations on findKeys

- redis (Only keys of the format \*:\*:\*)
- cassandra (Only keys of the format \*:\*:\*)
- elasticsearch (Only keys of the format \*:\*:\*)
- rethink (Currently doesn't work)

For details on how it works please refer to the wiki:
https://github.com/ether/UeberDB/wiki/findKeys-functionality

### findKeysPaged database support

`findKeysPaged` is supported on every backend, but only the SQL backends
(mysql, mariadb, postgres) iterate the keyspace with a server-side ranged
query — that's the variant that actually bounds memory for the OOM case it
was added for ([ether/etherpad#7830][7830]). Other backends share the same
API surface via a wrapper that falls back to `findKeys()` plus in-JS
slicing; correct, but the underlying `findKeys()` still materialises every
matching key, so the OOM-mitigation benefit only applies to the SQL
backends. PRs adding native paged paths for the rest are welcome.

[7830]: https://github.com/ether/etherpad/issues/7830

### Scaling, High availability and disaster recovery.

To scale UeberDB you should use sharding especially for real time applications.
An example of this is sharding given Pads within Etherpad based on their initial
pad authors geographical location. High availability and disaster recovery can
be provided through replication of your database however YMMV on passing
Settings to your database library. Do not be under the illusion that UeberDB
provides any Stateless capabilities, it does not. An option is to use something
like rethinkdb and set cache to 0 but YMMV.

### Key Length Restrictions

Your Key Length will be limited by the database you chose to use but keep into
account portability within your application.

### doBulk operations on .set out of memory

doBulk operations that chain IE a large number of .set without a pause to handle
the channel clearance can cause a `Javascript out of heap memory`. It's very
rare this happens and is usually due to a bug in software causing a constant
write to the database.

## MySQL /MariaDB Advice

You should create your database as utf8mb4_bin.

## PostgreSQL Advice

The `postgres` driver uses a [`pg`](https://node-postgres.com/) connection
pool. You can pass any [`pg` pool option](https://node-postgres.com/apis/pool)
through the settings object. The defaults applied by ueberDB2 are:

| Setting                       | Default | Notes                                                         |
| ----------------------------- | ------- | ------------------------------------------------------------- |
| `max`                         | `20`    | Maximum connections in the pool.                              |
| `min`                         | `4`     | Minimum warm connections kept open (honored by `pg` >= 8.16). |
| `idleTimeoutMillis`           | `1000`  | Idle reaping only applies to connections **above** `min`.     |
| `keepAlive`                   | `true`  | Enables TCP keep-alive on pooled sockets.                     |
| `keepAliveInitialDelayMillis` | `10000` | Delay before the first keep-alive probe (ms).                 |

### TCP keep-alive behind a proxy / load balancer / firewall

Because `min` connections are kept warm, those sockets can sit idle
indefinitely. A proxy, load balancer, firewall or NAT gateway between your
application and PostgreSQL (for example HAProxy `timeout server` / `timeout
client`, pgbouncer, or a cloud load balancer) will silently close a TCP
connection that carries no traffic for its idle timeout. The next use of that
connection then fails with `Connection terminated unexpectedly`.

ueberDB2 mitigates this in two ways:

- **`keepAlive` is enabled by default** (with a 10s initial delay) so the OS
  sends keep-alive probes that keep idle connections alive through such
  middleboxes. If your proxy timeout is shorter than 10s, lower
  `keepAliveInitialDelayMillis` accordingly.
- **A pool `error` handler is always attached.** If a pooled connection is
  dropped while idle, the error is logged and the connection discarded (the
  pool transparently reconnects) instead of being re-thrown as an uncaught
  exception that would crash the host process.

```javascript
const db = new ueberdb.Database("postgres", {
  host: "127.0.0.1",
  user: "ueberdb",
  password: "ueberdb",
  database: "ueberdb",
  // Override the keep-alive defaults if your proxy idle timeout is very short:
  keepAlive: true,
  keepAliveInitialDelayMillis: 5000,
});
```

## Redis TLS communication

If you enabled TLS on your Redis database (available since Redis 6.0) you will
need to change your connections parameters, here is an example:

```javascript
const db = new ueberdb.Database("redis", { url: "rediss://localhost" });
```

Do not provide a `host` value.

If you don't provide a certificate on the client side, you need to add the
environment variable `NODE_TLS_REJECT_UNAUTHORIZED = 0` and add the flag
`--tls-auth-clients no` when launching the redis-server to accept connections.

## How to add support for another database

1. Add the database driver to `packages.json`, this will happen automatically if
   you run `npm install %yourdatabase%`
2. Create `databases/DATABASENAME_db.js` and have it export a `Database` class
   that derives from `lib/AbstractDatabase.js`. Implement the required
   functions.
3. Add a service for the database to the test job in
   `.github/workflows/npmpublish.yml`.
4. Add an entry to `test/lib/databases.js` for your database and configure it to
   work with the service added to the GitHub workflow.
5. Install and start the database server and configure it to work with the
   settings in your `test/lib/databases.js` entry.
6. Run `npm test` to ensure that it works.

## License

[Apache License v2](http://www.apache.org/licenses/LICENSE-2.0.html)

## What's changed from UeberDB?

- Dropped broken databases: CrateDB, LevelDB, LMDB (probably a
  breaking change for some people)
- Introduced CI.
- Introduced better testing.
- Fixed broken database clients IE Redis.
- Updated Depdendencies where possible.
- Tidied file structure.
- Improved documentation.
- Sensible name for software makes it clear that it's maintained by The Etherpad
  Foundation.
- Make db.init await / async

### Dirty_Git Easter Egg.

- I suck at hiding Easter eggs..

Dirty_git will `commit` and `push` to Git on every `set`. To use `git init` or
`git clone` within your dirty database location and then set your upstream IE
`git remote add origin git://whztevz`.

The logic behind dirty git is that you can still use dirty, but you can also have
offsite backups. It's noisy and spammy, but it can be useful.
