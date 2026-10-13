import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { resolve } from 'node:path';
export default defineConfig({ schema: './schema.prisma', datasource: { url: `file:${resolve(process.env.DATABASE_PATH || 'data/bantulex.db')}` } });
