import {test as base,expect,chromium,type Browser} from '@playwright/test';
import {lookup} from 'node:dns/promises';
// No browser is installed in the dev image: the tests drive a Chrome started on the host with
// --remote-debugging-port, over the Chrome DevTools Protocol. Playwright's page/context fixtures create
// (and close) fresh contexts on that browser; at worker teardown the browser is only disconnected.
const endpoint=process.env.PW_CDP_URL || 'http://host.docker.internal:9222';
const help=`Start a dedicated Chrome on the host first, e.g.
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$TMPDIR/bantulex-e2e-chrome" --headless=new
and set PW_CDP_URL if it is not reachable at http://host.docker.internal:9222 (see README.md, Verification).`;
// Chrome's DevTools HTTP endpoint rejects Host headers other than localhost or an IP address.
async function resolveEndpoint(url:string) {
 const u=new URL(url);
 if(u.hostname!=='localhost' && !/^[\d.]+$|^\[/.test(u.hostname)) {
  const {address,family}=await lookup(u.hostname);
  u.hostname=family===6?`[${address}]`:address;
 }
 return u.toString().replace(/\/$/,'');
}
export const test=base.extend<{},{browser:Browser}>({
 browser:[async({},use)=>{
  let browser:Browser;
  try {browser=await chromium.connectOverCDP(await resolveEndpoint(endpoint),{timeout:10000});}
  catch(e) {throw new Error(`Cannot connect to Chrome over CDP at ${endpoint}: ${(e as Error).message.split('\n')[0]}\n${help}`);}
  await use(browser);
  // For a connected (not launched) browser, close() removes the contexts this worker created and disconnects;
  // the host Chrome keeps running.
  await browser.close();
 },{scope:'worker'}],
});
export {expect};
