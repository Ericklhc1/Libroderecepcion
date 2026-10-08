import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type * as React from 'react';
import {ActionForm} from '@/components/ui/form';
import {encodeFormDraft} from '@/domain/form-draft';

const lifecycle=vi.hoisted(()=>({effects:[] as Array<()=>void|(()=>void)>,select:vi.fn(),stateIndex:0,preparedKey:null as string|null}));
vi.mock('react',async original=>({...await original<typeof React>(),useEffect:(effect:()=>void|(()=>void))=>{lifecycle.effects.push(effect);},useState:(initial:unknown)=>[lifecycle.stateIndex++===1?lifecycle.preparedKey:initial,lifecycle.select],useRef:(initial:unknown)=>({current:initial}),useId:()=> 'current-react-id',useContext:()=>null,useCallback:(callback:unknown)=>callback,useActionState:()=>[null,vi.fn()]}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));

class Input {tagName='INPUT';type='text';checked=false;constructor(public name:string,public value:string){} }
class Select extends Input {override tagName='SELECT';multiple=false;options=[];}
const key='aroh:form-draft:v1:cash:actor:handover:declarar';
let storage:Map<string,string>;
let cleanups:Array<()=>void>;
const lookup=vi.fn();
beforeEach(()=>{
  vi.clearAllMocks();lifecycle.effects.length=0;lifecycle.stateIndex=0;lifecycle.preparedKey=null;cleanups=[];storage=new Map();const events=new EventTarget();
  vi.stubGlobal('HTMLInputElement',Input);vi.stubGlobal('HTMLSelectElement',Select);
  vi.stubGlobal('document',{getElementById:lookup});lookup.mockReturnValue(null);
  vi.stubGlobal('window',{addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)});
  vi.stubGlobal('sessionStorage',{getItem:(id:string)=>storage.get(id)??null,setItem:(id:string,value:string)=>storage.set(id,value),removeItem:(id:string)=>storage.delete(id)});
});
afterEach(()=>{cleanups.forEach(cleanup=>cleanup());vi.unstubAllGlobals();});

describe('borrador asociado al formulario montado',()=>{
  it('una preparación anterior no habilita un nuevo alcance o revisión antes de restaurarlo',()=>{
    lifecycle.preparedKey=JSON.stringify(['current-react-id',key,'notes','before']);const props={action:async()=>({ok:true as const,message:'Guardado'}),children:null,draftScope:'cash:actor:handover:declarar',draftFields:['notes'],draftRevision:'before'};const previous=ActionForm(props).props.children as React.ReactElement<{'data-action-form-ready'?:string}>;expect(previous.props['data-action-form-ready']).toBe('true');lifecycle.stateIndex=0;const changed=ActionForm({...props,draftScope:'cash:actor:another-handover:declarar',draftRevision:'after'}).props.children as React.ReactElement<{'data-action-form-ready'?:string}>;expect(changed.props['data-action-form-ready']).toBeUndefined();
  });
  for(const changed of [false,true])it(`restaura sin buscar el id global y conserva la revisión original: ${changed}`,()=>{
    const quantity=new Input('quantity','0'),notes=new Input('notes','Guardado');const physical=new Input('confirmed','on');physical.type='checkbox';
    const raw=encodeFormDraft(new Map([['quantity#0',{value:'5',checked:false,selected:null}],['notes#0',{value:'Texto pendiente',checked:false,selected:null}]]),['quantity','notes'],Date.now(),'before');storage.set(key,raw);
    const tree=ActionForm({action:async()=>({ok:true,message:'Guardado'}),children:null,draftScope:'cash:actor:handover:declarar',draftFields:['quantity','notes'],draftRevision:changed?'after':'before'});
    const form=tree.props.children as React.ReactElement<{ref:{current:unknown}}>;
    form.props.ref.current={elements:[quantity,notes,physical],reset:vi.fn()};
    for(const effect of lifecycle.effects){const cleanup=effect();if(cleanup)cleanups.push(cleanup);}
    expect(quantity.value).toBe('5');expect(notes.value).toBe('Texto pendiente');expect(physical.checked).toBe(false);expect(lifecycle.select).toHaveBeenCalledWith(changed?'stale':'restored');expect(storage.get(key)).toBe(raw);expect(lookup).not.toHaveBeenCalled();
  });
});
