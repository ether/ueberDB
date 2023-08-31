import {Settings} from '../lib/AbstractDatabase';

import {Database as PGDatabase} from './postgres_db'

export const Database = class PostgresDB extends PGDatabase {
  constructor(settings:Settings) {
    console.warn('ueberdb: The postgrespool database driver is deprecated ' +
                 'and will be removed in a future version. Use postgres instead.');
    super(settings);
  }
};
