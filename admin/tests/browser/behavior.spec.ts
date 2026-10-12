import {test,expect} from './fixtures';
// @ts-ignore shared JavaScript helpers
import {copyDatabase,startServer,stopServer,request,sql} from '../helpers.mjs';
let server:any,db:string;
test.beforeAll(async()=>{const copy=copyDatabase();db=copy.db;server=await startServer(db,copy.dir,14445);});
test.afterAll(async()=>{await stopServer(server.child);});
test('search, filter, paging, sort and navigation refresh',async({page})=>{
 await page.goto('crouton/entry');
 await expect(page.getByRole('button',{name:'Edit',exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'>',exact:true}).click();
 await expect(page).toHaveURL(/page=2/);
 await page.reload();await expect(page.getByRole('button',{name:'Edit',exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Term',exact:true}).click();
 await expect(page).toHaveURL(/sort=term/);
 await page.getByRole('textbox',{name:'Search...'}).fill('bá');
 await expect(page).toHaveURL(/q=/);
 await page.getByRole('button',{name:'Filters',exact:true}).click();
 await expect(page.locator('input,select').first()).toBeVisible();
});
test('relation search stores an integer, supports clearing, and preserves numeric-only forms',async({page})=>{
 const country=(await request(server.base,'/country','POST',{name:'Picker unique country'})).body;
 const region=(await request(server.base,'/region','POST',{name:'Picker test region'})).body;
 await page.goto(`crouton/region?id=${region.id}&event=update`);
 const input=page.getByRole('combobox',{name:'country_id',exact:true});
 await input.fill('Picker unique');
 await page.getByRole('listbox').getByRole('option').filter({hasText:'Picker unique country'}).click();
 await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('form')).toHaveCount(0);
 expect(sql(db,'select country_id from region where id=?',[region.id])[0].country_id).toBe(country.id);
 await page.goto(`crouton/region?id=${region.id}&event=update`);
 await expect(input).toHaveValue(new RegExp(`Picker unique country`));
 await input.fill('Picker');
 await page.locator('form').getByRole('button',{name:'Clear',exact:true}).click();
 await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.locator('form')).toHaveCount(0);
 expect(sql(db,'select country_id from region where id=?',[region.id])[0].country_id).toBeNull();
});
test('failed unique save retains form values; cancel does not persist',async({page})=>{
 const first=(await request(server.base,'/entry','POST',{term:'Unique first',beginning_id:1800000000})).body;
 const second=(await request(server.base,'/entry','POST',{term:'Unique second',beginning_id:1800000001})).body;
 await page.goto(`crouton/entry?id=${second.id}&event=update`);
 await page.locator('form input[aria-label="beginning_id"]').fill(String(first.beginning_id));
 await page.locator('form input[aria-label="term"]').fill('Unsaved modification');
 const failed=page.waitForResponse(r=>r.url().endsWith(`/entry/${second.id}`)&&r.request().method()==='PUT');
 await page.getByRole('button',{name:'Save',exact:true}).click();expect((await failed).status()).toBe(400);
 await expect(page.locator('form')).toBeVisible();await expect(page.locator('form input[aria-label="term"]')).toHaveValue('Unsaved modification');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('form')).toHaveCount(0);
 expect(sql(db,'select term from entry where id=?',[second.id])[0].term).toBe('Unique second');
});
