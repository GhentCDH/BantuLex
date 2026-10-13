import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const env={...process.env,PATH:resolve('node_modules/.bin')+':'+process.env.PATH};
for(const args of [['scripts/patch-crouton.mjs'],['node_modules/prisma/build/index.js','generate','--config','prisma/default/prisma.config.ts']]) execFileSync(process.execPath,args,{stdio:'inherit',env});
