import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSameOriginMutation } from '@/server/security/same-origin';
import { coordinateWorkFormAction, changeTaskStatusFormAction } from '@/server/actions/operational-navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const fields = z.record(z.string().max(6000)).refine(v => Object.keys(v).length <= 10);
const allowed = {
  coordination: ['kind','id','updatedAt','requestKey','action','ownerId','nextAction','returnTo'],
  'task-status': ['id','status','blockedReason','reason','evidenceProvided','returnTo'],
} as const;

/** JSON transport only: authorization, validation and writes remain in the native actions. */
export async function POST(request: Request, context: { params: Promise<{ procedure: string }> }) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!isSameOriginMutation(request) || request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ ok:false,error:'Origen no autorizado.' }, { status:403,headers });
  const { procedure } = await context.params;
  if (procedure !== 'coordination' && procedure !== 'task-status') return NextResponse.json({ ok:false,error:'Procedimiento no disponible.' }, { status:404,headers });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ ok:false,error:'Formato no válido.' }, { status:415,headers });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Empty body');
    const chunks:Uint8Array[]=[];let bytes=0;
    while (true) { const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>32768){await reader.cancel();return NextResponse.json({ok:false,error:'Formulario demasiado grande.'},{status:413,headers});}chunks.push(part.value); }
    const input=fields.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (Object.keys(input).some(key=>!(allowed[procedure] as readonly string[]).includes(key))) return NextResponse.json({ok:false,error:'Campos no admitidos.'},{status:400,headers});
    const form=new FormData();for(const [key,value] of Object.entries(input))form.set(key,value);
    const action=procedure==='coordination'?coordinateWorkFormAction:changeTaskStatusFormAction;
    const result=await action(null,form);
    return NextResponse.json(result,{status:result.ok?200:400,headers});
  } catch {
    return NextResponse.json({ok:false,error:'No se pudo confirmar el resultado. Revisa el registro antes de volver a enviar.'},{status:400,headers});
  }
}
