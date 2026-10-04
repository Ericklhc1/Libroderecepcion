'use client';
import {useState} from 'react';

export function FrontiExecutionControls({executionId,canAuthorize,canCancel}:{executionId:string;canAuthorize:boolean;canCancel:boolean}){
  const [pending,setPending]=useState(false);const [message,setMessage]=useState('');
  const act=async(authorize:boolean)=>{
    setPending(true);setMessage('');
    try{
      const response=await fetch('/api/fronti',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(authorize?{confirmationToken:`fronti-plan:${executionId}`}:{cancelExecutionId:executionId})});
      const data=await response.json();setMessage(typeof data.reply==='string'?data.reply:typeof data.error==='string'?data.error:'No se confirmó el resultado. Consulta el asunto antes de reintentar.');
      if(response.ok&&typeof data.reply==='string')window.location.assign(`/fronti/procedimientos?ejecucion=${encodeURIComponent(executionId)}`);
    }catch{setMessage('No se confirmó el resultado. Consulta el asunto antes de reintentar.');}
    finally{setPending(false);}
  };
  return <div className="space-y-2"><div className="flex flex-wrap gap-2">{canAuthorize&&<button type="button" disabled={pending} onClick={()=>void act(true)} className="rounded-md bg-petrol-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{pending?'Procesando…':'Autorizar solicitud'}</button>}{canCancel&&<button type="button" disabled={pending} onClick={()=>void act(false)} className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60">Cancelar pendientes</button>}</div>{message&&<p role="status" className="whitespace-pre-wrap text-sm">{message}</p>}</div>;
}
