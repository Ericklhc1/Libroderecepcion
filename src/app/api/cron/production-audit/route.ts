import { NextResponse } from 'next/server';
import { runProductionAuditAndNotify } from '@/server/services/production-audit';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export async function GET(request: Request) {
  const ua=request.headers.get('user-agent') ?? '';
  if(!ua.startsWith('vercel-cron/')) return NextResponse.json({error:'No autorizado.'},{status:401});
  try {
    const result=await runProductionAuditAndNotify();
    return NextResponse.json(result,{status:result.ok?200:500,headers:{'Cache-Control':'no-store'}});
  } catch(error) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:'Error de auditoría.'},{status:500,headers:{'Cache-Control':'no-store'}});
  }
}
