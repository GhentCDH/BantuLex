import {test,expect} from './fixtures';
// @ts-ignore shared test helpers
import {copyDatabase,startServer,stopServer,sql} from '../helpers.mjs';
let server:any, db:string;
test.beforeAll(async()=>{const copy=copyDatabase();db=copy.db;server=await startServer(db,copy.dir,14445);});
test.afterAll(async()=>{await stopServer(server.child);});

test('bulk import: paste from a spreadsheet, validate, save and undo',async({page})=>{
 const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
 const before=sql(db,'select count(*) n from reflex')[0].n;
 await page.goto('crouton/bulk-import');
 await page.evaluate(()=>localStorage.removeItem('bantulex-bulk-draft'));
 await page.reload();
 await expect(page.getByRole('link',{name:'Bulk import',exact:true})).toBeVisible();

 // Paste three rows with a header, as copied from Excel.
 const cell=page.getByLabel('Term row 1',{exact:true});
 await cell.click();
 await cell.evaluate((el,text)=>{const dt=new DataTransfer();dt.setData('text/plain',text);
   el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},
   'Term\tTranslation\tBLR index\r\nmbúla\tpluie\t368\r\nndzo\tmaison\t\r\nmuntu\tpersonne\t3005\r\n');
 await expect(page.getByLabel('Translation row 2',{exact:true})).toHaveValue('maison');
 await expect(page.getByText('3 filled of')).toBeVisible();

 await page.getByLabel('Import label *').fill('Browser test import');
 const source=page.getByLabel('Source *',{exact:true});
 await source.fill('Bastin');
 await page.getByRole('button',{name:/Bastin/}).first().click();

 await page.getByRole('button',{name:'Validate',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Validation passed');
 await expect(page.getByRole('status')).toContainText('2 linked to a BLR reconstruction');
 expect(sql(db,'select count(*) n from reflex')[0].n).toBe(before);

 await page.getByRole('button',{name:'Save 3 reflexes'}).click();
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Saved as bulk import #');
 expect(sql(db,'select count(*) n from reflex')[0].n).toBe(before+3);

 const row=page.locator('table.table tbody tr').first();
 await expect(row).toContainText('Browser test import');
 await row.getByRole('button',{name:'Undo'}).click();
 await page.getByRole('button',{name:'Undo import'}).click();
 await expect(row).toContainText('undone');
 expect(sql(db,'select count(*) n from reflex')[0].n).toBe(before);
 expect(errors).toEqual([]);
});
