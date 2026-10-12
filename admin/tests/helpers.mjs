import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
export const inventory=JSON.parse(readFileSync(new URL('./inventory.json',import.meta.url)));
export const sql=(db,query,params=[])=>JSON.parse(execFileSync('python3',['-c','import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; print(json.dumps([dict(r) for r in c.execute(sys.argv[2],json.loads(sys.argv[3]))]))',db,query,JSON.stringify(params)],{encoding:'utf8'}));
export function copyDatabase() {
 const dir=mkdtempSync(join(tmpdir(),'bantulex-test-')); const db=join(dir,'test.db');
 execFileSync('python3',['-c','import sqlite3,sys; s=sqlite3.connect("file:data/bantulex.db?mode=ro",uri=True); d=sqlite3.connect(sys.argv[1]); s.backup(d); d.close()',db]);
 return {dir,db};
}
export async function startServer(db,dir,port=14444) {
 let log='';const child=spawn(process.execPath,['dist/backend/main.js'],{cwd:resolve('.'),env:{...process.env,DATABASE_PATH:db,BACKUP_DIR:join(dir,'backups'),PORT:String(port),CROUTON_SCHEMA_EDITOR:'false'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 const base=`http://127.0.0.1:${port}/api`;
 for(let i=0;i<100;i++) { if(child.exitCode!==null) throw new Error(log); try {const r=await fetch(base+'/crouton/status.json');if(r.ok) return {child,base,log:()=>log};}catch{} await new Promise(r=>setTimeout(r,100)); }
 child.kill();throw new Error(log);
}
export async function stopServer(child) {if(child.exitCode!==null)return; await new Promise(r=>{child.once('exit',r);child.kill('SIGTERM');});}
export async function request(base,path,method='GET',data) {const res=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const text=await res.text();let body;try{body=JSON.parse(text)}catch{body=text}return {status:res.status,body};}
