const os = require('os');

type DatabaseType ={
  [key:string]:any
}

export const databases:DatabaseType = {
  memory: {},
  dirty: {
    filename: `${os.tmpdir()}/ueberdb-test.db`,
    speeds: {
      setMax: 1,
      getMax: 0.1,
      findKeysMax: 0.5,
    },
  },
  sqlite: {
    filename: `${os.tmpdir()}/ueberdb-test.sqlite`,
    speeds: {
      setMax: 0.6,
      getMax: 0.5,
      findKeysMax: 2.5,
      removeMax: 0.5,
    },
  },
  mysql: {
    user: 'ueberdb',
    host: '127.0.0.1',
    password: 'ueberdb',
    database: 'ueberdb',
    charset: 'utf8mb4',
    speeds: {
      findKeysMax: 6,
      getMax: 1,
    },
  },
  postgres: {
    user: 'ueberdb',
    host: 'localhost',
    password: 'ueberdb',
    database: 'ueberdb',
    charset: 'utf8mb4',
    speeds: {
      setMax: 6,
    },
  },
  redis: {
    url: 'redis://localhost/'
  },
  mongodb: {
    url: 'mongodb://127.0.0.1:27017',
    database: 'mydb_test',
    speeds: {
      setMax: 0.5,
      getMax: 0.1,
      removeMax: 0.6,
    },
  },
  couch: {
    host: '127.0.0.1',
    port: 5984,
    database: 'ueberdb',
    user: 'ueberdb',
    password: 'ueberdb',
    speeds: {
      findKeysMax: 30,
    },
  },
  elasticsearch: {
    base_index: 'ueberdb_test',
    speeds: {
      findKeysMax: 30,
    }, host: '127.0.0.1',
    port: '9200',

  },
  surrealdb: {

    url:'http://127.0.0.1:8000/rpc',
    speeds: {
        findKeysMax: 30,
    },
    columnFamily: 'ueberdb',
    user: 'root',
    password: 'root',
    clientOptions: {
        ns: 'ueberdb',
    }
  }
};
