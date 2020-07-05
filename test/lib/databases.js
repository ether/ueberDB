exports.databases = {
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
    "user"    : "ueberdb",
    "host"    : "localhost",
    "password": "ueberdb",
    "database": "ueberdb",
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
    "database": "ueberdb",
    "charset" : "utf8mb4"
  }
  ,
  redis:{
    hostname: "127.0.0.1"
  }
}
