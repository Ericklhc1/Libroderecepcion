'use client';
import { useState, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function IntentDialog({title,choices,advanced}: {
  title:string; choices:Array<{id:string;label:string;hint:string;form:ReactNode}>;advanced?:ReactNode;
}) {
  const [selected,setSelected]=useState<string|null>(null);
  const [open,setOpen]=useState(false);
  const choice=choices.find(item=>item.id===selected);
  return <Dialog title={choice?.label ?? title} trigger="Registrar / actuar" triggerVariant="gold" triggerSize="sm" open={open} onOpenChange={value=>{setOpen(value);if(!value)setSelected(null);}}>
    {choice ? <><Button variant="ghost" size="sm" onClick={()=>setSelected(null)}>Volver a intenciones</Button><p className="my-3 text-sm text-slate-600">{choice.hint}</p>{choice.form}</> : <div className="space-y-3">
      <p className="text-sm text-slate-600">¿Qué necesitas lograr?</p>
      {choices.map(item=><button type="button" key={item.id} data-ux-label={item.label} onClick={()=>setSelected(item.id)} className="block w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500"><span className="block font-semibold text-petrol-900">{item.label}</span><span className="mt-1 block text-sm text-slate-600">{item.hint}</span></button>)}
      {advanced && <details><summary className="cursor-pointer py-2 text-sm font-medium">Registro avanzado</summary><div className="mt-3">{advanced}</div></details>}
    </div>}
  </Dialog>;
}
