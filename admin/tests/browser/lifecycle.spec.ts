import {test,expect} from './fixtures';
// @ts-ignore shared JavaScript helpers
import {copyDatabase,startServer,stopServer,inventory,sql,request} from '../helpers.mjs';
let server:any,db:string;
test.beforeAll(async()=>{const copy=copyDatabase();db=copy.db;server=await startServer(db,copy.dir,14445);});
test.afterAll(async()=>{await stopServer(server.child);});
for(const table of inventory) {
 test(`${table.table}: create, reopen, cancel and delete`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  if(table.table==='fieldworkdatacollector') await request(server.base,'/datacollector','POST',{name:'Browser junction parent'});
  await page.goto(`crouton/${table.table}`);
  await page.getByRole('button',{name:'Add record',exact:true}).click();
  await expect(page.locator('form')).toBeVisible();
  for(const col of table.columns.filter((c:any)=>!['id','created_at','updated_at'].includes(c.name)&&!table.foreignKeys[c.name])) {
   await page.locator(`form [aria-label="${col.name}"]`).fill(col.type==='TEXT'?`Created ${col.name} bá`:col.type==='REAL'?'1.25':'1899999999');
  }
  if(table.table==='fieldworkdatacollector') {
   for(const field of ['fieldwork_id','data_collector_id']) {
    const input=page.locator(`form input[aria-label="${field}"]`);await input.click();await input.fill(field==='data_collector_id'?'Browser junction parent':'');
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
