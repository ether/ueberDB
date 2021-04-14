# Notable Changes

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
