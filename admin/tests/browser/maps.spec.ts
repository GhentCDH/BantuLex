import {test,expect} from './fixtures';
// @ts-ignore shared test helpers
import {copyDatabase,startServer,stopServer,sql} from '../helpers.mjs';
let server:any, db:string;
test.beforeAll(async()=>{const copy=copyDatabase();db=copy.db;server=await startServer(db,copy.dir,14445);});
test.afterAll(async()=>{await stopServer(server.child);});
test('local PMTiles map includes every valid coordinate and appears in detail',async({page})=>{
 const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
 const external:string[]=[]; page.on('request',r=>{const u=new URL(r.url());if(/^https?:$/.test(u.protocol)&&!['127.0.0.1','localhost'].includes(u.hostname))external.push(r.url());});
 await page.goto('crouton/coordinate');
 const count=sql(db,'select count(*) n from coordinate where latitude between -90 and 90 and longitude between -180 and 180')[0].n;
 const map=page.locator('.coordinate-map').first();
 await expect(map).toHaveAttribute('data-marker-count',String(count));
 await expect(map).toHaveAttribute('data-map-ready','true',{timeout:20000});
 await expect(map.locator('.maplibregl-marker')).toHaveCount(count);
 await expect(map.getByRole('alert')).toHaveCount(0);
 const archive=await page.request.get('maps/world.pmtiles',{headers:{Range:'bytes=0-126'}});
 expect(archive.status()).toBe(206);expect((await archive.body()).subarray(0,7).toString()).toBe('PMTiles');
 const point=sql(db,'select id from coordinate where latitude between -90 and 90 and longitude between -180 and 180 limit 1')[0];
 await page.goto(`crouton/coordinate?id=${point.id}&event=view`);
 const detail=page.getByRole('dialog').locator('.coordinate-map');
 await expect(detail).toHaveAttribute('data-marker-count','1');
 await expect(detail).toHaveAttribute('data-map-ready','true',{timeout:20000});
 await expect(detail.getByRole('alert')).toHaveCount(0);
 expect(errors).toEqual([]);
 expect(external).toEqual([]);
});
