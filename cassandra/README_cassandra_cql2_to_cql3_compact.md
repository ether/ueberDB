The Cassandra CQL3 Compact driver (`cassandra_cql3_compact_db.js`) is backward compatible with the CQL2 driver (`cassandra_db.js`). Though there is one change needed to the schema to make it work. In cassandra-cli, issue the following statement in your keyspace:

```
use <keyspace name>;
UPDATE COLUMN FAMILY <etherpad column family name> WITH column_metadata = [];
```

This command simply updates the metadata of the column family, it *does not* edit data within the column family. This change will trigger CQL3 to identify this column family as a *dynamic column family* with *wide rows* rather than a *static column family*. To verify that it had the intended effect, we can describe the column family using cqlsh in CQL3 mode:

```
~/Source/ueberDB$ cqlsh -3
Connected to test at localhost:9160.
[cqlsh 3.1.7 | Cassandra 1.2.11-SNAPSHOT | CQL spec 3.0.0 | Thrift protocol 19.36.1]
Use HELP for help.
cqlsh> describe keyspace <keyspace name>;

CREATE KEYSPACE <keyspace name> WITH replication = {
  'class': 'SimpleStrategy',
  'replication_factor': '1'
};

USE <keyspace name>;

CREATE TABLE <column family name> (
  key text,
  column1 text,
  value text,
  PRIMARY KEY (key, column1)
) WITH COMPACT STORAGE AND
  bloom_filter_fp_chance=0.010000 AND
  caching='KEYS_ONLY' AND
  comment='' AND
  dclocal_read_repair_chance=0.000000 AND
  gc_grace_seconds=864000 AND
  read_repair_chance=0.100000 AND
  replicate_on_write='true' AND
  populate_io_cache_on_flush='false' AND
  compaction={'class': 'SizeTieredCompactionStrategy'} AND
  compression={'sstable_compression': 'SnappyCompressor'};
```

The key change in the table definition is that it has **3 columns: (key text, column1 text, value text)**.
