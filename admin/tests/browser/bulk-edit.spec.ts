import {test,expect} from './fixtures';
// @ts-ignore shared test helpers
import {copyDatabase,startServer,stopServer,sql} from '../helpers.mjs';
let server:any, db:string;
test.beforeAll(async()=>{const copy=copyDatabase();db=copy.db;server=await startServer(db,copy.dir,14445);});
test.afterAll(async()=>{await stopServer(server.child);});
const row=(id:number)=>sql(db,'select * from reflex where id=?',[id])[0];

test('bulk edit saves a row with one PATCH of its changed fields when the row is left',async({page})=>{
 const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
 const patches:any[]=[]; page.on('request',r=>{if(r.method()==='PATCH')patches.push({url:r.url(),body:r.postDataJSON()});});
 await page.goto('crouton/bulk-edit');
 await expect(page.getByRole('link',{name:'Bulk edit',exact:true})).toBeVisible();
 const ids=sql(db,'select id from reflex order by id limit 5').map((r:any)=>r.id);
 const before=row(ids[1]);
 // Moving through a row without editing it sends nothing.
 await page.getByLabel('Term row 1',{exact:true}).click();
 await page.keyboard.press('Enter');
 await page.getByLabel('Translation row 2',{exact:true}).fill('edited translation');
 await expect(page.getByLabel('Translation row 2',{exact:true}).locator('..')).toHaveClass(/bulk-changed/);
 await page.keyboard.press('Enter');
 await expect.poll(()=>row(ids[1]).translation).toBe('edited translation');
 expect(patches).toEqual([{url:expect.stringMatching(new RegExp(`/api/reflex/${ids[1]}$`)),body:{translation:'edited translation'}}]);
 const after=row(ids[1]);
 for(const k of ['term','meaning','notes','variety_id','fieldwork_id']) expect(after[k]).toBe(before[k]);
 await expect(page.locator('.bulk-row.bulk-saved[data-row="2"]')).toHaveCount(1);

 // A pasted block changes several rows; each is saved when the focus moves on.
 await page.getByLabel('Notes row 4',{exact:true}).click();
 await page.evaluate(()=>{const el=document.activeElement!;const dt=new DataTransfer();dt.setData('text/plain','note A\nnote B');
   el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));});
 await page.getByLabel('Term row 1',{exact:true}).click();
 await expect.poll(()=>[row(ids[3]).notes,row(ids[4]).notes]).toEqual(['note A','note B']);
 // Clearing a cell stores NULL.
 await page.getByLabel('Notes row 4',{exact:true}).fill('');
 await page.getByRole('button',{name:'Save all'}).click();
 await expect.poll(()=>row(ids[3]).notes).toBeNull();
 expect(errors).toEqual([]);
});

test('bulk edit shows Crouton field errors and asks before dropping unsaved rows',async({page})=>{
 await page.route('**/api/reflex/*',route=>route.request().method()==='PATCH'
   ? route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({statusCode:400,message:[{field:'term',message:'Term is wrong'}]})})
   : route.fallback());
 await page.goto('crouton/bulk-edit');
 const id=sql(db,'select id from reflex order by id limit 1')[0].id;
 const term=row(id).term;
 await page.getByLabel('Term row 1',{exact:true}).fill('rejected');
 await page.getByLabel('Term row 2',{exact:true}).click();
 await expect(page.getByLabel('Term row 1',{exact:true}).locator('..')).toHaveClass(/bulk-cell-error/);
 await expect(page.getByLabel('Term row 1',{exact:true}).locator('..')).toHaveAttribute('title','Term is wrong');
 await expect(page.getByRole('status')).toContainText('1 not saved');
 page.once('dialog',d=>d.dismiss());
 await page.getByRole('button',{name:'Next'}).click();
 await expect(page.getByLabel('Term row 1',{exact:true})).toHaveValue('rejected');
 expect(row(id).term).toBe(term);
 // Search narrows the rows (after discarding the failed edit).
 page.once('dialog',d=>d.accept());
 await page.getByLabel('Search reflexes').fill(term);
 // Crouton's q searches several columns: the first row contains the text in one of them.
 await expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll<HTMLInputElement>('[aria-label$=" row 1"]')].map(i=>i.value).join(' '))).toContain(term);
});

test('bulk edit grid fills the remaining window height',async({page})=>{
 await page.goto('crouton/bulk-edit');
 const grid=page.locator('.bulk-viewport');
 await expect(grid).toBeVisible();
 const measure=()=>page.evaluate(()=>{
   const el=document.querySelector<HTMLElement>('.bulk-viewport')!;
   const r=el.getBoundingClientRect();
   return {height:r.height,bottom:r.bottom,viewport:window.innerHeight,scroll:document.scrollingElement!.scrollHeight};
 });
 const small=await measure();
 expect(small.height).toBeGreaterThan(400);
 expect(small.bottom).toBeLessThanOrEqual(small.viewport);
 expect(small.scroll).toBeLessThanOrEqual(small.viewport+1);

 await page.setViewportSize({width:1920,height:1200});
 await page.waitForTimeout(400);
 const large=await measure();
 expect(large.height).toBeGreaterThan(small.height);
 expect(large.bottom).toBeLessThanOrEqual(large.viewport);
 expect(large.scroll).toBeLessThanOrEqual(large.viewport+1);
});

test('bulk edit removes row numbers but keeps id, columns and page size',async({page})=>{
 await page.goto('crouton/bulk-edit');
 await expect(page.getByRole('button',{name:'Id',exact:true})).toHaveCount(1);
 await expect(page.locator('.bulk-th').filter({hasText:'Variety'})).toHaveCount(1);
 await expect(page.locator('.bulk-num')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Variety'})).toHaveCount(0);

 const requests:string[]=[];
 page.on('request',r=>{if(r.url().includes('/api/reflex?'))requests.push(r.url())});
 await page.getByLabel('Rows per page').selectOption('500');
 await expect.poll(()=>requests.some(u=>u.includes('pageSize=500'))).toBe(true);
 await expect(page.getByText(/Rows 1–500 of/)).toBeVisible();

 await page.getByRole('button',{name:'Term',exact:true}).click();
 await expect.poll(()=>requests.some(u=>u.includes('sort=term')&&u.includes('sortDir=asc'))).toBe(true);
 await page.getByRole('button',{name:'Term',exact:true}).click();
 await expect.poll(()=>requests.some(u=>u.includes('sort=term')&&u.includes('sortDir=desc'))).toBe(true);

 await page.getByText('Columns',{exact:true}).click();
 await page.getByRole('checkbox',{name:'Notes',exact:true}).uncheck();
 await expect(page.getByRole('button',{name:'Notes',exact:true})).toHaveCount(0);
 await page.reload();
 await expect(page.getByRole('button',{name:'Notes',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Id',exact:true})).toHaveCount(1);
});

test('bulk edit fills a block by dragging the cell handle',async({page})=>{
 await page.goto('crouton/bulk-edit');
 const ids=sql(db,'select id from reflex order by id limit 3').map((r:any)=>r.id);
 const term=page.getByLabel('Term row 1',{exact:true});
 await term.fill('fill-test');
 const handle=page.locator('.bulk-fill-handle');
 await expect(handle).toHaveCount(1);
 const hb=await handle.boundingBox();
 const target=await page.getByLabel('Term row 3',{exact:true}).boundingBox();
 await page.mouse.move(hb!.x+hb!.width/2,hb!.y+hb!.height/2);
 await page.mouse.down();
 await page.mouse.move(target!.x+target!.width/2,target!.y+target!.height/2,{steps:10});
 await page.mouse.up();

 await expect(page.getByLabel('Term row 2',{exact:true})).toHaveValue('fill-test');
 await expect(page.getByLabel('Term row 3',{exact:true})).toHaveValue('fill-test');
 await expect.poll(()=>[row(ids[1]).term,row(ids[2]).term]).toEqual(['fill-test','fill-test']);

 // Read-only cells have no handle.
 await page.getByLabel('Id row 1',{exact:true}).click();
 await expect(page.locator('.bulk-fill-handle')).toHaveCount(0);
});

test('bulk edit rejects a missing BLR index and flashes saved and failed rows',async({page})=>{
 await page.goto('crouton/bulk-edit');
 const id=sql(db,'select id from reflex order by id limit 1')[0].id;
 const before=row(id);
 const cell=page.getByLabel('Blr index row 1',{exact:true});
 await cell.fill('99999999');
 await page.getByLabel('Term row 2',{exact:true}).click();
 await expect(page.locator('.bulk-row[data-row="1"]')).toHaveClass(/bulk-error/);
 await expect(page.getByRole('status')).toContainText('not saved (row 1)');
 expect(row(id).blr_entry_id).toBe(before.blr_entry_id);

 const rec=sql(db,'select id, blr_index from reconstruction where blr_index is not null limit 1')[0];
 await cell.fill(String(rec.blr_index));
 await page.getByLabel('Term row 2',{exact:true}).click();
 await expect(page.locator('.bulk-row[data-row="1"]')).toHaveClass(/bulk-saved/);
 await expect.poll(()=>row(id).blr_entry_id).toBe(rec.id);
 expect(row(id).blr_index).toBe(String(rec.blr_index));
});

test('bulk edit resizes a column by dragging its header edge',async({page})=>{
 await page.goto('crouton/bulk-edit');
 const th=page.locator('.bulk-th[data-key="term"]');
 const before=await th.boundingBox();
 const handle=page.locator('.bulk-resize[data-resize="term"]');
 const hb=await handle.boundingBox();
 await page.mouse.move(hb!.x+hb!.width/2,hb!.y+hb!.height/2);
 await page.mouse.down();
 await page.mouse.move(hb!.x+hb!.width/2+80,hb!.y+hb!.height/2,{steps:8});
 await page.mouse.up();
 const after=await th.boundingBox();
 expect(after!.width).toBeGreaterThan(before!.width+50);

 await page.reload();
 const reloaded=await page.locator('.bulk-th[data-key="term"]').boundingBox();
 expect(Math.abs(reloaded!.width-after!.width)).toBeLessThan(2);

 const hb2=await page.locator('.bulk-resize[data-resize="term"]').boundingBox();
 await page.mouse.dblclick(hb2!.x+hb2!.width/2,hb2!.y+hb2!.height/2);
 const reset=await page.locator('.bulk-th[data-key="term"]').boundingBox();
 expect(Math.abs(reset!.width-before!.width)).toBeLessThan(2);
});

test('bulk edit saves a variety by exact label and rejects unknown labels',async({page})=>{
 await page.goto('crouton/bulk-edit');
 const id=sql(db,'select id from reflex order by id limit 1')[0].id;
 const before=row(id);
 const v=sql(db,`select v.id, coalesce(v.name_english,v.name_bantu,v.name_french,v.name_bastin)||coalesce(' ('||v.guthrie_index||')','') label
   from variety v where v.name_english is not null and v.guthrie_index is not null and v.id<>?
   and (select count(*) from variety w where coalesce(w.name_english,w.name_bantu,w.name_french,w.name_bastin)||coalesce(' ('||w.guthrie_index||')','')
        = coalesce(v.name_english,v.name_bantu,v.name_french,v.name_bastin)||coalesce(' ('||v.guthrie_index||')',''))=1 limit 1`,[before.variety_id])[0];
 const cell=page.getByLabel('Variety row 1',{exact:true});
 await expect(page.locator('#bulk-list-variety_label option').first()).toBeAttached();
 await cell.fill(v.label);
 await page.getByLabel('Term row 2',{exact:true}).click();
 await expect.poll(()=>row(id).variety_id).toBe(v.id);
 await expect(page.locator('.bulk-row[data-row="1"]')).toHaveClass(/bulk-saved/);

 const count=sql(db,'select count(*) n from variety')[0].n;
 await cell.fill('No such variety 999');
 await page.getByLabel('Term row 2',{exact:true}).click();
 await expect(page.locator('.bulk-row[data-row="1"]')).toHaveClass(/bulk-error/);
 await expect(page.getByRole('status')).toContainText('not saved (row 1)');
 expect(row(id).variety_id).toBe(v.id);
 expect(sql(db,'select count(*) n from variety')[0].n).toBe(count);
});
