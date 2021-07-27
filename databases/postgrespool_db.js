'use strict';

const postgres = require('./postgres_db');

exports.Database = class extends postgres.Database {
  constructor(settings) {
    console.warn('ueberdb: The postgrespool database driver is deprecated ' +
                 'and will be removed in a future version. Use postgres instead.');
    super(settings);
  }
};
