exports.databases = {
/*
couch:{
  hostname: "127.0.0.1",
  port: 5984
},
*/
cassandra:{
  clientOptions: {
    contactPoints: ['h1'],
    localDataCenter: 'localhost',
    keyspace: 'etherdb'
  }
},
rethink:{
  hostname: "localhost"
}
/*
  elasticsearch:{
    hostname: "127.0.0.1"
  },
  dirty:{
    "filename": "/tmp/test.db",
    "speeds":{
      numberOfWrites: 1000,
      write: 1,
      read: 0.1,
      findKey: 0.5
    }
  }
  ,
  mysql:{
    "user"    : "etherdb",
    "host"    : "localhost",
    "password": "etherdb",
    "database": "etherdb",
    "charset" : "utf8mb4",
    "speeds":{
      numberOfpreloadedEntries: 1000000
    }
  }
  ,
  postgres:{
    "user"    : "postgres",
    "host"    : "localhost",
    "password": "",
    "database": "etherdb",
    "charset" : "utf8mb4"
  }
  ,
*/

/*
redis:{
  hostname: "127.0.0.1"
},
*/
}
