import './guard.cjs';
import {writeFileSync} from 'node:fs';
import {PrismaClient} from '@prisma/client';
import {SignJWT} from 'jose';
import {resetOperationalData,seedCatalog,prisma as testDb} from '../../tests/helpers';
import {TUTORIAL_MODULE_KEYS} from '../../src/domain/tutorial-tour';
import {TERMS_DOCUMENT,TERMS_VERSION} from '../../src/domain/legal';
if((process.env.AUTH_SECRET??'').length<32)throw new Error('Synthetic authentication key must satisfy the real session contract');
const db=new PrismaClient();
await resetOperationalData();
await seedCatalog();
await testDb.$disconnect();
const area=await db.department.findUniqueOrThrow({where:{key:'RECEPCION'}});
const users:Record<string,{id:string;token:string}>={};
for(const [key,roleKey] of Object.entries({admin:'ADMINISTRADOR_SISTEMA',worker:'SUPERVISOR',maid:'MUCAMA'})){
 const role=await db.role.findUniqueOrThrow({where:{key:roleKey}});
 const user=await db.user.create({data:{name:`Etapa1 ${key}`,username:`etapa1_${key}`,passwordHash:'synthetic-no-login',roleId:role.id,departmentId:area.id,mustChangePassword:false,tutorialDoneAt:new Date(),tutorialKnownModules:[...TUTORIAL_MODULE_KEYS]}});
 await db.legalAcceptance.create({data:{userId:user.id,document:TERMS_DOCUMENT,version:TERMS_VERSION}});
 const expiresAt=new Date(Date.now()+3600000);const session=await db.session.create({data:{userId:user.id,expiresAt}});
 const token=await new SignJWT({sub:user.id,sid:session.id}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime()/1000)).sign(new TextEncoder().encode(process.env.AUTH_SECRET));users[key]={id:user.id,token};
}
const tasks=[];
for(const width of [1280,390])tasks.push(await db.task.create({data:{title:`ETAPA1_UI_${width}`,description:'Trabajo sintético para recorrido autenticado',createdById:users.admin.id,departmentId:area.id}}));
const privateSource=await db.followUp.create({data:{action:'ETAPA1_PRIVATE',createdById:users.admin.id,ownerId:users.worker.id,visibility:'PRIVADO'}});
await db.task.create({data:{title:'ETAPA1_PRIVATE_TASK',createdById:users.admin.id,assigneeId:users.worker.id,followUpId:privateSource.id}});
writeFileSync('/tmp/etapa1-fixture.json',JSON.stringify({users,tasks:tasks.map(t=>({id:t.id,title:t.title})),areaId:area.id}));
await db.$disconnect();
console.log('Synthetic sessions and work prepared; no credentials printed.');
