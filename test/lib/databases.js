exports.databases = {
  dirty:{
    "filename": "var/test.db",
    "speeds":{
      numberOfWrites: 1000,
      acceptableWritesPerSecond: 1,
      acceptableReadsPerSecond: 0.1,
      acceptableFindKeysPerSecond: 1
    }
  }
  ,
  mysql:{
    "user"    : "ueberdb",
    "host"    : "localhost",
    "password": "ueberdb",
    "database": "ueberdb",
    "charset" : "utf8mb4"
  }
/*
  ,
  postgres:{
    "user"    : "postgres",
    "host"    : "localhost",
    "password": "",
    "database": "ueberdb",
    "charset" : "utf8mb4"
  }
  ,
  mongo:{

  }*/
}
