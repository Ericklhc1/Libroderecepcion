import { NextResponse } from 'next/server';
import { z } from 'zod';
import { saveAutomationAction, simulateAutomationAction, setAutomationStateAction } from '@/server/actions/operational-automation';
import { isSameOriginMutation } from '@/server/security/same-origin';
import { coordinateWorkFormAction, changeTaskStatusFormAction } from '@/server/actions/operational-navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const fields = z.record(z.union([z.string().max(6000), z.array(z.string().max(1)).max(7)])).refine(v => Object.keys(v).length <= 25);
const allowed = {
  coordination: ['kind','id','updatedAt','requestKey','action','ownerId','nextAction','returnTo'],
  'task-status': ['id','status','blockedReason','reason','evidenceProvided','returnTo'],
  'automation-save': ['id','version','kind','name','departmentId','expiresAt','description','ownerId','priority','nextAction','evidenceRequired','checklist','startDate','localTime','weekdays','deadlineHours','catchUpDays','trigger','workKind','receiptMinutes','recipientId'],
  'automation-simulate': ['id'],
  'automation-state': ['id','version','state'],
} as const;

/** JSON transport only: authorization, validation and writes remain in the native actions. */
export async function POST(request: Request, context: { params: Promise<{ procedure: string }> }) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!isSameOriginMutation(request) || request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ ok:false,error:'Origen no autorizado.' }, { status:403,headers });
  const { procedure } = await context.params;
  if (!Object.prototype.hasOwnProperty.call(allowed, procedure)) return NextResponse.json({ ok:false,error:'Procedimiento no disponible.' }, { status:404,headers });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ ok:false,error:'Formato no válido.' }, { status:415,headers });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Empty body');
    const chunks:Uint8Array[]=[];let bytes=0;
    while (true) { const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>32768){await reader.cancel();return NextResponse.json({ok:false,error:'Formulario demasiado grande.'},{status:413,headers});}chunks.push(part.value); }
    const input=fields.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (Object.keys(input).some(key=>!(allowed[procedure as keyof typeof allowed] as readonly string[]).includes(key))) return NextResponse.json({ok:false,error:'Campos no admitidos.'},{status:400,headers});
    if (Object.entries(input).some(([key,value])=>Array.isArray(value)&&(procedure!=='automation-save'||key!=='weekdays'))) return NextResponse.json({ok:false,error:'Lista no admitida.'},{status:400,headers});
    const form=new FormData();for(const [key,value] of Object.entries(input)){for(const item of Array.isArray(value)?value:[value])form.append(key,item);}
    const actions={coordination:coordinateWorkFormAction,'task-status':changeTaskStatusFormAction,'automation-save':saveAutomationAction,'automation-simulate':simulateAutomationAction,'automation-state':setAutomationStateAction};
    const result=await actions[procedure as keyof typeof actions](null,form);
    if (result.ok && (procedure==='automation-save'||procedure==='automation-state')) return NextResponse.json({...result,navigateTo:'/coordinacion/automatizaciones'},{headers});
    return NextResponse.json(result,{status:result.ok?200:400,headers});
  } catch {
    return NextResponse.json({ok:false,error:'No se pudo confirmar el resultado. Revisa el registro antes de volver a enviar.'},{status:400,headers});
  }
}
