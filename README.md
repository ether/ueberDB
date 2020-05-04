# Abstract your databases, make datababies.

# About
✓ EtherDB turns every database into a simple key value store by providing a layer of abstraction between your software and your database.

✓ EtherDB uses a smart cache and buffer algorithm to make databases faster.  Reads are cached and writes are done in a bulk.

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
npm install EtherDB
```

# Example

```javascript
var EtherDB = require("etherdb");

//mysql
var db = new EtherDB.database("mysql", {"user":"root", host: "localhost", "password":"", database: "store", charset: "utf8mb4"});

//dirty in file
//var db = new EtherDB.database("dirty", {filename:"var/sqlite3.db"});
//sqlite in-memory
//var db = new EtherDB.database("sqlite");
//sqlite in file
//var db = new EtherDB.database("sqlite", {filename:"var/sqlite3.db"});
//sqlite in file with a write interval of a half second
//var db = new EtherDB.database("sqlite", {filename:"var/sqlite3.db"}, {writeInterval: 500});

//initialize the database
db.init(async function (err)
{
  if(err)
  {
    console.error(err);
    process.exit(1);
  }

  //set a object as a value
  //can be done without a callback, cause the value is immediately in the buffer
  await db.set("valueA", {a:1,b:2});

  //get the object
  db.get("valueA", function(err, value){
    console.log(value);

    db.close(function(){
      process.exit(0);
    });
  });
});
```

# How to add support for another database
Look at sqlite_db.js and mysql_db.js, your module have to provide the same functions. Call it DATABASENAME_db.js and reimplement the functions for your database. If you think it works, test it with `node benchmark.js DATABASENAME`. Benchmark.js is benchmark and test at the same time. It tries to set 100000 values. You can pipe stderr to a file and will create a csv with benchmark results.

# Feature support (TODO)
|        | Get | Set | findKeys | Remove | getSub | setSub | doBulk |
|--------|-----|-----|----------|--------|--------|--------|--------|
|  mysql |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  couchdb |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  cassandra |  ✓  |  ✓  |          |   ✓    |   ✓    |   ✓    |   ✓    |
|  maria |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  crate |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |   ✓    |
|  dirty |  ✓  |  ✓  |    ✓     |   ✓    |   ✓    |   ✓    |        |
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

# License
[Apache License v2](http://www.apache.org/licenses/LICENSE-2.0.html)
