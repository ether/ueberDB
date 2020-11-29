# Abstract your databases, make datababies.

# About
✓ UeberDB turns every database into a simple key value store by providing a layer of abstraction between your software and your database.

✓ UeberDB uses a cache and buffer to make databases faster.  Reads are cached and writes are done in a bulk.  This can be turned off.

✓ UeberDB does bulk writing ergo reduces the overhead of database transactions.

✓ UeberDB uses a simple and clean syntax ergo getting started is easy.

# Database Support
* Couch
* Crate
* Dirty
* Elasticsearch
* Level
* MySQL
* Maria
* Postgres (single connection and with connection pool)
* Redis
* Rethink
* MsSQL

# Install

```
npm install ueberdb2
```

# Examples

## Basic

```javascript
const UeberDB = require("ueberdb2");

//mysql
var db = new UeberDB.database("mysql", {"user":"root", host: "localhost", "password":"", database: "store", engine: "InnoDB"});
// dirty to file system
//var db = new UeberDB.database("dirty", {filename:"var/dirty.db"});

example(db);

// using async
async function example(db){
  // initialize the database connection.
  await db.init();

  // no need for await because it's already in cache..
  db.set("valueA", {a:1,b:2});

  // using callback
  db.get("valueA", function(err, value){
    // close the database connection.
    db.close(function(){
      process.exit(0);
    });
  });
}
```

## findKeys

```javascript
const UeberDB = require("ueberdb2");
var db = new UeberDB.database("dirty", {filename:"var/dirty.db"});
exampleFK(db);

// using async
async function exampleFK(db){
  // initialize the database connection.
  await db.init();

  // no need for await because it's already in cache..
  db.set("valueA", {a:1,b:2});
  db.set("valueA:h1", {a:1,b:2});
  db.set("valueA:h2", {a:3,b:4});

  // using callback
  db.findKeys("valueA:*", null, function(err, value){ // TODO: Check this
    // value will be ["valueA:h1", "valueA:h2"]
    // close the database connection.
    db.close(function(){
      process.exit(0);
    });
  });
}
```

## Disabling Cache for real time read/write
Set ``db.cache = 0;`` to disable Caching of Read / Writes.

```
const UeberDB = require("ueberdb2");
var db = new UeberDB.database("dirty", {filename:"var/dirty.db"});

example(db);

// going cacheless
async function example(db){
  // initialize the database connection.
  await db.init();

  db.cache = 0; // kills the cache

  // no need for await because it's already in cache..
  db.set("valueA", {a:1,b:2});

  // using callback
  db.get("valueA", function(err, value){
    // close the database connection.
    db.close(function(){
      process.exit(0);
    });
  });
}

```


# Feature support
|        | Get | Set | findKeys | Remove | getSub | setSub | doBulk |CI Coverage|
|--------|-----|-----|----------|--------|--------|--------|--------|--------|
|  mysql |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |   ✓   |
|  postgres  |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |   ✓   |
|  couchdb |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  cassandra |  ✓  |  ✓  |    *     |   ✓    |   ✓    |   ✓    |   ✓    |
|  maria |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  crate |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  dirty |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |        |   ✓   |
|  elasticsearch |  ✓  |  ✓  |    *     |   ✓    |   ✓    |   ✓    |   ✓    |
|  level |  ✓  |  ✓  |          |   ✓    |   ✓    |   ✓    |   ✓    |
|  redis |  ✓  |  ✓  |    *     |   ✓    |   ✓    |   ✓    |   ✓    |   ✓   |
|  rethinkdb |  ✓  |  ✓  |    *     |   ✓    |   ✓    |   ✓    |   ✓    |
|  dirty_git |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |        |

# Limitations

## findKeys query support
The following characters should be avoided in keys ``\^$.|?*+()[{`` as they will cause findKeys to fail.

## findKeys database support*
The following have limitations on findKeys

* redis (Only keys of the format \*:\*:\*)
* cassandra (Only keys of the format \*:\*:\*)
* elasticsearch (Only keys of the format \*:\*:\*)
* rethink (Currently doesn't work)

For details on how it works please refer to the wiki: https://github.com/ether/UeberDB/wiki/findKeys-functionality

## Scaling, High availability and disaster recovery.
To scale UeberDB you should use sharding especially for real time applications.  An example of this is sharding given Pads within Etherpad based on their initial pad authors geographical location.  High availability and disaster recovery can be provided through replication of your database however YMMV on passing Settings to your database library.  Do not be under the illusion that UeberDB provides any Stateless capabilities, it does not.  An option is to use something like rethinkdb and set cache to 0 but YMMV.

## Key Length Restrictions
Your Key Length will be limited by the database you chose to use but keep into account portability within your application.

## doBulk operations on .set out of memory
doBulk operations that chain IE a large number of .set without a pause to handle the channel clearance can cause a ``Javascript out of heap memory``.  It's very rare this happens and is usually due to a bug in software causing a constant write to the database.

# MySQL /MariaDB Advice
You should create your database as utf8mb4_bin.

# Redis TLS communication

If you enabled TLS on your Redis database (available since Redis 6.0) you will need to change your connections parameters, here is an example: 

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

If you don't provide a certificate on the client side, you need to add the environment variable `NODE_TLS_REJECT_UNAUTHORIZED = 0` and add the flag `--tls-auth-clients no` when launching the redis-server to accept connections.

# How to add support for another database
1. Add your database to ``packages.json``, this will happen automatically if you run ``npm install %yourdatabase%``

1. Add some example settings to ``test/lib/databases.js`` for your database.

1. Look at ``databases/mysql_db.js``, your module have to provide the same functions. Call it DATABASENAME_db.js and reimplement the functions for your database.  Most of your work here will be copy/paste from other databases so don't be scared.

1. Add your database Travis setup steps to ``.travis.yml``, see the ``before_install`` section and MySQL example.  Note that MySQL has a preloaded script (comes from mysql.sql) which preloads the database with 1M records.  If you can, you should do the same.

1. Run ``npm test`` and ensure it's working.

1. Branch from master ``git checkout -b my-awesome-database`` and submit a pull request including the changes which should include **1 new and 3 modified files**.

1. Once merged we really need you to be on top of maintaining your code.

# Dropped Databases and Why.
* Mongo was dropped due to an API break in the client, the old client is still in the database folder.
* Sqlite was dropped due to a broken SQL and broken build process.

# License
[Apache License v2](http://www.apache.org/licenses/LICENSE-2.0.html)

# What's changed from UeberDB?

* Dropped broken Databases[Mongo/SQLite] (probably a breaking change for some people)
* Introduced CI.
* Introduced better testing.
* Fixed broken database clients IE Redis.
* Updated Depdendencies where possible.
* Tidied file structure.
* Improved documentation.
* Sensible name for software makes it clear that it's maintained by The Etherpad Foundation.
* Make db.init await / async

## Dirty_Git Easter Egg.
* I suck at hiding Easter eggs..  

Dirty_git will ``commit`` and ``push`` to Git on every ``set``.  To use ``git init`` or ``git clone`` within your dirty database location and then set your upstream IE ``git remote add origin git://whztevz``.

The logic behind dirty git is that you can still use dirty but you can also have offsite backups.  It's noisy and spammy but it can be useful.
