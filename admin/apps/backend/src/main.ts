import 'reflect-metadata';
import 'dotenv/config';
import { Module, Catch, HttpException, type ExceptionFilter, type ArgumentsHost } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CroutonApiModule, DataSourceRegistry, ResourceConfigRegistry } from '@ghentcdh/crouton-api';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { BulkController } from './app/bulk/bulk.controller.js';
import { setPrismaClient } from './app/bulk/bulk.service.js';
import express from 'express';
import { Prisma } from '@prisma/client';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { root, databasePath } from './paths.js';

process.chdir(root);
if (!existsSync(databasePath)) throw new Error(`Database does not exist: ${databasePath}`);
const backupDir=resolve(root,process.env.BACKUP_DIR || 'backups');
mkdirSync(backupDir,{recursive:true});
const backup=resolve(backupDir,`bantulex-${Date.now()}.db`);
execFileSync('python3',['-c', 'import sqlite3,sys; s=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',databasePath,backup]);

@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
class DatabaseErrors implements ExceptionFilter {
  catch(error:unknown,host:ArgumentsHost) {
    const e=error as {code?:string;message?:string};
    const response=host.switchToHttp().getResponse();
    if(error instanceof HttpException) return response.status(error.getStatus()).json(error.getResponse());
    if(error instanceof Prisma.PrismaClientValidationError) return response.status(400).json({statusCode:400,message:'Invalid field value or query. Check the entered values.'});
    const mapped:Record<string,[number,string]>={P2002:[409,'A record with these unique values already exists.'],P2003:[409,'This change conflicts with a related record. Check the references or remove dependent links first.'],P2025:[404,'This record no longer exists.'],P2011:[400,'A required field is missing.']};
    const match=mapped[e.code || ''];
    if(match) return response.status(match[0]).json({statusCode:match[0],message:match[1]});
    console.error(error);
    return response.status(500).json({statusCode:500,message:'The database operation failed. Your changes were not saved.'});
  }
}
const here=dirname(fileURLToPath(import.meta.url));
@Module({imports:[await CroutonApiModule.forResourceDir(resolve(here,'app/resources'),resolve(here,'app/data-sources'),{baseUrl:'',prefix:'api'})],controllers:[BulkController]})
class AppModule {}
const app=await NestFactory.create<NestExpressApplication>(AppModule,{logger:['error','warn','log']});
// Bulk imports post thousands of rows; the default JSON limit is 100 kB.
app.useBodyParser('json',{limit:'25mb'});
// The bulk API uses the same PrismaClient (and SQLite connection) as Crouton.
setPrismaClient(app.get(DataSourceRegistry,{strict:false}).resolveClient('default'));
app.useGlobalFilters(new DatabaseErrors());
app.enableShutdownHooks();
const configs=await app.get(ResourceConfigRegistry).getAll();
if(configs.length!==23) throw new Error(`Expected 23 resources, loaded ${configs.length}. Inspect resource errors.`);
const frontend=resolve(root,'dist/frontend');
// The UI is built with base /admin/ (vite.config.ts); the API stays at /api.
const uiBase='/admin';
if(existsSync(frontend)) {
  app.use((req:express.Request,res:express.Response,next:express.NextFunction)=>{
    if(req.method==='GET' && (req.path==='/' || req.path===uiBase)) res.redirect(`${uiBase}/`);
    else next();
  });
  app.use(uiBase,express.static(frontend,{redirect:false}));
  app.use(uiBase,(req:express.Request,res:express.Response,next:express.NextFunction)=>{
    if(req.method==='GET' && req.accepts('html')) res.sendFile(resolve(frontend,'index.html'));
    else next();
  });
}
const host=process.env.HOST || '127.0.0.1';
await app.listen(Number(process.env.PORT || 4444),host);
console.log(`BantuLex: http://${host}:${process.env.PORT || 4444}${uiBase}/ — ${configs.length} resources — ${databasePath}`);
