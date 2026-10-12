import {test,expect} from './fixtures';
// @ts-ignore JavaScript integration helpers
import {copyDatabase,startServer,stopServer,inventory,sql} from '../helpers.mjs';
let server:any,db:string;
test.beforeAll(async()=>{const copy=copyDatabase();db=copy.db;server=await startServer(db,copy.dir,14445);});
test.afterAll(async()=>{await stopServer(server.child);});
for(const table of inventory) {
 test(`${table.table}: edit overlay renders every business field and saves`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`crouton/${table.table}`);
  await page.getByRole('button',{name:'Edit',exact:true}).first().click();
  await expect(page.locator('form')).toBeVisible();
  for(const col of table.columns.filter((c:any)=>!['id','created_at','updated_at'].includes(c.name))) {
   const label=col.name.replaceAll('_',' '); const expected=label.charAt(0).toUpperCase()+label.slice(1);
   await expect(page.locator('form').getByText(expected,{exact:true}).first()).toBeVisible();
  }
  const field=table.columns.find((c:any)=>c.type==='TEXT'&&!['created_at','updated_at'].includes(c.name));
  if(field) {
   const input=page.locator('form input,form textarea').filter({visible:true});
   // Controls expose field names through vee-validate's name attribute.
   const target=page.locator(`form [aria-label="${field.name}"]`);
   await expect(target).toBeVisible();
   const value=`Browser ${table.table} bá ɪ`;
   await target.fill(value);
   await page.getByRole('button',{name:'Save',exact:true}).click();
   await expect(page.locator('form')).toHaveCount(0);
   expect(sql(db,`select "${field.name}" as value from "${table.table}" order by id limit 1`)[0].value).toBe(value);
  } else await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'View',exact:true}).first().click();
  const detail=page.getByRole('dialog');await expect(detail).toBeVisible();
  for(const col of table.columns) {
   const raw=col.name.replaceAll('_',' ');const label=raw.charAt(0).toUpperCase()+raw.slice(1);
   await expect(detail.getByText(label,{exact:true}).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
 });
}
