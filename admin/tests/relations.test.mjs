import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inventory,sql,copyDatabase,startServer,stopServer,request} from './helpers.mjs';
// Detail-view relations: "relation-link" label columns link to the parent record, "related-table" columns list the
// children through the list API, with an open gt/lt interval on the foreign key (Crouton's `equals` is not cast to a number).
const resources=Object.fromEntries(inventory.map(t=>[t.table,JSON.parse(readFileSync(`apps/backend/src/app/resources/${t.table}/resource.json`))]));
const calculated=format=>Object.entries(resources).flatMap(([table,r])=>(r.calculatedColumns??[]).filter(c=>c.fieldInput?.options?.format===format).map(c=>({table,...c.fieldInput.options})));
const links=calculated('relation-link'),tables=calculated('related-table');
const fks=Object.fromEntries(inventory.map(t=>[t.table,t.foreignKeys]));
test('relation columns point at existing resources and foreign keys, both ways',()=>{
 assert.ok(links.length>0&&tables.length>0);
 for(const l of links) assert.equal(fks[l.table][l.idKey],l.linkResource,`${l.table}.${l.idKey} → ${l.linkResource}`);
 for(const t of tables) assert.equal(fks[t.childResource]?.[t.foreignKey],t.table,`${t.childResource}.${t.foreignKey} → ${t.table}`);
 // Every link has its reverse table.
 for(const l of links) assert.ok(tables.some(t=>t.table===l.linkResource&&t.childResource===l.table&&t.foreignKey===l.idKey),`${l.linkResource} lists ${l.table}`);
});
test('related-table query returns exactly the children of a record, paged',async()=>{
 const {dir,db}=copyDatabase();const s=await startServer(db,dir,14448);
 try {
  for(const t of tables) {
   const parent=sql(db,`select "${t.foreignKey}" id,count(*) n from "${t.childResource}" where "${t.foreignKey}" is not null group by 1 order by 2 desc limit 1`)[0];
   if(!parent) continue;
   const r=await request(s.base,`/${t.childResource}?pageSize=5&page=1&filter=${t.foreignKey}:${parent.id-1}:gt&filter=${t.foreignKey}:${parent.id+1}:lt`);
   assert.equal(r.status,200,JSON.stringify(r));
   assert.equal(r.body.request.count,parent.n,`${t.table} → ${t.childResource}`);
   assert.ok(r.body.data.length===Math.min(5,parent.n)&&r.body.data.every(row=>row[t.foreignKey]===parent.id));
  }
 } finally {await stopServer(s.child);}
});
