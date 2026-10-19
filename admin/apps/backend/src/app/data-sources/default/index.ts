import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaDataSourceAdapter, type AdapterCrudContext } from '@ghentcdh/crouton-api';
import type { ListRequest } from '@ghentcdh/crouton-core';
import { existsSync } from 'node:fs';
import { databasePath } from '../../../paths.js';

if (!existsSync(databasePath)) throw new Error(`Database does not exist: ${databasePath}`);
export const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({url:`file:${databasePath}`,timeout:5000}) });
await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
await prisma.$executeRawUnsafe('PRAGMA recursive_triggers = OFF');
/** Bounds page sizes and gives every list a stable default order. */
class BantuLexAdapter extends PrismaDataSourceAdapter {
  override async findAll(model:string,params:ListRequest,ctx:AdapterCrudContext) {
    return super.findAll(model,{...params,pageSize:Math.min(Math.max(params.pageSize || 25,1),100),sort:params.sort || 'id'},ctx);
  }
  override async patch(model:string,id:string|number,data:unknown,ctx:AdapterCrudContext) { return this.update(model,id,data,ctx); }
}
export default new BantuLexAdapter(prisma);
