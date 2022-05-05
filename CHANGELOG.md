# Notable Changes

## v2.2.4

Security fix:

  * `getSub()` now returns `null` when it encounters a non-"own" property
    (including `__proto__`) or any non-object while walking the given property
    path. This should make it easier to avoid accidental prototype pollution
    vulnerabilities.

## v2.2.0

Compatibility changes:

  * Passing callbacks to the database methods is deprecated; use the returned
    Promises instead.

New features:

  * Database methods now return a Promise if a callback is not provided.

Bug fixes:

  * A call to `flush()` immediately after a call to `set()`, `setSub()`, or
    `remove()` (within the same ECMAScript macro- or microtask) now flushes the
    new write operation.
  * Fixed a bug where `findKeys()` would return stale results when write
    buffering is enabled and writes are pending.
  * `couch`: Rewrote driver to fix numerous bugs.

## v2.1.1

Security fix:

  * Fix `setSub()` prototype pollution vulnerability.

## v2.1.0

  * `memory`: New `data` setting that allows users to supply the backing Map
    object (rather than create a new Map).

Updated database dependencies:

  * `dirty_git`: Updated `simple-git` to 3.6.0.
  * `mssql`: Updated `mssql` to 8.1.0.

## v2.0.0

* When saving an object that has a `.toJSON()` method, the value returned from
  that method is saved to the database instead of the object itself. This
  matches [the behavior of
  `JSON.stringify()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#tojson_behavior).
  The `.toJSON()` method is used even if the chosen database driver never
  actually converts anything to JSON.
* New `memory` database driver that stores values in memory only.

## v1.4.19

Updated database (and other) dependencies:
* `mongodb`: Updated `mongodb` to 3.7.3.
* `mssql`: Updated `mssql` to 7.3.0.
* `dirty_git`: Updated `simple-git` to 2.47.0.

## v1.4.16

* `postgres`: You can now provide a connection string instead of a settings
  object. For example:
  ```javascript
  const db = new ueberdb.Database('postgres', 'postgres://user:password@host/dbname');
  ```

## v1.4.15

* `postgres`, `postgrespool`: The `postgrespool` database driver was renamed to
  `postgres`, replacing the old `postgres` driver. The old `postgrespool` name
  is still usable, but is deprecated. For users of the old `postgres` driver,
  this change increases the number of concurrent database connections. You may
  need to increase your configured connection limit.
* `sqlite`: Updated `sqlite3` to 5.0.2.

## v1.4.14

Updated dependencies:
* `cassandra`: Updated `cassandra-driver` to 4.6.3.
* `couch`: Updated `nano` to 9.0.3.
* `dirty`: Updated `dirty` to 1.1.3.
* `dirty_git`: Updated `simple-git` to 2.45.0.
* `mongodb`: Updated `mongodb` to 3.6.11.
* `mssql`: Updated `mssql` to 7.2.1.
* `postgres`, `postgrespool`: Updated `pg` to 8.7.1.

## v1.4.13

* `mongodb`: The `dbName` setting has been renamed to `database` for consistency
  with other database drivers. The `dbName` setting will continue to work (for
  backwards compatibility), but it is deprecated and is ignored if `database` is
  set.
* `mongodb`: The `database` (formerly `dbName`) setting is now optional. If it
  is not specified, the database name embedded in the `url` setting is used.

## v1.4.8

* `redis`: Updated `redis` dependency to 3.1.2.

## v1.4.7

* Each write operation in a bulk write batch is now retried if the bulk write
  fails.
* Fixed write metrics for `setSub()` read failures.

## v1.4.6

* `mysql`: Use a connection pool to improve performance and simplify the code.

## v1.4.5

* `mysql`: Reconnect on fatal error.
* `mysql`: Log MySQL errors.

## v1.4.4

* New experimental setting to limit the number of operations written at a time
  when flushing outstanding writes.
* `mysql`: Bulk writes are limited to 100 changes at a time to avoid query
  timeouts.
* `mysql`: Raised default cache size from 500 entries to 10000.

## v1.4.2

* Refined the experimental read and write metrics.

## v1.4.1

* The two callback arguments in `remove()`, `set()`, and `setSub()` have
  changed: Instead of a callback that is called after the write is buffered and
  another callback that is called after the write is committed, both callbacks
  are now called after the write is committed. Futhermore, the second callback
  argument is now deprecated.
* Modernized record locking.
* Experimental metrics for reads, writes, and locking.

## v1.3.2

* `dirty`: Updated `dirty` dependency.

## v1.3.1

* `redis`: The database config object is now passed directly to the `redis`
  package. For details, see
  https://www.npmjs.com/package/redis/v/3.0.2#options-object-properties.
  Old-style settings objects (where the `redis` options are in the
  `client_options` property) are still supported but deprecated.

## v1.2.9

* `dirty`: Workaround for a bug in the upstream `dirty` driver.

## v1.2.7

* `redis`: Experimental support for passing the settings object directly to the
  `redis` package.

## v1.2.6

* `redis`: Fixed "Callback was already called" exception during init.

## v1.2.5

* All: Fixed a major bug introduced in v1.1.10 that caused `setSub()` to
  silently discard changes.
* All: Fixed a bug that prevented cache entries from being marked as most
  recently used.

## v1.2.4

* `mssql`: Updated `mssql` dependency.
* `dirty_git`: Updated `simple-git` dependency.
* `sqlite`: Updated `sqlite3` dependency.

## v1.2.3

* `mssql`: Updated `mssql` dependency.

## v1.2.2

* All: Fixed minor `setSub()` corner cases.

## v1.2.1

* New `flush()` method.
* The `doShutdown()` method is deprecated. Use `flush()` instead.
* The `close()` method now flushes unwritten entries before closing the database
  connection.
* Bug fix: `null`/`undefined` is no longer cached if there is an error reading
  from the database.

## v1.1.10

* Major performance improvement: The caching logic was rewritten with much more
  efficient algorithms. Also: Scans for entries to evict is performed less
  often. Depending on your workload you might observe a slight memory usage
  increase.

## v1.1.7

* `mysql` dependency bumped to 7.0.0-alpha4 to avoid a security vulnerability in
  one of its indirect dependencies.

## v1.1.6

* Bug fix: When write buffering is disabled, reads of keys with values that were
  changed but not yet written to the underlying database used to return the
  previous value. Now the updated value is returned.
* Minor performance improvement: Setting a key to the same value no longer
  triggers a database write.

## v1.1.5

* Minor performance improvement: Debug log message strings are no longer
  generated if debug logging is not enabled.

## v1.1.1

* The `database()` constructor is deprecated; use `Database()` instead.

## Older

See the Git history.
