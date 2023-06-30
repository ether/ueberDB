'use strict';

import {Settings} from "../lib/AbstractDatabase";

const postgres = require('./postgres_db');

export const Database = class PostgresDB extends postgres.Database {
  constructor(settings:Settings) {
    console.warn('ueberdb: The postgrespool database driver is deprecated ' +
                 'and will be removed in a future version. Use postgres instead.');
    super(settings);
  }
};
