# Notable Changes

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
