import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {prisma} from '@/lib/prisma';
import type {CurrentUser} from '@/server/auth/current-user';
import type {FrontiResolvedPageContext} from './page-context';
import {buildFrontiToolIntent,type FrontiIntentMessage} from './action-intent';
import {coordinationEntries} from '@/server/services/coordination-access';
import {getTask} from '@/server/services/tasks';
import {getSubjectEntry} from '@/server/services/entries';
import {getSubjectAttentionAreas} from '@/server/services/subject-attention';
import {assertReceptionOperationPermission} from '@/server/services/reception-operation-gate';
import {prepareExecution,executionCard} from '@/server/ai/execution/service';

const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/^fronti[\s,:]+/,'');
const attention=/\b(?:manda(?:lo|la)?|envia(?:lo|la)?|deriva(?:lo|la)?|solicita atencion|pide atencion)\b/;

/** A contextual entry to the existing finite procedure, never an independent executor. */
export async function prepareSubjectIntent(user:CurrentUser,messages:readonly FrontiIntentMessage[],page:FrontiResolvedPageContext|null,requestKey?:string){
  const latest=messages.filter(m=>m.role==='user').at(-1)?.content??'';
  if(/^(?:no\b|cancela|olvida|deten|mejor no)/.test(normalize(latest)))return null;
  const lastUserIndex=messages.map(m=>m.role).lastIndexOf('user');
  const preceding=messages[lastUserIndex-1];
  const pendingQuestion=preceding?.role==='assistant' ? preceding.content : '';
  if(!attention.test(normalize(latest))&&!/^¿(?:En qué ubicación necesita atención|Qué área debe atender) el asunto #\d+\?/.test(pendingQuestion))return null;
  const intent=buildFrontiToolIntent(messages);
  if(!attention.test(normalize(intent)))return null;
  // Specialized HK work keeps its native impediment/maintenance procedure.
  if(page?.sectionKey==='housekeeping'&&!/\b(?:asunto|novedad|incidencia)\s+#?\d+\b/.test(normalize(intent)))return null;
  const areas=await getSubjectAttentionAreas(user);
  if(!areas.length)return {reply:'No tienes permiso para solicitar atención desde este asunto.',confirmations:[]};
  const folio=normalize(intent).match(/\b(?:asunto|novedad|incidencia)\s+#?(\d+)\b/);
  const number=folio?Number(folio[1]):null;
  let entryId:string|null=null;
  if(number!==null){
    if(!Number.isSafeInteger(number)||number>2147483647)return {reply:'Indica el folio del asunto que necesitas derivar.',confirmations:[]};
    entryId=(await prisma.operationalEntry.findFirst({where:{humanId:number,AND:[coordinationEntries(user)]},select:{id:true}}))?.id??null;
  }else if(page?.entityType==='OperationalEntry')entryId=page.entityId;
  else if(page?.entityType==='Task'&&page.entityId)entryId=(await getTask(page.entityId,user).catch(()=>null))?.entryId??null;
  if(!entryId||!await prisma.operationalEntry.count({where:{id:entryId,AND:[coordinationEntries(user)]}}))return {reply:'Abre el asunto que necesitas derivar o indica su folio. Conservaré su contexto y el resultado volverá al mismo asunto.',confirmations:[]};
  const entry=await getSubjectEntry(user,entryId);
  if(['RESUELTO','CERRADO'].includes(entry.status))return {reply:`El asunto #${entry.humanId} está resuelto. Revisa su resultado; para una nueva atención debe reabrirse con el permiso correspondiente.`,confirmations:[]};
  const previous=pendingQuestion===`¿En qué ubicación necesita atención el asunto #${entry.humanId}?`?pendingQuestion:'';
  const answeringLocation=/ubicación necesita atención/.test(previous)&&!attention.test(normalize(latest));
  const areaText=answeringLocation?normalize(buildFrontiToolIntent(messages.slice(0,-1))):normalize(intent);
  const exactReply=normalize(latest).replace(/^(?:al?\s+)?(?:area\s+de\s+)?/,'').replace(/[.!]$/,'');
  const explicitReply=!answeringLocation?areas.find(a=>normalize(a.label)===exactReply||exactReply==='hk'&&normalize(a.label).includes('housekeeping')):undefined;
  const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const directed=areas.filter(a=>new RegExp(`(?:^|\\s)(?:a|para)\\s+(?:(?:el\\s+)?area\\s+(?:de\\s+)?)?${escape(normalize(a.label))}(?:\\b|$)`).test(areaText)||normalize(a.label).includes('housekeeping')&&/\b(?:a|para) hk\b/.test(areaText));
  const mentioned=areas.filter(a=>areaText.includes(normalize(a.label)));
  const area=explicitReply??(directed.length===1?directed[0]:directed.length===0&&mentioned.length===1?mentioned[0]:undefined);
  if(!area)return {reply:`¿Qué área debe atender el asunto #${entry.humanId}? ${areas.map(a=>a.label).join(', ')}.`,confirmations:[]};
  await assertReceptionOperationPermission(user,area.needsLocation?'housekeeping.manage':'task.create');
  let location:string|undefined;
  if(area.needsLocation&&!entry.roomId){
    const explicit=latest.match(/ubicaci[oó]n\s*:\s*(.+)/i)?.[1]?.trim();
    location=explicit??(answeringLocation?latest.trim():undefined);
    if(!location)return {reply:`¿En qué ubicación necesita atención el asunto #${entry.humanId}?`,confirmations:[]};
    if(location.length>160)return {reply:'Indica una ubicación de hasta 160 caracteres.',confirmations:[]};
  }
  const intentRequestKey=requestKey??randomUUID();
  const hex=createHash('sha256').update(JSON.stringify({requestKey:intentRequestKey,actor:user.id,entry:entry.id,area:area.value,revision:entry.updatedAt.toISOString(),location:location??null})).digest('hex');
  const operationKey=`${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
  const execution=await prepareExecution({requestKey:intentRequestKey,instruction:intent.slice(-6000),steps:[{action:'requestSubjectAttentionAction',fields:{entryId:entry.id,departmentId:area.value,revision:entry.updatedAt.toISOString(),requestKey:operationKey,...(location?{location}:{})}}]});
  if(execution.status==='SUCCEEDED')return {reply:`La solicitud del asunto #${entry.humanId} ya está registrada. [Ver su avance y resultado](/libro/${encodeURIComponent(entry.id)}).`,confirmations:[]};
  return {reply:`Preparé la atención del asunto #${entry.humanId} por ${area.label}. Confirma la solicitud en la tarjeta; el contexto se conserva y el resultado vuelve a este asunto. Los avisos del procedimiento existente te informarán de sus cambios.`,confirmations:[await executionCard(execution.id)]};
}
