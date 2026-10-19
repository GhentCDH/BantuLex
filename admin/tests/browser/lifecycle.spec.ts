import {test,expect} from './fixtures';
// @ts-ignore shared JavaScript helpers
import {copyDatabase,startServer,stopServer,inventory,sql,request} from '../helpers.mjs';
// Junction tables: [parent resource, column]; a fresh parent keeps the (fieldwork, person) pair unique.
const junctions:Record<string,[string,string]>={fieldworkdatacollector:['datacollector','data_collector_id'],fieldworkconsultant:['consultant','consultant_id']};
let server:any,db:string;
test.beforeAll(async()=>{const copy=copyDatabase();db=copy.db;server=await startServer(db,copy.dir,14445);});
test.afterAll(async()=>{await stopServer(server.child);});
for(const table of inventory) {
 test(`${table.table}: create, reopen, cancel and delete`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const junction=junctions[table.table];
  if(junction) await request(server.base,`/${junction[0]}`,'POST',{name:'Browser junction parent'});
  await page.goto(`crouton/${table.table}`);
  await page.getByRole('button',{name:'Add record',exact:true}).click();
  await expect(page.locator('form')).toBeVisible();
  for(const col of table.columns.filter((c:any)=>!['id','created_at','updated_at'].includes(c.name)&&!table.foreignKeys[c.name])) {
   const input=page.locator(`form [aria-label="${col.name}"]`);
   if(col.type==='BOOLEAN') await input.check();
   else await input.fill(col.type==='TEXT'?`Created ${col.name} bá`:['REAL','FLOAT'].includes(col.type)?'1.25':'1899999999');
  }
  if(junction) {
   for(const field of ['fieldwork_id',junction[1]]) {
    const input=page.locator(`form input[aria-label="${field}"]`);await input.click();await input.fill(field===junction[1]?'Browser junction parent':'');
    await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
    await page.getByRole('listbox').getByRole('option').first().click();
   }
  }
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/'+table.table)&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  const response=await saved;expect(response.status(),await response.text()).toBe(201);const row=await response.json();
  await expect(page.locator('form')).toHaveCount(0);
  await page.goto(`crouton/${table.table}?id=${encodeURIComponent(row.id)}&event=update`);
  await expect(page.locator('form')).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('form')).toHaveCount(0);
  await page.goto(`crouton/${table.table}?id=${encodeURIComponent(row.id)}&event=delete`);
  await page.getByRole('dialog').getByRole('button',{name:'Ok',exact:true}).click();
  await expect.poll(async()=>(await request(server.base,`/${table.table}/${row.id}`)).status).toBe(404);
  expect(errors).toEqual([]);
 });
}
