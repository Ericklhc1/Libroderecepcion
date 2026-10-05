import { withMaintenance } from '@/server/api/maintenance';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/current-user';
import { persistOperationalEvent } from '@/server/observability/operational';
import { uxEventSchema } from '@/domain/ux-telemetry-schema';
import packageJson from '../../../../package.json';

async function POSTHandler(request:Request) {
  if(request.headers.get('origin')!==new URL(request.url).origin)return new NextResponse(null,{status:403});
  const user=await getCurrentUser();
  if(!user || user.mustChangePassword)return new NextResponse(null,{status:401});
  if(!request.headers.get('content-type')?.startsWith('application/json'))return new NextResponse(null,{status:415});
  const reader=request.body?.getReader();if(!reader)return new NextResponse(null,{status:400});
  const chunks:Uint8Array[]=[];let bytes=0;
  while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2048){await reader.cancel();return new NextResponse(null,{status:413});}chunks.push(part.value);}
  const body=Buffer.concat(chunks).toString('utf8');
  let parsed:unknown;
  try{parsed=JSON.parse(body);}catch{return new NextResponse(null,{status:400});}
  const input=uxEventSchema.safeParse(parsed);
  if(!input.success)return new NextResponse(null,{status:400});
  const value=input.data;
  const ok=await persistOperationalEvent({eventType:`UX_${value.event}`,userId:user.id,entityType:value.entityType,entityId:value.entityId,correlationId:value.intentId,durationMs:value.duration,status:value.result==='FAILED'?'FAILED':value.result==='SUCCESS'?'SUCCESS':'STARTED',source:'CLIENT_UI',metadata:{route:value.route,role:user.roleKey,area:user.departmentId??'SIN_AREA',selectedAction:value.selectedAction,visibleActions:value.visibleActions,result:value.result,backNavigation:value.backNavigation,version:packageJson.version}});
  return new NextResponse(null,{status:ok?204:503});
}

export const POST = withMaintenance(POSTHandler);
