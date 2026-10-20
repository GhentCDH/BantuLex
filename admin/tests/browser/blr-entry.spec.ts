import {test,expect} from './fixtures';
// @ts-ignore shared test helpers
import {copyDatabase,startServer,stopServer,sql} from '../helpers.mjs';

let server:any, db:string;
test.beforeAll(async()=>{const copy=copyDatabase();db=copy.db;server=await startServer(db,copy.dir,14445);});
test.afterAll(async()=>{await stopServer(server.child);});

test('create a reconstruction with structures and reflexes in one save',async({page})=>{
 const max=sql(db,'select max(blr_index) m from reconstruction')[0].m;
 const reflex=sql(db,'select id, term from reflex where blr_entry_id is null and term is not null order by id limit 1')[0];

 await page.goto('crouton/new-reconstruction');
 await expect(page.getByRole('heading',{name:'New reconstruction'})).toBeVisible();
 await expect(page.getByText(`BLR index ${max+1}`)).toBeVisible();

 await page.getByLabel('Word',{exact:true}).fill('test-reconstruction');
 await page.getByLabel('English',{exact:true}).fill('test meaning');
 await page.getByLabel('Word (tone)',{exact:true}).fill('tést');
 await page.getByLabel('C₁',{exact:true}).selectOption('b');
 await page.getByLabel('V₁₁',{exact:true}).selectOption('a');
 await page.getByLabel('T₁₁',{exact:true}).selectOption({index:1});
 await page.getByLabel('Zone A').check();

 await page.getByLabel('Search reflexes').fill(reflex.term);
 await page.getByLabel(`Select reflex ${reflex.id}`,{exact:true}).check();
 await expect(page.getByText('1 reflex selected')).toBeVisible();

 await page.getByRole('button',{name:'Create reconstruction'}).click();
 await expect(page).toHaveURL(new RegExp('/crouton/reconstruction\\?id=\\d+&event=view$'));
 await expect(page.locator('dialog[open]')).toBeVisible();

 const rec=sql(db,'select * from reconstruction where word=?',['test-reconstruction'])[0];
 expect(rec.blr_index).toBe(max+1);
 expect(rec.distribution).toBe('A');
 expect(rec.consonant_structure_id).not.toBeNull();
 expect(rec.vowel_structure_id).not.toBeNull();
 expect(rec.tone_structure_id).not.toBeNull();
 const linked=sql(db,'select blr_index, blr_entry_id from reflex where id=?',[reflex.id])[0];
 expect(linked.blr_index).toBe(String(max+1));
 expect(linked.blr_entry_id).toBe(rec.id);
});

test('a new reconstruction cannot be saved without a reflex',async({page})=>{
 await page.goto('crouton/new-reconstruction');
 await page.getByLabel('Word',{exact:true}).fill('without-reflexes');
 await page.getByRole('button',{name:'Create reconstruction'}).click();
 await expect(page.getByText('Select at least one reflex.')).toBeVisible();
 expect(sql(db,"select count(*) n from reconstruction where word='without-reflexes'")[0].n).toBe(0);
});
