import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {inventory,sql,copyDatabase,startServer,stopServer,request} from './helpers.mjs';
// Junction tables: [parent resource, column]. Each test row needs a fresh parent, or the (fieldwork, person) pair would already exist.
const junctions={fieldworkdatacollector:['datacollector','data_collector_id'],fieldworkconsultant:['consultant','consultant_id']};
test('every table has a resource that preserves all fields and persists CRUD to SQLite',async()=>{
 const {dir,db}=copyDatabase(); let server=await startServer(db,dir);const created=[];
 const baseline=sql(db,"select type,name,sql from sqlite_master order by name");
 try {
  const status=await request(server.base,'/crouton/status.json');assert.equal(status.body.summary.ok,true);
  const tables=inventory.map(t=>t.table);assert.equal(status.body.resources.length,tables.length);
  assert.deepEqual(readdirSync('apps/backend/src/app/resources').sort(),tables);
  for(const t of inventory) {
   const config=JSON.parse(readFileSync(`apps/backend/src/app/resources/${t.table}/resource.json`));
   for(const c of t.columns) assert.ok(config.columns[c.name],`${t.table}.${c.name} configured`);
   const list=await request(server.base,`/${t.table}?pageSize=2`);assert.equal(list.status,200,JSON.stringify(list));
   // Read-only resources (bulkimport: written by the bulk import API only) are listed, not edited.
   if(config.operations?.create===false) {console.log(`Verified ${t.table}: read-only`);continue;}
   assert.equal(list.body.data.length,2);
   const data={};
   // Columns the resource does not let users set (e.g. reflex.bulkimport_id) are left to the API that owns them.
   for(const c of t.columns.filter(c=>!['id','created_at','updated_at'].includes(c.name)&&config.columns[c.name]?.createable!==false)) {
    if(t.foreignKeys[c.name]) data[c.name]=sql(db,`select id from "${t.foreignKeys[c.name]}" order by id desc limit 1`)[0].id;
    else data[c.name]=c.type==='INTEGER'?1900000000:c.type==='BOOLEAN'?true:['REAL','FLOAT'].includes(c.type)?1.234:`TEST ${c.name} bá ɪ e\u0301`;
   }
   if(junctions[t.table]) {
    const [parent,column]=junctions[t.table];
    const ref=await request(server.base,`/${parent}`,'POST',{name:'TEST junction parent'});assert.equal(ref.status,201,JSON.stringify(ref));
    created.push([parent,ref.body.id]);data[column]=ref.body.id;
   }
   const made=await request(server.base,`/${t.table}`,'POST',data);assert.equal(made.status,201,`${t.table}: ${JSON.stringify(made)}`);
   const id=made.body.id;assert.ok(id);created.push([t.table,id]);
   const detail=await request(server.base,`/${t.table}/${id}`);assert.equal(detail.status,200);
   for(const c of t.columns) assert.ok(c.name in detail.body,`${t.table}.${c.name} in detail`);
   assert.match(detail.body.created_at,/^\d{4}-\d{2}-\d{2} /);
   const changed=Object.fromEntries(Object.entries(data).map(([k,v])=>[k,t.foreignKeys[k]?v:typeof v==='string'?v+' updated':typeof v==='boolean'?!v:v+1]));
   // Unlinking the reconstruction is a valid update.
   if(t.table==='reflex') changed.blr_entry_id=null;
   const update=await request(server.base,`/${t.table}/${id}`,'PUT',changed);assert.equal(update.status,200,`${t.table}: ${JSON.stringify(update)}`);
   const row=sql(db,`select * from "${t.table}" where id=?`,[id])[0];
   // SQLite stores booleans as 0/1.
   for(const [k,v] of Object.entries(changed)) assert.equal(row[k],typeof v==='boolean'?Number(v):v,`${t.table}.${k} persisted`);
   const protect=await request(server.base,`/${t.table}/${id}`,'PATCH',{id:999999999,created_at:'tamper',updated_at:'tamper'});
   const after=sql(db,`select * from "${t.table}" where id=?`,[id])[0];assert.ok(after);assert.equal(after.created_at,row.created_at);assert.notEqual(after.updated_at,'tamper');
   console.log(`Verified ${t.table}: ${t.columns.length} fields`);
  }
  await stopServer(server.child);server=await startServer(db,dir);
  for(const [t,id] of created) assert.equal((await request(server.base,`/${t}/${id}`)).status,200,`restart ${t}`);
  for(const [t,id] of created.reverse()) {const r=await request(server.base,`/${t}/${id}`,'DELETE');assert.ok([200,204].includes(r.status),JSON.stringify(r));assert.equal((await request(server.base,`/${t}/${id}`)).status,404);}
  assert.deepEqual(sql(db,"select type,name,sql from sqlite_master order by name"),baseline);
  assert.deepEqual(sql(db,'pragma foreign_key_check'),[]);assert.equal(sql(db,'pragma integrity_check')[0].integrity_check,'ok');
 } finally {await stopServer(server.child);}
});
test('constraints, nulls, lookup, paging and unique junction pairs',async()=>{
 const {dir,db}=copyDatabase();const s=await startServer(db,dir);
 try {
  const invalid=await request(s.base,'/source','POST',{author_year:'No required flag'});assert.equal(invalid.status,400);
  const fk=await request(s.base,'/place','POST',{name:'Bad reference',region_id:2147483647});assert.equal(fk.status,409,JSON.stringify(fk));
  const c=await request(s.base,'/country','POST',{name:'Nullable test'});const id=c.body.id;
  for(const value of ['',null,'bá ɪ e\u0301']) {const r=await request(s.base,`/country/${id}`,'PATCH',{name:value});assert.equal(r.status,200);assert.equal(sql(db,'select name from country where id=?',[id])[0].name,value);}
  const child=await request(s.base,'/region','POST',{name:'Restricted deletion',country_id:id});
  assert.equal((await request(s.base,`/country/${id}`,'DELETE')).status,409);
  assert.equal((await request(s.base,`/region/${child.body.id}`,'DELETE')).status,200);
  const dupValue=sql(db,'select beginning_id from reflex where beginning_id is not null limit 1')[0].beginning_id;
  // Since Crouton alpha.82 unique violations are field validation errors (400, code unique), not 409.
  const dup=await request(s.base,'/reflex','POST',{beginning_id:dupValue});assert.equal(dup.status,400,JSON.stringify(dup));assert.equal(dup.body.message[0].code,'unique');
  for(const t of inventory) {
   const r=await request(s.base,`/${t.table}?q=3&pageSize=2`);assert.equal(r.status,200,`${t.table} search: ${JSON.stringify(r)}`);
   const capped=await request(s.base,`/${t.table}?pageSize=10000`);assert.equal(capped.status,200);assert.ok(capped.body.data.length<=500);
  }
  const one=(await request(s.base,'/datacollector','POST',{name:'Junction one'})).body;
  const two=(await request(s.base,'/datacollector','POST',{name:'Junction two'})).body;
  const fields={fieldwork_id:1,data_collector_id:one.id};
  const join=(await request(s.base,'/fieldworkdatacollector','POST',fields)).body;
  const again=await request(s.base,'/fieldworkdatacollector','POST',fields);assert.equal(again.status,400,JSON.stringify(again));assert.equal(again.body.message[0].code,'unique');
  const moved=await request(s.base,`/fieldworkdatacollector/${join.id}`,'PATCH',{data_collector_id:two.id});assert.equal(moved.status,200);assert.equal(moved.body.id,join.id);
  assert.equal(sql(db,'select data_collector_id from fieldworkdatacollector where id=?',[join.id])[0].data_collector_id,two.id);
  assert.equal((await request(s.base,`/fieldworkdatacollector/${join.id}`,'DELETE')).status,200);
  assert.deepEqual(sql(db,'pragma foreign_key_check'),[]);
 } finally {await stopServer(s.child);}
});
