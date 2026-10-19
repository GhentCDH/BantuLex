import {test,expect} from './fixtures';
// @ts-ignore shared test helpers
import {copyDatabase,startServer,stopServer,sql} from '../helpers.mjs';
let server:any, db:string;
test.beforeAll(async()=>{const copy=copyDatabase();db=copy.db;server=await startServer(db,copy.dir,14445);});
test.afterAll(async()=>{await stopServer(server.child);});
test('detail view links to related records and pages through linked records',async({page})=>{
 const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
 const reflex=sql(db,'select r.id,r.fieldwork_id from reflex r where r.fieldwork_id in (select fieldwork_id from reflex group by 1 having count(*)>10) limit 1')[0];
 const count=sql(db,'select count(*) n from reflex where fieldwork_id=?',[reflex.fieldwork_id])[0].n;
 await page.goto(`crouton/reflex?id=${reflex.id}&event=view`);
 const open=page.locator('dialog[open]');
 // A relation is a link to the related record, not a text value.
 const fieldwork=open.locator('.relation-link[data-resource=fieldwork]');
 await expect(fieldwork.getByRole('link',{name:'Edit Fieldwork'})).toHaveAttribute('href',new RegExp(`/crouton/fieldwork\\?id=${reflex.fieldwork_id}&event=update$`));
 await fieldwork.getByRole('link').first().click();
 await expect(page).toHaveURL(new RegExp(`/crouton/fieldwork\\?id=${reflex.fieldwork_id}&event=view$`));
 await expect(open).toHaveCount(1);
 const reflexes=open.locator('.related-table[data-resource=reflex]');
 // The count is formatted for the browser's locale; compare its digits.
 await expect.poll(async()=>(await reflexes.locator('.related-count').textContent())?.replace(/\D/g,'')).toBe(String(count));
 await expect(reflexes.locator('tbody tr')).toHaveCount(10);
 const first=await reflexes.locator('tbody tr').first().textContent();
 await reflexes.getByRole('button',{name:'Next'}).click();
 await expect(reflexes.getByText('Page 2 of')).toBeVisible();
 await expect(reflexes.locator('tbody tr').first()).not.toHaveText(first!);
 await reflexes.getByRole('link',{name:'Edit',exact:true}).first().click();
 await expect(page).toHaveURL(/\/crouton\/reflex\?id=\d+&event=update$/);
 await expect(open).toHaveCount(1);
 await expect(open.locator('form [aria-label="term"]')).toBeVisible();
 await page.goBack();
 await expect(page).toHaveURL(new RegExp(`/crouton/fieldwork\\?id=${reflex.fieldwork_id}&event=view$`));
 await expect(open).toHaveCount(1);
 expect(errors).toEqual([]);
});
