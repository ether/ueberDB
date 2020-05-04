# Abstract your databases, make datababies.

# About
✓ EtherDB turns every database into a simple key value store by providing a layer of abstraction between your software and your database.

✓ EtherDB uses a cache and buffer to make databases faster.  Reads are cached and writes are done in a bulk.  This can be turned off.

✓ EtherDB does bulk writing ergo reduces the overhead of database transactions.

✓ EtherDB uses a simple and clean syntax ergo getting started is easy.

# Database Support
* Couch
* Crate
* Dirty
* Elasticsearch
* Level
* Mongo
* MySQL (<= 5.7)
* Postgres (single connection and with connection pool)
* Redis
* RethinkDB
* SQLite

# Install

```
npm install etherDB
```

# Example

```javascript
const etherDB = require("etherdb");

//mysql
var db = new etherDB.database("mysql", {"user":"root", host: "localhost", "password":"", database: "store"});
// dirty to file system
//var db = new etherDB.database("dirty", {filename:"var/sqlite3.db"});
//sqlite in-memory
//var db = new etherDB.database("sqlite");
//sqlite in file
//var db = new etherDB.database("sqlite", {filename:"var/sqlite3.db"});
//sqlite in file with a write interval of a half second
//var db = new etherDB.database("sqlite", {filename:"var/sqlite3.db"}, {writeInterval: 500});

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

# Disabling Cache for real time read/write
Set ``db.cache = 0;`` to disable Caching of Read / Writes.

```
const etherDB = require("etherdb");
var db = new etherDB.database("dirty", {filename:"var/sqlite3.db"});

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


# Feature support (TODO CI coverage)
|        | Get | Set | findKeys | Remove | getSub | setSub | doBulk |CI Coverage|
|--------|-----|-----|----------|--------|--------|--------|--------|--------|
|  mysql |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |   ✓   |
|  couchdb |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  cassandra |  ✓  |  ✓  |          |   ✓    |   ✓    |   ✓    |   ✓    |
|  maria |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  crate |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  dirty |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |        |   ✓   |
|  elasticsearch |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  level |  ✓  |  ✓  |          |   ✓    |   ✓    |   ✓    |   ✓    |
|  mongo |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  redis |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  rethinkdb |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  sqlite |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  dirty_git |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |        |

# Limitations

## findKeys database support
The following have limitations on findKeys

* redis (Only keys of the format \*:\*:\*)
* cassandra (Only keys of the format \*:\*:\*)
* elasticsearch (Only keys of the format \*:\*:\*)

For details on how it works please refer to the wiki: https://github.com/ether/EtherDB/wiki/findKeys-functionality

## Scaling, High availability and disaster recovery.
To scale EtherDB you should use sharding especially for real time applications.  An example of this is sharding given Pads within Etherpad based on their initial pad authors geographical location.  High availability and disaster recovery can be provided through replication of your database however YMMV on passing Settings to your database library.  Do not be under the illusion that EtherDB provides any Stateless capabilities, it does not.  An option is to use something like rethinkdb and set cache to 0 but YMMV.

## Key Length Restrictions
Your Key Length will be limited by the database you chose to use but keep into account portability within your application.

# MySQL /MariaDB Advice
You should create your database as utf8mb4_bin,


# How to add support for another database
1. Add your database to ``packages.json``, this will happen automatically if you run ``npm install %yourdatabase%``

1. Add some example settings to ``test/lib/databases.js`` for your database.

1. Look at ``databases/sqlite_db.js`` and ``databases/mysql_db.js``, your module have to provide the same functions. Call it DATABASENAME_db.js and reimplement the functions for your database.  Most of your work here will be copy/paste from other databases so don't be scared.

1. Add your database Travis setup steps to ``.travis.yml``, see the ``before_install`` section and MySQL example.

1. Run ``npm test`` and ensure it's working.

1. Branch from master ``git checkout -b my-awesome-database`` and submit a pull request including the changes which should include **1 new and 3 modified files**.

Simples!  <3

# License
[Apache License v2](http://www.apache.org/licenses/LICENSE-2.0.html)
