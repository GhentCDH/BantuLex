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
 await expect(page.locator('.bulk-num[data-status=saved]')).toHaveText(['2']);

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
