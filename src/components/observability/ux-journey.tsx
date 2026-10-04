'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { uxAction, uxRoute, type UxEvent } from '@/domain/ux-telemetry';

export function UxJourney() {
  const path=usePathname();
  useEffect(()=>{
    const route=uxRoute(path);if(!route)return;
    let intentId:string;
    try{intentId=sessionStorage.getItem('aroh-ux-journey')??crypto.randomUUID();sessionStorage.setItem('aroh-ux-journey',intentId);}catch{intentId=crypto.randomUUID();}
    const entered=performance.now();let action:UxEvent['selectedAction'];let actionAt=entered;let resolved=false;let back=false;let pendingForm:string|null=null;let exited=false;
    const send=(event:UxEvent['event'],extra:Partial<UxEvent>={})=>{void fetch('/api/ux-events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({intentId,event,...route,...extra}),keepalive:true}).catch(()=>undefined);};
    const actions=Array.from(document.querySelectorAll('[aria-label="Acciones del asunto"] button,[aria-label="Acciones del asunto"] a,[aria-label="Acciones del asunto"] summary')).filter(el=>(el as HTMLElement).getClientRects().length>0).map(el=>uxAction(el.textContent??'')!).filter(a=>a!=='OTHER');
    send('ROUTE',{visibleActions:[...new Set(actions)].slice(0,16)});
    const click=(event:MouseEvent)=>{
      if(!(event.target instanceof Element))return;
      const el=event.target.closest('button,a,summary');if(!el)return;
      const selected=uxAction(el.getAttribute('data-ux-label')??el.textContent??'');if(selected==='OTHER')return;
      // Un nuevo procedimiento de creación inicia una correlación explícita.
      if(['INFORM','REQUEST_ATTENTION','REMIND'].includes(selected!)){intentId=crypto.randomUUID();try{sessionStorage.setItem('aroh-ux-journey',intentId);}catch{/* Sin almacenamiento, correlación sólo de esta pantalla. */}}
      action=selected;actionAt=performance.now();resolved=false;pendingForm=null;send('ACTION',{selectedAction:action});
    };
    const submit=(event:Event)=>{if(action&&!resolved&&event.target instanceof HTMLFormElement)pendingForm=event.target.id;};
    const result=(event:Event)=>{const detail=(event as CustomEvent<{ok:boolean;formId:string}>).detail;if(!action||!pendingForm||detail?.formId!==pendingForm)return;const ok=detail.ok;if(typeof ok!=='boolean')return;resolved=ok;send('RESULT',{selectedAction:action,result:ok?'SUCCESS':'FAILED',duration:Math.min(3600000,Math.round(performance.now()-actionAt))});};
    const pop=()=>{back=true;};
    const leave=()=>{if(exited)return;exited=true;send('EXIT',{selectedAction:action,result:action&&!resolved?'PENDING':'LEFT',duration:Math.min(3600000,Math.round(performance.now()-entered)),backNavigation:back});};
    document.addEventListener('click',click);document.addEventListener('submit',submit);window.addEventListener('aroh:action-result',result);window.addEventListener('popstate',pop);window.addEventListener('pagehide',leave);
    return ()=>{document.removeEventListener('click',click);document.removeEventListener('submit',submit);window.removeEventListener('aroh:action-result',result);window.removeEventListener('popstate',pop);window.removeEventListener('pagehide',leave);leave();};
  },[path]);
  return null;
}
