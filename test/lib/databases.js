'use strict';

exports.databases = {
  dirty: {
    filename: '/tmp/ueberdb-test.db',
    speeds: {
      count: 1000,
      setMax: 1,
      getMax: 0.1,
      findKeyMax: 0.5,
    },
  },
  sqlite: {
    filename: '/tmp/ueberdb-test.sqlite',
    speeds: {
      count: 1000,
      setMax: 0.6,
      getMax: 0.5,
      findKeyMax: 2.5,
      removeMax: 0.5,
    },
  },
  mysql: {
    user: 'ueberdb',
    host: 'localhost',
    password: 'ueberdb',
    database: 'ueberdb',
    charset: 'utf8mb4',
    speeds: {
      count: 1000000,
    },
  },
  postgres: {
    user: 'postgres',
    host: 'localhost',
    password: '',
    database: 'ueberdb',
    charset: 'utf8mb4',
  },
  redis: {
    hostname: '127.0.0.1',
  },
  /*
  couch: {
    host: '127.0.0.1',
    port: 5984,
  },
  */
};
