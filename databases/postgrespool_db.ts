import {Settings} from '../lib/AbstractDatabase';

import Postgres_db from './postgres_db'

export default class PostgresDB extends Postgres_db {
  constructor(settings:Settings) {
    console.warn('ueberdb: The postgrespool database driver is deprecated ' +
                 'and will be removed in a future version. Use postgres instead.');
    super(settings);
  }
};
