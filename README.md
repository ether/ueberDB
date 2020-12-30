# UeberDB2: Abstract your databases

## About

✓ UeberDB turns every database into a simple key value store by providing a
layer of abstraction between your software and your database.

✓ UeberDB uses a cache and buffer to make databases faster. Reads are cached and
writes are done in a bulk. This can be turned off.

✓ UeberDB does bulk writing ergo reduces the overhead of database transactions.

✓ UeberDB uses a simple and clean syntax ergo getting started is easy.

## Database Support

* Couch
* Dirty
* Elasticsearch
* Maria
* Mongo
* MsSQL
* MySQL
* Postgres (single connection and with connection pool)
* Redis
* Rethink
* SQLite

## Install

```
npm install ueberdb2
```

## Examples

### Basic

```javascript
const ueberdb = require('ueberdb2');

// mysql
const db = new ueberdb.Database('mysql', {
  user: 'root',
  host: 'localhost',
  password: '',
  database: 'store',
  engine: 'InnoDB',
});

// dirty to file system
//const db = new ueberdb.Database('dirty', {filename: 'var/dirty.db'});

async function example(db) {
  await db.init();

  // no need for await because it's already in cache.
  db.set('valueA', {a: 1, b: 2});

  db.get('valueA', function (err, value) {
    // close the database connection.
    db.close(function () {
      process.exit(0);
    });
  });
}

example(db);
```

### findKeys

```javascript
const ueberdb = require('ueberdb2');
const db = new ueberdb.Database('dirty', {filename: 'var/dirty.db'});

async function example(db){
  await db.init();

  // no need for await because it's already in cache.
  db.set('valueA', {a: 1, b: 2});
  db.set('valueA:h1', {a: 1, b: 2});
  db.set('valueA:h2', {a: 3, b: 4});

  db.findKeys('valueA:*', null, function (err, value) { // TODO: Check this
    // value will be ['valueA:h1', 'valueA:h2']
    db.close(function () {
      process.exit(0);
    });
  });
}

example(db);
```

### Getting and setting subkeys

ueberDB can store complex JSON objects. Sometimes you only want to get or set a
specific (sub-)property of the stored object. The `.getSub()` and `.setSub()`
methods make this easier.

#### `getSub`

```javascript
db.getSub(key, propertyPath, callback);
```

Fetches the object stored at `key`, walks the property path given in
`propertyPath`, and returns the value at that location. `propertyPath` must be
an array. If `propertyPath` is an empty array then `getSub()` is equivalent to
`get()`. Returns a nullish value (`null` or `undefined`) if the record does not
exist or if the given property path does not exist.

Examples:

```javascript
db.set(key, {prop1: {prop2: ['value']}}, (err) => {
  if (err != null) throw err;

  db.getSub(key, ['prop1', 'prop2', '0'], (err, val) => {
    if (err != null) throw err;
    console.log('1.', val); // prints "1. value"
  });

  db.getSub(key, ['prop1', 'prop2'], (err, val) => {
    if (err != null) throw err;
    console.log('2.', val); // prints "2. [ 'value' ]"
  });

  db.getSub(key, ['prop1'], (err, val) => {
    if (err != null) throw err;
    console.log('3.', val); // prints "3. { prop2: [ 'value' ] }"
  });

  db.getSub(key, [], (err, val) => {
    if (err != null) throw err;
    console.log('4.', val); // prints "4. { prop1: { prop2: [ 'value' ] } }"
  });

  db.getSub(key, ['does', 'not', 'exist'], (err, val) => {
    if (err != null) throw err;
    console.log('5.', val); // prints "5. null" or "5. undefined"
  });
});
```

#### `setSub`

```javascript
db.setSub(key, propertyPath, value, cb);
```

Fetches the object stored at `key`, walks the property path given in
`propertyPath`, and sets the value at that location to `value`. `propertyPath`
must be an array. If `propertyPath` is an empty array then `setSub()` is
equivalent to `set()`. Empty objects are created as needed if the property path
does not exist (including if `key` does not exist in the database). It is an
error to attempt to set a property on a non-object. `cb` is optional and is
called when the database driver has reported that the change has been written.

Examples:

```javascript
// Assumption: The database does not yet have any records.

// Equivalent to db.set('key1', 'value', cb):
db.setSub('key1', [], 'value', cb);

// Equivalent to db.set('key2', {prop1: {prop2: {0: 'value'}}}, cb):
db.setSub('key2', ['prop1', 'prop2', '0'], 'value', cb):

db.set('key3', {prop1: 'value'}, (err) => {
  if (err != null) return cb(err);
  // Equivalent to db.set('key3', {prop1: 'value', prop2: 'other value'}, cb):
  db.setSub('key3', ['prop2'], 'other value', cb);
});

db.set('key3', {prop1: 'value'}, (err) => {
  if (err != null) return cb(err);
  // TypeError: Cannot set property "badProp" on non-object "value":
  db.setSub('key3', ['prop1', 'badProp'], 'foo', cb);
});
```

### Disable the read cache

Set the `cache` wrapper option to 0 to force every read operation to go directly
to the database driver (except for reads of written values that have not yet
been committed to the database):

```javascript
const ueberdb = require('ueberdb2');

(async () => {
  const db = new ueberdb.Database(
      'dirty', {filename: 'var/dirty.db'}, {cache: 0});
  await db.init();
  db.set('valueA', {a: 1, b: 2});
  db.get('valueA', (err, value) => {
    console.log(JSON.stringify(value));
    db.close(() => {
      process.exit(0);
    });
  });
})();
```

### Disable write buffering

Set the `writeInterval` wrapper option to 0 to force writes to go directly to
the database driver:

```javascript
const ueberdb = require('ueberdb2');

(async () => {
  const db = new ueberdb.Database(
      'dirty', {filename: 'var/dirty.db'}, {writeInterval: 0});
  await db.init();
  db.set('valueA', {a: 1, b: 2});
  db.get('valueA', (err, value) => {
    console.log(JSON.stringify(value));
    db.close(() => {
      process.exit(0);
    });
  });
})();
```

## Feature support

|        | Get | Set | findKeys | Remove | getSub | setSub | doBulk |CI Coverage|
|--------|-----|-----|----------|--------|--------|--------|--------|--------|
|  cassandra |  ✓  |  ✓  |    *     |   ✓    |   ✓    |   ✓    |   ✓    |
|  couchdb |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  dirty |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |        |   ✓   |
|  dirty_git |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |        |
|  elasticsearch |  ✓  |  ✓  |    *     |   ✓    |   ✓    |   ✓    |   ✓    |
|  maria |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  mysql |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |   ✓   |
|  postgres  |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |   ✓   |
|  redis |  ✓  |  ✓  |    *     |   ✓    |   ✓    |   ✓    |   ✓    |   ✓   |
|  rethinkdb |  ✓  |  ✓  |    *     |   ✓    |   ✓    |   ✓    |   ✓    |
|  sqlite | ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |   ✓    |

## Limitations

### findKeys query support

The following characters should be avoided in keys `\^$.|?*+()[{` as they will
cause findKeys to fail.

### findKeys database support*

The following have limitations on findKeys

* redis (Only keys of the format \*:\*:\*)
* cassandra (Only keys of the format \*:\*:\*)
* elasticsearch (Only keys of the format \*:\*:\*)
* rethink (Currently doesn't work)

For details on how it works please refer to the wiki:
https://github.com/ether/UeberDB/wiki/findKeys-functionality

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

## Redis TLS communication

If you enabled TLS on your Redis database (available since Redis 6.0) you will
need to change your connections parameters, here is an example:

```
settings:
    {
      host:
      port: rediss://<redis_database_address>:<redis_database_port>
      socket:
      database:
      password:
      client_options
    }
```

Do not provide a `host` value.

If you don't provide a certificate on the client side, you need to add the
environment variable `NODE_TLS_REJECT_UNAUTHORIZED = 0` and add the flag
`--tls-auth-clients no` when launching the redis-server to accept connections.

## How to add support for another database

1. Add the database driver to `packages.json`, this will happen automatically if
   you run `npm install %yourdatabase%`
1. Create `databases/DATABASENAME_db.js` and have it export a `Database` class
   that derives from `lib/AbstractDatabase.js`. Implement the required
   functions.
1. Add a service for the database to the test job in
   `.github/workflows/npmpublish.yml`.
1. Add an entry to `test/lib/databases.js` for your database and configure it to
   work with the service added to the GitHub workflow.
1. Install and start the database server and configure it to work with the
   settings in your `test/lib/databases.js` entry.
1. Run `npm test` to ensure that it works.

## License

[Apache License v2](http://www.apache.org/licenses/LICENSE-2.0.html)

## What's changed from UeberDB?

* Dropped broken databases: CrateDB, LevelDB, LMDB (probably a
  breaking change for some people)
* Introduced CI.
* Introduced better testing.
* Fixed broken database clients IE Redis.
* Updated Depdendencies where possible.
* Tidied file structure.
* Improved documentation.
* Sensible name for software makes it clear that it's maintained by The Etherpad
  Foundation.
* Make db.init await / async

### Dirty_Git Easter Egg.

* I suck at hiding Easter eggs..

Dirty_git will `commit` and `push` to Git on every `set`. To use `git init` or
`git clone` within your dirty database location and then set your upstream IE
`git remote add origin git://whztevz`.

The logic behind dirty git is that you can still use dirty but you can also have
offsite backups. It's noisy and spammy but it can be useful.
