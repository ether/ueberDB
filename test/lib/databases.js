exports.databases = {
/*
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
*/
  postgres:{
    "user"    : "postgres",
    "host"    : "localhost",
    "password": "",
    "database": "etherdb",
    "charset" : "utf8mb4"
  }
  ,
  mongo:{

  }
}
