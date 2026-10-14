import {test,expect} from './fixtures';
// @ts-ignore shared test helpers
import {copyDatabase,startServer,stopServer,sql} from '../helpers.mjs';
import ExcelJS from 'exceljs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
let server:any, db:string;
test.beforeAll(async()=>{const copy=copyDatabase();db=copy.db;server=await startServer(db,copy.dir,14445);});
test.afterAll(async()=>{await stopServer(server.child);});

test('bulk import wizard: template, links, upload, check, process and undo',async({page})=>{
 const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
 const before=sql(db,'select count(*) n from reflex')[0].n;
 await page.goto('crouton/bulk-import');
 await page.evaluate(()=>localStorage.removeItem('bantulex-bulk-draft'));
 await page.reload();
 await expect(page.getByRole('link',{name:'Bulk import',exact:true})).toBeVisible();

 // 1. Template: headers with comments, filled in like a researcher would.
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'Download template (.xlsx)'}).click();
 const file=join(tmpdir(),`bulk-${Date.now()}.xlsx`);
 await (await download).saveAs(file);
 const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
 const ws=wb.getWorksheet('Reflexes')!;
 expect(ws.getCell('A1').text).toBe('Term (required)');
 expect(String(ws.getCell('A1').note)).toContain('Required.');
 ws.addRow(['mbúla','pluie','rain',null,null,null,null,'12',null,'368']);
 ws.addRow(['ndzo','maison']);
 ws.addRow(['muntu','personne',null,null,null,null,null,null,null,'3005']);
 await wb.xlsx.writeFile(file);
 await page.getByRole('button',{name:'Next: links ›'}).click();

 // 2. Links.
 await page.getByLabel('Label *').fill('Browser test import');
 const source=page.getByLabel('Source',{exact:true});
 await source.fill('Bastin');
 await page.getByRole('button',{name:/Bastin/}).first().click();
 await page.getByRole('button',{name:'Next: upload ›'}).click();

 // 3. Upload and check.
 await page.getByLabel('Upload filled-in template').setInputFiles(file);
 await expect(page.getByText('3 rows',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Translation row 2',{exact:true})).toHaveValue('maison');
 await page.getByRole('button',{name:'Check against the database'}).click();
 await expect(page.getByText(/Check passed: 3 rows; 2 linked to BLR/)).toBeVisible();
 expect(sql(db,'select count(*) n from reflex')[0].n).toBe(before);
 await page.getByRole('button',{name:'Next: process ›'}).click();

 // 4. Process (one transaction), then undo.
 await page.getByRole('button',{name:'Process import (3 reflexes)'}).click();
 await page.getByRole('button',{name:'Process import',exact:true}).click();
 await expect(page.getByText(/Imported 3 reflexes as bulk import #/)).toBeVisible();
 expect(sql(db,'select count(*) n from reflex')[0].n).toBe(before+3);

 const row=page.locator('table.table').last().locator('tbody tr').first();
 await expect(row).toContainText('Browser test import');
 await row.getByRole('button',{name:'Undo'}).click();
 await page.getByRole('button',{name:'Undo import'}).click();
 await expect(row).toContainText('undone');
 expect(sql(db,'select count(*) n from reflex')[0].n).toBe(before);
 expect(errors).toEqual([]);
});
