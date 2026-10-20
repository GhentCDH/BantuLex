import { BadRequestException } from '@nestjs/common';
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
/** Largest page the API serves; the bulk edit grid offers up to this. */
export const MAX_PAGE_SIZE = 500;
/** Bounds page sizes and gives every list a stable default order. */
class BantuLexAdapter extends PrismaDataSourceAdapter {
  override async findAll(model:string,params:ListRequest,ctx:AdapterCrudContext) {
    return super.findAll(model,{...params,pageSize:Math.min(Math.max(params.pageSize || 25,1),MAX_PAGE_SIZE),sort:params.sort || 'id'},ctx);
  }
  /**
   * `reflex.blr_index` is the human reference to a BLR entry, but only
   * `blr_entry_id` is a real foreign key. Resolve the index here so a reflex
   * can never point at a missing reconstruction, and keep both fields in sync.
   */
  private async withBlrReference(data:unknown) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    const body=data as Record<string,unknown>;
    if (!('blr_index' in body)) return data;
    const raw=body.blr_index;
    if (raw===null || raw===undefined || String(raw).trim()==='') {
      return {...body,blr_index:null,blr_entry_id:null};
    }
    const index=Number(String(raw).trim());
    if (!Number.isSafeInteger(index) || index<=0) {
      throw new BadRequestException({statusCode:400,message:[{field:'blr_index',message:'The BLR index must be a positive whole number.'}]});
    }
    const reconstruction=await prisma.reconstruction.findFirst({where:{blr_index:index},select:{id:true}});
    if (!reconstruction) {
      throw new BadRequestException({statusCode:400,message:[{field:'blr_index',message:`No BLR reconstruction with index ${index}.`}]});
    }
    return {...body,blr_index:String(index),blr_entry_id:reconstruction.id};
  }
  override async create(model:string,data:unknown,ctx:AdapterCrudContext) {
    if (model==='reflex') data=await this.withBlrReference(data);
    return super.create(model,data,ctx);
  }
  override async update(model:string,id:string|number,data:unknown,ctx:AdapterCrudContext) {
    if (model==='reflex') data=await this.withBlrReference(data);
    return super.update(model,id,data,ctx);
  }
  override async patch(model:string,id:string|number,data:unknown,ctx:AdapterCrudContext) {
    return this.update(model,id,data,ctx);
  }
}
export default new BantuLexAdapter(prisma);
