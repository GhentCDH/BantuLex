import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inventory,sql,copyDatabase,startServer,stopServer,request} from './helpers.mjs';
test('all 22 resources preserve all 183 fields and persist CRUD to SQLite',async()=>{
 const {dir,db}=copyDatabase(); let server=await startServer(db,dir);const created=[];
 const baseline=sql(db,"select type,name,sql from sqlite_master order by name");
 try {
  const status=await request(server.base,'/crouton/status.json');assert.equal(status.body.summary.ok,true);
  assert.equal(status.body.resources.length,22);assert.equal(inventory.reduce((n,t)=>n+t.columns.length,0),183);
  for(const t of inventory) {
   const config=JSON.parse(readFileSync(`apps/backend/src/app/resources/${t.table}/resource.json`));
   for(const c of t.columns) assert.ok(config.columns[c.name],`${t.table}.${c.name} configured`);
   const list=await request(server.base,`/${t.table}?pageSize=2`);assert.equal(list.status,200,JSON.stringify(list));assert.equal(list.body.data.length,2);
   const data={};
   for(const c of t.columns.filter(c=>!['id','created_at','updated_at'].includes(c.name))) {
    if(t.foreignKeys[c.name]) data[c.name]=sql(db,`select id from "${t.foreignKeys[c.name]}" order by id desc limit 1`)[0].id;
    else data[c.name]=c.type==='INTEGER'?1900000000:c.type==='REAL'?1.234:`TEST ${c.name} bá ɪ e\u0301`;
   }
   if(t.table==='fieldworkdatacollector') {
    const ref=await request(server.base,'/datacollector','POST',{name:'TEST junction parent'});assert.equal(ref.status,201,JSON.stringify(ref));
    created.push(['datacollector',ref.body.id]);data.data_collector_id=ref.body.id;
   }
   const made=await request(server.base,`/${t.table}`,'POST',data);assert.equal(made.status,201,`${t.table}: ${JSON.stringify(made)}`);
   const id=made.body.id;assert.ok(id);created.push([t.table,id]);
   const detail=await request(server.base,`/${t.table}/${id}`);assert.equal(detail.status,200);
   for(const c of t.columns) assert.ok(c.name in detail.body,`${t.table}.${c.name} in detail`);
   if(t.table!=='fieldworkdatacollector') assert.match(detail.body.created_at,/^\d{4}-\d{2}-\d{2} /);
   const changed=Object.fromEntries(Object.entries(data).map(([k,v])=>[k,t.foreignKeys[k]?v:typeof v==='string'?v+' updated':v+1]));
   const update=await request(server.base,`/${t.table}/${id}`,'PUT',changed);assert.equal(update.status,200,`${t.table}: ${JSON.stringify(update)}`);
   const where=t.table==='fieldworkdatacollector'?'fieldwork_id=? AND data_collector_id=?':'id=?';
   const row=sql(db,`select * from "${t.table}" where ${where}`,t.table==='fieldworkdatacollector'?String(id).split(':').map(Number):[id])[0];
   for(const [k,v] of Object.entries(changed)) assert.equal(row[k],v,`${t.table}.${k} persisted`);
   if(t.table!=='fieldworkdatacollector') {
    const protect=await request(server.base,`/${t.table}/${id}`,'PATCH',{id:999999999,created_at:'tamper',updated_at:'tamper'});
    const after=sql(db,`select * from "${t.table}" where id=?`,[id])[0];assert.ok(after);assert.equal(after.created_at,row.created_at);assert.notEqual(after.updated_at,'tamper');
   }
   console.log(`Verified ${t.table}: ${t.columns.length} fields`);
  }
  await stopServer(server.child);server=await startServer(db,dir);
  for(const [t,id] of created) assert.equal((await request(server.base,`/${t}/${id}`)).status,200,`restart ${t}`);
  for(const [t,id] of created.reverse()) {const r=await request(server.base,`/${t}/${id}`,'DELETE');assert.ok([200,204].includes(r.status),JSON.stringify(r));assert.equal((await request(server.base,`/${t}/${id}`)).status,404);}
  assert.deepEqual(sql(db,"select type,name,sql from sqlite_master order by name"),baseline);
  assert.deepEqual(sql(db,'pragma foreign_key_check'),[]);assert.equal(sql(db,'pragma integrity_check')[0].integrity_check,'ok');
 } finally {await stopServer(server.child);}
});
test('constraints, nulls, lookup, paging and compound-key changes',async()=>{
 const {dir,db}=copyDatabase();const s=await startServer(db,dir);
 try {
  const invalid=await request(s.base,'/source','POST',{author_year:'No required flag'});assert.equal(invalid.status,400);
  const fk=await request(s.base,'/place','POST',{name:'Bad reference',region_id:2147483647});assert.equal(fk.status,409,JSON.stringify(fk));
  const c=await request(s.base,'/country','POST',{name:'Nullable test'});const id=c.body.id;
  for(const value of ['',null,'bá ɪ e\u0301']) {const r=await request(s.base,`/country/${id}`,'PATCH',{name:value});assert.equal(r.status,200);assert.equal(sql(db,'select name from country where id=?',[id])[0].name,value);}
  const child=await request(s.base,'/region','POST',{name:'Restricted deletion',country_id:id});
  assert.equal((await request(s.base,`/country/${id}`,'DELETE')).status,409);
  assert.equal((await request(s.base,`/region/${child.body.id}`,'DELETE')).status,200);
  const dupValue=sql(db,'select beginning_id from entry where beginning_id is not null limit 1')[0].beginning_id;
  // Since Crouton alpha.82 unique violations are field validation errors (400, code unique), not 409.
  const dup=await request(s.base,'/entry','POST',{beginning_id:dupValue});assert.equal(dup.status,400,JSON.stringify(dup));assert.equal(dup.body.message[0].code,'unique');
  for(const t of inventory) {
   const r=await request(s.base,`/${t.table}?q=3&pageSize=2`);assert.equal(r.status,200,`${t.table} search: ${JSON.stringify(r)}`);
   const capped=await request(s.base,`/${t.table}?pageSize=10000`);assert.equal(capped.status,200);assert.ok(capped.body.data.length<=100);
  }
  const one=(await request(s.base,'/datacollector','POST',{name:'Junction one'})).body;
  const two=(await request(s.base,'/datacollector','POST',{name:'Junction two'})).body;
  const fields={fieldwork_id:1,data_collector_id:one.id};
  const join=(await request(s.base,'/fieldworkdatacollector','POST',fields)).body;
  assert.equal((await request(s.base,'/fieldworkdatacollector','POST',fields)).status,409);
  const moved=await request(s.base,`/fieldworkdatacollector/${join.id}`,'PATCH',{data_collector_id:two.id});assert.equal(moved.status,200);assert.equal(moved.body.id,`1:${two.id}`);
  assert.equal((await request(s.base,`/fieldworkdatacollector/${join.id}`)).status,404);
  assert.equal((await request(s.base,'/fieldworkdatacollector/nope')).status,400);
  assert.equal((await request(s.base,`/fieldworkdatacollector/${moved.body.id}`,'DELETE')).status,200);
  assert.deepEqual(sql(db,'pragma foreign_key_check'),[]);
 } finally {await stopServer(s.child);}
});
