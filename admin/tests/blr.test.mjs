import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyDatabase,startServer,stopServer,sql,request} from './helpers.mjs';

const emptyStructure = {
  c1:null,c2:null,c3:null,c4:null,cs:null,
  v11:null,v12:null,v21:null,v22:null,v3:null,v4:null,
  t11:null,t12:null,t21:null,t22:null,t3:null,t4:null,
};

function payload(reflexIds, changes = {}) {
  return {
    reconstruction: {
      word:'test-root', word_tone:'tést', english:'test', french:'test',
      noun_class:null, distribution:'A B', proto_kk:null,
      date_of_entry:'2026-10-20 12:00:00', note:null,
      contributor_id:null, reliability_id:null,
    },
    structure:{...emptyStructure},
    reflex_ids:reflexIds,
    ...changes,
  };
}

const count = (db, table) => sql(db,`select count(*) n from ${table}`)[0].n;
const unlinked = (db, n) => sql(db,'select id from reflex where blr_entry_id is null order by id limit ?',[n]).map(r=>r.id);

test('BLR API creates a reconstruction, structures and reflex links in one transaction',async()=>{
 const {dir,db}=copyDatabase(); const s=await startServer(db,dir,14450);
 try {
  const max=sql(db,'select max(blr_index) m from reconstruction')[0].m;
  const ids=unlinked(db,2);
  const contributor=sql(db,'select id from blrcontributor order by id limit 1')[0].id;
  const reliability=sql(db,'select id from blrreliability order by id limit 1')[0].id;
  const body=payload(ids);
  body.reconstruction.contributor_id=contributor;
  body.reconstruction.reliability_id=reliability;
  body.structure={...emptyStructure,c1:'b',v11:'a',t11:'H',cs:'123'};

  const res=await request(s.base,'/blr','POST',body);
  assert.equal(res.status,201,JSON.stringify(res));
  assert.equal(res.body.blr_index,max+1);
  assert.equal(res.body.linked,2);

  const rec=sql(db,'select * from reconstruction where id=?',[res.body.id])[0];
  assert.equal(rec.blr_index,max+1);
  assert.equal(rec.contributor_id,contributor);
  assert.equal(rec.reliability_id,reliability);
  assert.ok(rec.consonant_structure_id);assert.ok(rec.vowel_structure_id);assert.ok(rec.tone_structure_id);
  assert.equal(sql(db,'select c1 from blrconsonantstructure where id=?',[rec.consonant_structure_id])[0].c1,'b');
  assert.equal(sql(db,'select v11 from blrvowelstructure where id=?',[rec.vowel_structure_id])[0].v11,'a');
  assert.equal(sql(db,'select t11 from blrtonestructure where id=?',[rec.tone_structure_id])[0].t11,'H');

  for(const id of ids) {
   const row=sql(db,'select blr_index, blr_entry_id from reflex where id=?',[id])[0];
   assert.equal(row.blr_index,String(max+1));
   assert.equal(row.blr_entry_id,res.body.id);
  }

  const next=await request(s.base,'/blr/next-index');
  assert.equal(next.body.blr_index,max+2);
 } finally {await stopServer(s.child);}
});

test('BLR API reuses an identical structure tuple',async()=>{
 const {dir,db}=copyDatabase(); const s=await startServer(db,dir,14451);
 try {
  const rec=sql(db,`select r.consonant_structure_id c, r.vowel_structure_id v, r.tone_structure_id t
    from reconstruction r where r.consonant_structure_id is not null and r.vowel_structure_id is not null
    and r.tone_structure_id is not null limit 1`)[0];
  const cs=sql(db,'select * from blrconsonantstructure where id=?',[rec.c])[0];
  const vs=sql(db,'select * from blrvowelstructure where id=?',[rec.v])[0];
  const ts=sql(db,'select * from blrtonestructure where id=?',[rec.t])[0];
  const structure={...emptyStructure,c1:cs.c1,c2:cs.c2,c3:cs.c3,c4:cs.c4,cs:cs.cs,
    v11:vs.v11,v12:vs.v12,v21:vs.v21,v22:vs.v22,v3:vs.v3,v4:vs.v4,
    t11:ts.t11,t12:ts.t12,t21:ts.t21,t22:ts.t22,t3:ts.t3,t4:ts.t4};
  const before=[count(db,'blrconsonantstructure'),count(db,'blrvowelstructure'),count(db,'blrtonestructure')];

  const res=await request(s.base,'/blr','POST',payload(unlinked(db,1),{structure}));
  assert.equal(res.status,201,JSON.stringify(res));
  const created=sql(db,'select * from reconstruction where id=?',[res.body.id])[0];
  assert.equal(created.consonant_structure_id,rec.c);
  assert.equal(created.vowel_structure_id,rec.v);
  assert.equal(created.tone_structure_id,rec.t);
  assert.deepEqual([count(db,'blrconsonantstructure'),count(db,'blrvowelstructure'),count(db,'blrtonestructure')],before);
 } finally {await stopServer(s.child);}
});

test('BLR API rolls back when a reflex is linked or a reference is invalid',async()=>{
 const {dir,db}=copyDatabase(); const s=await startServer(db,dir,14452);
 try {
  const linked=sql(db,'select id from reflex where blr_entry_id is not null limit 1')[0].id;
  const free=unlinked(db,1)[0];
  const before=count(db,'reconstruction');

  const conflict=await request(s.base,'/blr','POST',payload([free,linked]));
  assert.equal(conflict.status,409,JSON.stringify(conflict));
  assert.equal(count(db,'reconstruction'),before);
  assert.equal(sql(db,'select blr_entry_id from reflex where id=?',[free])[0].blr_entry_id,null);

  const invalid=payload([free]);
  invalid.reconstruction.contributor_id=999999999;
  const bad=await request(s.base,'/blr','POST',invalid);
  assert.equal(bad.status,400,JSON.stringify(bad));
  assert.equal(bad.body.errors[0].field,'contributor_id');
  assert.equal(count(db,'reconstruction'),before);
 } finally {await stopServer(s.child);}
});

test('BLR API lists candidates, options and the next index',async()=>{
 const {dir,db}=copyDatabase(); const s=await startServer(db,dir,14453);
 try {
  const options=await request(s.base,'/blr/options');
  assert.equal(options.status,200);
  assert.ok(Array.isArray(options.body.c1)&&options.body.c1.length>0);

  const list=await request(s.base,'/blr/reflexes?pageSize=5');
  assert.equal(list.status,200,JSON.stringify(list));
  assert.ok(list.body.data.length>0);
  for(const row of list.body.data) assert.equal(row.blr_entry_id,null);

  const all=await request(s.base,'/blr/reflexes?pageSize=5&unlinked=0');
  assert.equal(all.status,200);
  assert.ok(all.body.data.length>0);

  const next=await request(s.base,'/blr/next-index');
  assert.equal(next.body.blr_index,sql(db,'select max(blr_index) m from reconstruction')[0].m+1);
 } finally {await stopServer(s.child);}
});

test('BLR API loads a reconstruction by id and by BLR index',async()=>{
 const {dir,db}=copyDatabase(); const s=await startServer(db,dir,14454);
 try {
  const rec=sql(db,`select r.id, r.blr_index, r.word from reconstruction r
    where r.consonant_structure_id is not null and exists (select 1 from reflex x where x.blr_entry_id=r.id) limit 1`)[0];
  const cs=sql(db,'select c.* from blrconsonantstructure c join reconstruction r on r.consonant_structure_id=c.id where r.id=?',[rec.id])[0];
  const reflexes=sql(db,'select id from reflex where blr_entry_id=? order by id',[rec.id]).map(r=>r.id);

  const res=await request(s.base,`/blr/${rec.id}`);
  assert.equal(res.status,200,JSON.stringify(res));
  assert.equal(res.body.reconstruction.blr_index,rec.blr_index);
  assert.equal(res.body.reconstruction.word,rec.word);
  assert.equal(res.body.structure.c1,cs.c1);
  assert.equal(Object.keys(res.body.structure).length,17);
  assert.deepEqual(res.body.reflexes.map(r=>r.id),reflexes);

  const byIndex=await request(s.base,`/blr/by-index/${rec.blr_index}`);
  assert.equal(byIndex.status,200);
  assert.equal(byIndex.body.id,rec.id);

  assert.equal((await request(s.base,'/blr/999999999')).status,404);
  assert.equal((await request(s.base,'/blr/by-index/999999999')).status,404);
  assert.equal((await request(s.base,'/blr/abc')).status,404);

  const config=await request(s.base,'/blr/config');
  assert.equal(config.status,200);
  assert.ok('siteUrl' in config.body);
 } finally {await stopServer(s.child);}
});

test('BLR API updates fields and structure without changing shared structure rows',async()=>{
 const {dir,db}=copyDatabase(); const s=await startServer(db,dir,14455);
 try {
  // A consonant structure shared by several reconstructions.
  const shared=sql(db,`select consonant_structure_id id from reconstruction where consonant_structure_id is not null
    group by consonant_structure_id having count(*)>1 limit 1`)[0].id;
  const rec=sql(db,'select id, blr_index, date_of_entry from reconstruction where consonant_structure_id=? limit 1',[shared])[0];
  const before=sql(db,'select * from blrconsonantstructure where id=?',[shared])[0];
  const loaded=(await request(s.base,`/blr/${rec.id}`)).body;

  const body={
    reconstruction:{...loaded.reconstruction,english:'edited gloss',date_of_entry:null},
    structure:{...loaded.structure,c1:'zz-test'},
    reflex_ids:loaded.reflexes.map(r=>r.id),
  };
  delete body.reconstruction.id; delete body.reconstruction.blr_index;
  const res=await request(s.base,`/blr/${rec.id}`,'PUT',body);
  assert.equal(res.status,200,JSON.stringify(res));
  assert.equal(res.body.blr_index,rec.blr_index);

  const after=sql(db,'select * from reconstruction where id=?',[rec.id])[0];
  assert.equal(after.english,'edited gloss');
  assert.equal(after.blr_index,rec.blr_index);
  assert.equal(after.date_of_entry,rec.date_of_entry);
  assert.notEqual(after.consonant_structure_id,shared);
  assert.equal(sql(db,'select c1 from blrconsonantstructure where id=?',[after.consonant_structure_id])[0].c1,'zz-test');
  assert.deepEqual(sql(db,'select * from blrconsonantstructure where id=?',[shared])[0],before);
 } finally {await stopServer(s.child);}
});

test('BLR API update links and unlinks reflexes, and rolls back on a conflict',async()=>{
 const {dir,db}=copyDatabase(); const s=await startServer(db,dir,14456);
 try {
  const rec=sql(db,`select r.id, r.blr_index from reconstruction r
    where (select count(*) from reflex x where x.blr_entry_id=r.id)>=2 limit 1`)[0];
  const loaded=(await request(s.base,`/blr/${rec.id}`)).body;
  const [dropped,...kept]=loaded.reflexes.map(r=>r.id);
  const added=unlinked(db,1)[0];
  const body={reconstruction:{...loaded.reconstruction},structure:loaded.structure,reflex_ids:[...kept,added]};
  delete body.reconstruction.id; delete body.reconstruction.blr_index;

  const res=await request(s.base,`/blr/${rec.id}`,'PUT',body);
  assert.equal(res.status,200,JSON.stringify(res));
  assert.equal(res.body.linked,1);
  assert.equal(res.body.unlinked,1);
  assert.deepEqual(sql(db,'select blr_index, blr_entry_id from reflex where id=?',[dropped])[0],{blr_index:null,blr_entry_id:null});
  assert.deepEqual(sql(db,'select blr_index, blr_entry_id from reflex where id=?',[added])[0],{blr_index:String(rec.blr_index),blr_entry_id:rec.id});

  // A reflex of another reconstruction: 409 and nothing changes.
  const other=sql(db,'select id from reflex where blr_entry_id is not null and blr_entry_id<>? limit 1',[rec.id])[0].id;
  const conflict=await request(s.base,`/blr/${rec.id}`,'PUT',{...body,reconstruction:{...body.reconstruction,english:'not saved'},reflex_ids:[other]});
  assert.equal(conflict.status,409,JSON.stringify(conflict));
  assert.notEqual(sql(db,'select english from reconstruction where id=?',[rec.id])[0].english,'not saved');
  assert.equal(sql(db,'select blr_entry_id from reflex where id=?',[added])[0].blr_entry_id,rec.id);

  // An update may leave no reflexes; most existing reconstructions have none.
  const none=await request(s.base,`/blr/${rec.id}`,'PUT',{...body,reflex_ids:[]});
  assert.equal(none.status,200,JSON.stringify(none));
  assert.equal(sql(db,'select count(*) n from reflex where blr_entry_id=?',[rec.id])[0].n,0);

  // Candidates for this reconstruction include its own reflexes.
  await request(s.base,`/blr/${rec.id}`,'PUT',{...body,reflex_ids:[added]});
  const list=await request(s.base,`/blr/reflexes?pageSize=500&q=&owner_id=${rec.id}&page=1`);
  assert.equal(list.status,200);
  assert.ok(list.body.data.every(r=>r.blr_entry_id==null||r.blr_entry_id===rec.id));
 } finally {await stopServer(s.child);}
});
