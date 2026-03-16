import { KnexBetterSqlite3Adapter } from '@kottster/server'
import { getEnvOrThrow } from '@kottster/common';

import knex from 'knex'

const KOTTSTER_DATABASE_PATH = getEnvOrThrow('KOTTSTER_DATABASE_PATH');

const client = knex({
  client: 'better-sqlite3',
  connection: {
    filename: KOTTSTER_DATABASE_PATH,
  },
  useNullAsDefault: true,
  pool: {
    afterCreate: (conn, done) => {
      conn.pragma('journal_mode = DELETE');
      conn.pragma('locking_mode = EXCLUSIVE');
      conn.pragma('busy_timeout = 5000');
      done(null, conn);
    },
  },
})

export default new KnexBetterSqlite3Adapter(client)
