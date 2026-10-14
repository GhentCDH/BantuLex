import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sql,copyDatabase,startServer,stopServer,request} from './helpers.mjs';

const counts=(db)=>sql(db,`select (select count(*) from reflex) reflexes, (select count(*) from sourceentries) links,
  (select count(*) from source) sources, (select count(*) from variety) varieties, (select count(*) from bulkimport) batches`)[0];
const ids=(db)=>sql(db,`select (select max(id) from location) location_id, (select max(id) from fieldwork) fieldwork_id,
  (select max(id) from variety) variety_id`)[0];
// A row per word of a fictional dictionary; every 10th row links to BLR 368 (*búdà 'rain'),
// every 25th has an unchecked text index.
const rows=(n)=>Array.from({length:n},(_,i)=>({term:`bulk-${i} ɓá`,translation:`gloss ${i}`,meaning:i%3?null:`sense ${i}`,
  pages:String(1+Math.floor(i/40)),blr_index:i%10===0?'368':i%25===0?'7364 (PT??)':null}));

test('bulk import: 5000 rows in one transaction, dry run, rollback and undo',async()=>{
 // Own port: node --test runs the test files in parallel (crud.test.mjs uses 14444).
 const {dir,db}=copyDatabase();const s=await startServer(db,dir,14447);
 const baseline=counts(db), schema=sql(db,"select type,name,sql from sqlite_master order by name");
 const {location_id,fieldwork_id,variety_id}=ids(db);
 const body={label:'Test dictionary 1888',role:'primary',source:{create:{author_year:'Bulk Test 1888',title:'A test dictionary'}},
   variety:{id:variety_id},location_id,fieldwork_id,rows:rows(5000)};
 try {
  // Invalid rows: nothing saved, errors point at the rows.
  const bad=await request(s.base,'/bulk/reflex','POST',{...body,rows:[{term:'ok'},{term:'  '}]});
  assert.equal(bad.status,400,JSON.stringify(bad));assert.deepEqual(bad.body.errors,[{row:2,field:'term',message:'Term is empty'}]);
  // A missing reference rolls back everything, including the new source.
  const missing=await request(s.base,'/bulk/reflex','POST',{...body,location_id:999999999});
  assert.equal(missing.status,400,JSON.stringify(missing));assert.equal(missing.body.errors[0].field,'location_id');
  assert.deepEqual(counts(db),baseline);

  // Dry run: full work, then rolled back.
  const dry=await request(s.base,'/bulk/reflex?dryRun=1','POST',body);
  assert.equal(dry.status,200,JSON.stringify(dry));
  assert.equal(dry.body.dryRun,true);assert.equal(dry.body.rows,5000);assert.equal(dry.body.blr_linked,500);
  assert.equal(dry.body.blr_text,100);assert.equal(dry.body.bulkimport_id,null);
  assert.deepEqual(counts(db),baseline);

  // The real import (5000 rows + a new source), well within the body limit and timeout.
  const t0=Date.now();
  const saved=await request(s.base,'/bulk/reflex','POST',body);
  assert.equal(saved.status,200,JSON.stringify(saved));
  console.log(`5000 rows saved in ${Date.now()-t0} ms`);
  const id=saved.body.bulkimport_id;assert.ok(id);assert.equal(saved.body.source.created,true);
  const after=counts(db);
  assert.equal(after.reflexes,baseline.reflexes+5000);assert.equal(after.links,baseline.links+5000);
  assert.equal(after.sources,baseline.sources+1);assert.equal(after.batches,baseline.batches+1);
  const [r]=sql(db,`select r.*, e.blr_index linked, se.pages, se.role, s.author_year from reflex r
    left join reconstruction e on e.id=r.blr_entry_id join sourceentries se on se.entry_id=r.id join source s on s.id=se.source_id
    where r.bulkimport_id=? and r.term='bulk-0 ɓá'`,[id]);
  assert.equal(r.linked,368);assert.equal(r.location_id,location_id);assert.equal(r.fieldwork_id,fieldwork_id);
  assert.equal(r.variety_id,variety_id);assert.equal(r.pages,'1');assert.equal(r.role,'primary');assert.equal(r.author_year,'Bulk Test 1888');
  assert.match(r.created_at,/^\d{4}-\d{2}-\d{2} /);
  assert.equal(sql(db,`select blr_note from reflex where bulkimport_id=? and term='bulk-25 ɓá'`,[id])[0].blr_note,'7364 (PT??)');
  const list=await request(s.base,'/bulk/imports');
  assert.equal(list.status,200);assert.equal(list.body[0].id,id);assert.equal(list.body[0].reflexes_now,5000);
  // The batch is visible (read-only) as a Crouton resource as well.
  assert.equal((await request(s.base,`/bulkimport/${id}`)).status,200);

  // Undo removes the reflexes, their source links and the source it created.
  const undo=await request(s.base,`/bulk/imports/${id}/undo`,'POST');
  assert.equal(undo.status,200,JSON.stringify(undo));
  assert.deepEqual(undo.body,{id,reflexes:5000,source_links:5000,source_removed:true,variety_removed:false});
  assert.deepEqual(counts(db),{...baseline,batches:baseline.batches+1});
  assert.equal(sql(db,'select status from bulkimport where id=?',[id])[0].status,'undone');
  assert.equal((await request(s.base,`/bulk/imports/${id}/undo`,'POST')).status,409);
  assert.equal((await request(s.base,'/bulk/imports/999999/undo','POST')).status,404);

  // A new variety is created in the same transaction and removed again on undo.
  const v=await request(s.base,'/bulk/reflex','POST',{...body,variety:{create:{name_english:'Bulk Test Lect',guthrie_index:'Z99'}},rows:rows(3)});
  assert.equal(v.status,200,JSON.stringify(v));assert.equal(v.body.variety.created,true);
  const u=await request(s.base,`/bulk/imports/${v.body.bulkimport_id}/undo`,'POST');
  assert.equal(u.body.variety_removed,true);assert.equal(u.body.source_removed,true);
  assert.deepEqual(counts(db),{...baseline,batches:baseline.batches+2});

  assert.deepEqual(sql(db,"select type,name,sql from sqlite_master order by name"),schema);
  assert.deepEqual(sql(db,'pragma foreign_key_check'),[]);assert.equal(sql(db,'pragma integrity_check')[0].integrity_check,'ok');
 } finally {await stopServer(s.child);}
});
