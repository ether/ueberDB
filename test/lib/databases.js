'use strict';

exports.databases = {
  memory: {},
  dirty: {
    filename: '/tmp/ueberdb-test.db',
    speeds: {
      setMax: 1,
      getMax: 0.1,
      findKeysMax: 0.5,
    },
  },
  sqlite: {
    filename: '/tmp/ueberdb-test.sqlite',
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
  },
  mongodb: {
    url: 'mongodb://127.0.0.1:27017',
    database: 'mydb_test',
    speeds: {
      setMax: 0.2,
      getMax: 0.05,
      removeMax: 0.3,
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
};
