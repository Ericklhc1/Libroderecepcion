import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { encodeFormDraft, decodeFormDraft, type DraftControl } from '@/domain/form-draft';
const value = (text: string): DraftControl => ({ value: text, checked: true, selected: null });

describe('F15 borrador local opt-in y conservación del registro', () => {
  it('recupera cantidades y notas sin conservar confirmaciones, claves ni campos internos', () => {
    const original = new Map([['d_clp#0', value('5')], ['notes#0', value('Revisar diferencia')], ['g_garantia#0', value('1')], ['password#0', value('no guardar')], ['$ACTION_ID#0', value('internal')]]);
    const fields = ['d_clp','notes'];
    const saved = encodeFormDraft(original, fields, 100);
    const recovered = decodeFormDraft(saved, fields, 101)!;
    expect([...recovered.keys()]).toEqual(['d_clp#0','notes#0']);
    expect(recovered.get('d_clp#0')?.value).toBe('5');
    expect(recovered.get('notes#0')?.value).toBe('Revisar diferencia');
    expect(recovered.get('d_clp#0')?.checked).toBe(false);
    expect(saved).not.toContain('password'); expect(saved).not.toContain('g_garantia');
  });
  it('descarta borradores vencidos, futuros, malformados y excesivos', () => {
    const encoded = encodeFormDraft(new Map([['notes#0',value('texto')]]), ['notes'], 100);
    expect(decodeFormDraft(encoded,['notes'], 100 + 12 * 60 * 60 * 1000 + 1)).toBeNull();
    expect(decodeFormDraft(encoded,['notes'], 99)).toBeNull();
    expect(decodeFormDraft('{',['notes'])).toBeNull();
    expect(decodeFormDraft('a'.repeat(32_001),['notes'])).toBeNull();
  });
  it('al cambiar el formulario no recupera campos ya no autorizados', () => {
    const encoded=encodeFormDraft(new Map([['notes#0',value('nota')]]),['notes'],100);
    expect(decodeFormDraft(encoded,['otra'],101)).toBeNull();
  });
  it('los dos formularios de relevo reciben los datos persistidos', () => {
    const cash=readFileSync('src/components/operational/cash-box.tsx','utf8');
    expect(cash).toContain("defaultValue={previousCount?.notes ?? ''}");
    expect(cash).toContain('previousCount.validatedGuarantees.some');
    expect(cash).toContain('latestMovementAt <= previousCount.countedAt');
    const page=readFileSync('src/app/(app)/turno/entrega/[id]/page.tsx','utf8');
    expect(page).toContain('actorId={user.id}');
    expect(page).toContain('observation={handover.items.find(item => item.manual)?.title');
    expect(page).toContain('nextAction={handover.items.find(item => item.manual)?.detail');
  });
});

import { clearFormDraftStorage, formDraftRevision } from '@/domain/form-draft';
describe('aislamiento y revisión de borradores', () => {
  function storageOf(entries: Array<[string,string]>) {
    const values=new Map(entries);
    return { values, get length(){return values.size;}, key(index:number){return [...values.keys()][index] ?? null;}, removeItem(key:string){values.delete(key);} };
  }
  it('logout elimina sólo borradores operativos y conserva preferencias ajenas',()=>{
    const store=storageOf([['aroh:form-draft:v1:cash:user1:handover1:declarar','draft'],['other-preference','keep']]);
    clearFormDraftStorage(store);
    expect([...store.values.keys()]).toEqual(['other-preference']);
  });
  it('cerrar entrega limpia únicamente sus borradores',()=>{
    const store=storageOf([['aroh:form-draft:v1:cash:u:h1:declarar','draft'],['aroh:form-draft:v1:handover-note:u:h1','note'],['aroh:form-draft:v1:cash:u:h2:declarar','keep']]);
    clearFormDraftStorage(store,'h1');
    expect([...store.values.keys()]).toEqual(['aroh:form-draft:v1:cash:u:h2:declarar']);
  });
  it('guarda revisión original para advertir cambios externos sin eliminar el texto',()=>{
    const raw=encodeFormDraft(new Map([['notes#0',value('pendiente')]]),['notes'],100,'v1');
    expect(formDraftRevision(raw)).toBe('v1');
    expect(decodeFormDraft(raw,['notes'],101)?.get('notes#0')?.value).toBe('pendiente');
    expect(formDraftRevision('malformado')).toBeNull();
  });
  it('todas las salidas limpian borradores y la sesión aísla usuarios',()=>{
    for(const file of ['src/components/layout/nav.tsx','src/components/layout/topbar-menus.tsx','src/app/(app)/perfil/page.tsx']) expect(readFileSync(file,'utf8')).toContain('data-clear-form-drafts action={logoutAction}');
    expect(readFileSync('src/components/operational/form-draft-session.tsx','utf8')).toContain("sessionStorage.getItem(key) !== userId");
    expect(readFileSync('src/components/ui/form.tsx','utf8')).toContain('El registro guardado cambió después de este borrador');
  });
});
