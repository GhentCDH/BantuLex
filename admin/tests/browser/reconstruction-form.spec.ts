import {test,expect} from './fixtures';
// @ts-ignore shared test helpers
import {copyDatabase,startServer,stopServer,sql} from '../helpers.mjs';

let server:any, db:string;
test.beforeAll(async()=>{const copy=copyDatabase();db=copy.db;server=await startServer(db,copy.dir,14445);});
test.afterAll(async()=>{await stopServer(server.child);});

test('create a reconstruction with structures and reflexes in one save',async({page})=>{
 const max=sql(db,'select max(blr_index) m from reconstruction')[0].m;
 const reflex=sql(db,'select id, term from reflex where blr_entry_id is null and term is not null order by id limit 1')[0];

 await page.goto('crouton/reconstruction-form');
 await expect(page.getByRole('heading',{name:'Reconstruction form'})).toBeVisible();
 await expect(page.getByText(`BLR ${max+1} — new`)).toBeVisible();

 await page.getByLabel('Word',{exact:true}).fill('test-reconstruction');
 await page.getByLabel('English',{exact:true}).fill('test meaning');
 await page.getByLabel('Word (tone)',{exact:true}).fill('tést');
 // The heading follows the form, as in the public viewer.
 await expect(page.getByRole('heading',{name:'*tést'})).toBeVisible();
 await expect(page.getByText('‘test meaning’')).toBeVisible();
 await page.getByLabel('C₁',{exact:true}).selectOption('b');
 await page.getByLabel('V₁₁',{exact:true}).selectOption('a');
 await page.getByLabel('T₁₁',{exact:true}).selectOption({index:1});
 await page.getByLabel('Zone A').check();

 await page.getByLabel('Search reflexes').fill(reflex.term);
 await page.getByLabel(`Select reflex ${reflex.id}`,{exact:true}).check();
 await expect(page.getByText('1 reflex selected')).toBeVisible();

 await page.getByRole('button',{name:'Create reconstruction'}).click();
 await expect(page).toHaveURL(new RegExp('/crouton/reconstruction-form\\?id=\\d+$'));
 await expect(page.getByRole('button',{name:'Save changes'})).toBeVisible();

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
 await page.goto('crouton/reconstruction-form');
 await page.getByLabel('Word',{exact:true}).fill('without-reflexes');
 await page.getByRole('button',{name:'Create reconstruction'}).click();
 await expect(page.getByText('Select at least one reflex.')).toBeVisible();
 expect(sql(db,"select count(*) n from reconstruction where word='without-reflexes'")[0].n).toBe(0);
});

test('edit a reconstruction opened by BLR index: fields, header and unlinking a reflex',async({page})=>{
 const rec=sql(db,`select r.id, r.blr_index from reconstruction r
   where (select count(*) from reflex x where x.blr_entry_id=r.id)>=2 order by r.id limit 1`)[0];
 const dropped=sql(db,'select id from reflex where blr_entry_id=? order by id limit 1',[rec.id])[0].id;

 await page.goto('crouton/reconstruction-form');
 await page.getByLabel('BLR index',{exact:true}).fill(String(rec.blr_index));
 await page.getByRole('button',{name:'Open'}).click();
 await expect(page).toHaveURL(new RegExp(`/crouton/reconstruction-form\\?id=${rec.id}$`));
 await expect(page.getByText(`BLR ${rec.blr_index}`,{exact:true})).toBeVisible();

 await page.getByLabel('English',{exact:true}).fill('edited gloss');
 await expect(page.getByText('‘edited gloss’')).toBeVisible();
 await page.getByLabel(`Remove reflex ${dropped}`).click();
 await expect(page.getByText('unlinked on save')).toBeVisible();
 await page.getByRole('button',{name:'Save changes'}).click();
 await expect(page.getByRole('button',{name:'Save changes'})).toBeDisabled();

 expect(sql(db,'select english from reconstruction where id=?',[rec.id])[0].english).toBe('edited gloss');
 expect(sql(db,'select blr_index, blr_entry_id from reflex where id=?',[dropped])[0]).toEqual({blr_index:null,blr_entry_id:null});

 await page.reload();
 await expect(page.getByLabel('English',{exact:true})).toHaveValue('edited gloss');
 await expect(page.getByLabel(`Remove reflex ${dropped}`)).toHaveCount(0);
});

test('the Crouton reconstruction view links to the reconstruction form',async({page})=>{
 const rec=sql(db,'select id, blr_index from reconstruction where blr_index is not null order by id limit 1')[0];
 await page.goto(`crouton/reconstruction?id=${rec.id}&event=view`);
 await page.locator('dialog[open]').getByRole('link',{name:'Reconstruction form'}).click();
 await expect(page).toHaveURL(new RegExp(`/crouton/reconstruction-form\\?id=${rec.id}$`));
 await expect(page.getByText(`BLR ${rec.blr_index}`,{exact:true})).toBeVisible();
});
