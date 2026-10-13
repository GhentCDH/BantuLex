import { build } from 'esbuild';
import { readdir, mkdir, copyFile } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
const base='apps/backend/src';
async function walk(dir) { const entries=await readdir(dir,{withFileTypes:true}); return (await Promise.all(entries.map(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]))).flat(); }
const files=await walk(base);
await build({entryPoints:files.filter(p=>p.endsWith('.ts')),outbase:base,outdir:'dist/backend',bundle:true,packages:'external',platform:'node',format:'esm',target:'node24',sourcemap:true});
for(const p of files.filter(p=>p.endsWith('.json'))) { const to=join('dist/backend',relative(base,p)); await mkdir(dirname(to),{recursive:true}); await copyFile(p,to); }
