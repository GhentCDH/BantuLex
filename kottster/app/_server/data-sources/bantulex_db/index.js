import { KnexBetterSqlite3Adapter } from '@kottster/server'
import knex from 'knex'

const client = knex({
  client: 'better-sqlite3',
  connection: {
    filename: process.env.DATABASE_PATH ?? '../data/bantulex.db',
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
