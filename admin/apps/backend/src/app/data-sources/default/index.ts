import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { BadRequestException } from '@nestjs/common';
import { PrismaDataSourceAdapter, type AdapterCrudContext } from '@ghentcdh/crouton-api';
import type { ListRequest } from '@ghentcdh/crouton-core';
import { existsSync } from 'node:fs';
import { databasePath } from '../../../paths.js';

if (!existsSync(databasePath)) throw new Error(`Database does not exist: ${databasePath}`);
export const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({url:`file:${databasePath}`,timeout:5000}) });
await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
await prisma.$executeRawUnsafe('PRAGMA recursive_triggers = OFF');
const junction = 'fieldworkdatacollector';
function key(id: string | number) {
  if (!/^\d+:\d+$/.test(String(id))) throw new BadRequestException('Invalid fieldwork/data collector identifier');
  const [fieldwork_id, data_collector_id] = String(id).split(':').map(Number);
  if (![fieldwork_id,data_collector_id].every(Number.isSafeInteger)) throw new BadRequestException('Invalid identifier');
  return {fieldwork_id_data_collector_id:{fieldwork_id,data_collector_id}};
}
function identify<T extends {fieldwork_id:number;data_collector_id:number}>(row:T | null) {
  return row && {...row,id:`${row.fieldwork_id}:${row.data_collector_id}`};
}
/** Crouton runs calculated columns by `id`, which the junction lacks; evaluate them per compound key instead. */
async function withCalculated<T extends {fieldwork_id:number;data_collector_id:number}>(rows:T[],ctx:AdapterCrudContext) {
  const cols:{id:string;alias?:string;sqlExpression:string}[] = ctx.config?.calculatedColumns ?? [];
  if(!cols.length) return rows;
  const select = cols.map(c=>`(${c.sqlExpression}) AS "${c.alias ?? c.id}"`).join(', ');
  return Promise.all(rows.map(async row=>{
    const [values] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(`SELECT ${select} FROM "${junction}" main WHERE main.fieldwork_id = ? AND main.data_collector_id = ?`,row.fieldwork_id,row.data_collector_id);
    return {...row,...values};
  }));
}
function cleanContext(ctx:AdapterCrudContext) {
  const clean = (select:Record<string,unknown>|undefined) => select && Object.fromEntries(Object.entries(select).filter(([k])=>k!=='id'));
  // Calculated columns are evaluated by withCalculated, not by Crouton's id-based query.
  return {...ctx,config:{...ctx.config,calculatedColumns:[]},listSelect:clean(ctx.listSelect),oneSelect:clean(ctx.oneSelect)};
}
/** The sole data-access extension: adapt a compound primary key to Crouton's scalar route ID. */
class BantuLexAdapter extends PrismaDataSourceAdapter {
  override async findAll(model:string,params:ListRequest,ctx:AdapterCrudContext) {
    const bounded = {...params,pageSize:Math.min(Math.max(params.pageSize || 25,1),100),sort:params.sort || (model===junction?'fieldwork_id':'id')};
    if(model!==junction) return super.findAll(model,bounded,ctx);
    const result=await super.findAll(model,{...bounded,sort:bounded.sort==='id'?'fieldwork_id':bounded.sort},cleanContext(ctx));
    return {...result,data:await withCalculated(result.data.map(identify),ctx)};
  }
  override async findOne(model:string,id:string|number,ctx:AdapterCrudContext) {
    if(model!==junction) return super.findOne(model,id,ctx);
    const row = identify(await prisma.fieldworkdatacollector.findUnique({where:key(id)}));
    return row && (await withCalculated([row],ctx))[0];
  }
  override async create(model:string,data:unknown,ctx:AdapterCrudContext) {
    if(model!==junction) return super.create(model,data,ctx);
    return identify(await prisma.fieldworkdatacollector.create({data:data as {fieldwork_id:number;data_collector_id:number}}));
  }
  override async update(model:string,id:string|number,data:unknown,ctx:AdapterCrudContext) {
    if(model!==junction) return super.update(model,id,data,ctx);
    return identify(await prisma.fieldworkdatacollector.update({where:key(id),data:data as {fieldwork_id?:number;data_collector_id?:number}}));
  }
  override async patch(model:string,id:string|number,data:unknown,ctx:AdapterCrudContext) { return this.update(model,id,data,ctx); }
  override async delete(model:string,id:string|number,ctx:AdapterCrudContext) {
    return model===junction ? identify(await prisma.fieldworkdatacollector.delete({where:key(id)})) : super.delete(model,id,ctx);
  }
}
export default new BantuLexAdapter(prisma);
