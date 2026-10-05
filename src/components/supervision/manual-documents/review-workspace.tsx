'use client';
import { useEffect, useRef, useState } from 'react';
import { appendLocalReview, documentDedupKey, evidenceLocation, LOCAL_DECISION_LABELS, localReviewExport, moneyTotals, parseDocumentDate, validateClaim } from '@/domain/manual-documents/review';
import { validateDocumentFile } from '@/domain/manual-documents/formats';
import { MANUAL_DOCUMENT_LIMITS as LIMITS, MANUAL_DOCUMENT_VERSION } from '@/domain/manual-documents/types';
import type { DocumentEvidence, DocumentScope, LocalReviewDecision, ManualDocumentDraft, ReviewClaim } from '@/domain/manual-documents/types';
import { readLocalDocument } from './local-reader';
import { LocalPdfPreview } from './pdf-preview';

type Editor = { claims: ReviewClaim[]; note: string; originalCompared: boolean; unresolvedQuestions: string };
type LocalFile = { file: File; draft: ManualDocumentDraft; editor: Editor; dirty: boolean };
const button = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-petrol-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const input = 'input-base w-full';

function downloadLocal(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ManualDocumentReview({ actor, scope }: { actor: { id: string; name: string }; scope: DocumentScope }) {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [activeKey, setActiveKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [sheet, setSheet] = useState('');
  const [search, setSearch] = useState('');
  const [evidencePage, setEvidencePage] = useState(0);
  const [transcription, setTranscription] = useState('');
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const active = files.find((item) => item.draft.key === activeKey);
  const editor = active?.editor;
  const dirtySession = files.length > 0;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!dirtySession) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtySession]);

  function select(key: string) {
    setActiveKey(key); setPage(1); setSheet(''); setSearch(''); setEvidencePage(0); setTranscription(''); setError('');
  }
  function updateEditor(change: Partial<Editor>) {
    setFiles((previous) => previous.map((item) => item.draft.key === activeKey ? { ...item, editor: { ...item.editor, ...change }, dirty: true } : item));
    setNotice(''); setError('');
  }
  function updateClaim(id: string, change: Partial<ReviewClaim>) {
    if (!editor) return;
    updateEditor({ claims: editor.claims.map((claim) => claim.id === id ? { ...claim, ...change } : claim), originalCompared: false });
  }
  async function openFile(file: File | undefined) {
    if (!file || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    const abort = new AbortController(); controller.current = abort;
    try {
      if (file.size > LIMITS.fileBytes) throw new Error('El archivo supera 4 MB. Divide el documento.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = validateDocumentFile(file.name, bytes);
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const sha256 = Array.from(hash, (n) => n.toString(16).padStart(2, '0')).join('');
      const key = documentDedupKey(scope, sha256);
      const duplicate = files.find((item) => item.draft.key === key);
      if (duplicate) {
        select(key); setNotice('Ese archivo ya está abierto. Se conserva su revisión e historial local.'); return;
      }
      if (files.length >= LIMITS.files || files.reduce((sum, item) => sum + item.file.size, 0) + file.size > LIMITS.sessionBytes) throw new Error('La sesión admite hasta 5 archivos y 16 MB en total. Exporta y cierra tus borradores antes de abrir más.');
      const extraction = await readLocalDocument(file.name, bytes, format, abort.signal);
      if (abort.signal.aborted || !mounted.current) return;
      const draft: ManualDocumentDraft = { ...extraction, key, sha256, name: file.name, size: file.size, format, parserVersion: MANUAL_DOCUMENT_VERSION, scope, history: [] };
      setFiles((previous) => [...previous, { file, draft, editor: { claims: [], note: '', originalCompared: false, unresolvedQuestions: '' }, dirty: true }]);
      select(key); setNotice('Archivo abierto sólo en este navegador. No se ha subido ni registrado en AROH.');
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'No se pudo abrir el documento.'); }
    finally { busyRef.current = false; controller.current = null; if (mounted.current) setBusy(false); }
  }

  function addClaim(evidence: DocumentEvidence) {
    if (!editor || editor.claims.some((claim) => claim.evidenceId === evidence.id)) return;
    if (editor.claims.length >= 100) { setError('La revisión admite hasta 100 datos seleccionados.'); return; }
    updateEditor({ claims: [...editor.claims, { id: crypto.randomUUID(), evidenceId: evidence.id, label: '', kind: 'text', value: evidence.text.slice(0, 2_000), currency: '', numberFormat: '', dateFormat: '', correctionReason: '', interpretation: '' }], originalCompared: false });
  }
  function addTranscription() {
    if (!active || active.draft.format !== 'pdf' || !transcription.trim()) return;
    if (active.draft.evidence.length >= LIMITS.cells || active.draft.evidence.reduce((sum, item) => sum + item.text.length, 0) + transcription.length > LIMITS.textCharacters) { setError('La transcripción supera los límites de la revisión.'); return; }
    const evidence: DocumentEvidence = { id: `manual:${crypto.randomUUID()}`, page, text: transcription.trim(), origin: 'manual-transcription', warning: 'Transcripción manual del revisor; no es texto extraído automáticamente.' };
    setFiles((previous) => previous.map((item) => item.draft.key === activeKey ? { ...item, draft: { ...item.draft, evidence: [...item.draft.evidence, evidence] }, dirty: true } : item));
    setTranscription(''); setNotice('Transcripción añadida con referencia a la página. Selecciónala para revisarla.');
  }
  function revise(decision: LocalReviewDecision): ManualDocumentDraft | null {
    if (!active || !editor) return null;
    try {
      const draft = appendLocalReview(active.draft, { ...editor, actor, decision });
      setFiles((previous) => previous.map((item) => item.draft.key === activeKey ? { ...item, draft, dirty: false } : item));
      setError(''); setNotice(`${LOCAL_DECISION_LABELS[decision]} conservado en el historial de esta sesión. No se ha registrado ni comunicado a nadie.`);
      return draft;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo preparar la revisión.'); return null; }
  }
  function exportReview() {
    if (!active) return;
    const draft = active.dirty || !active.draft.history.length ? revise('DRAFT') : active.draft;
    if (!draft) return;
    downloadLocal(new Blob([JSON.stringify(localReviewExport(draft), null, 2)], { type: 'application/json' }), `revision-local-${draft.sha256.slice(0, 12)}.json`);
    setNotice('Descarga de la revisión solicitada. Conserva también el archivo original. El JSON no acredita una aprobación registrada en AROH.');
  }
  const selectedSheet = sheet || active?.draft.sheets[0] || '';
  const filteredEvidence = active?.draft.evidence.filter((item) => (active.draft.format === 'pdf' ? item.page === page : item.sheet === selectedSheet) && (!search || item.text.toLocaleLowerCase('es-CL').includes(search.toLocaleLowerCase('es-CL')))) ?? [];
  const displayedEvidence = filteredEvidence.slice(evidencePage * 40, (evidencePage + 1) * 40);
  const totals = editor ? moneyTotals(editor.claims) : [];

  return <div className="space-y-4">
    <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" aria-label="Límites de esta preparación local">
      <p className="font-semibold">Borrador local: no compartido, no registrado en AROH</p>
      <p>El original y esta revisión permanecen en memoria de esta página. Al salir, recargar o cerrar se pierden los borradores. Descarga el historial y conserva el original antes de salir.</p>
      <p>Fronti documental, visión para escaneos, guardado compartido y almacenamiento remoto están pendientes de verificar capacidad y coste. Esta pantalla no los invoca. Preparar una aprobación o devolución no crea registros, movimientos de dinero, turnos ni mensajes.</p>
      <p>La auditoría diaria existente sigue en Supervisión y conserva su propio flujo. Abrir archivos aquí no la modifica.</p>
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <label className="block text-sm font-semibold text-petrol-900" htmlFor="local-document-file">Abrir documento en este navegador</label>
      <p id="local-document-limits" className="my-2 text-xs text-slate-600">PDF, XLSX sin macros, CSV o TSV. Máximo 4 MB, 40 páginas, 2.000 filas por hoja; 5 archivos/16 MB por sesión. Los enlaces, fórmulas e instrucciones del documento no se ejecutan.</p>
      <div className="flex flex-wrap items-center gap-3">
        <input id="local-document-file" type="file" accept=".pdf,.xlsx,.csv,.tsv" disabled={busy} aria-describedby="local-document-limits" className="max-w-full text-sm" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void openFile(file); }} />
        {busy && <><p role="status" className="text-sm">Leyendo el original local…</p><button type="button" className={button} onClick={() => controller.current?.abort()}>Cancelar lectura</button></>}
        {files.length > 0 && <button type="button" disabled={busy} className={button} onClick={() => { if (window.confirm('Se perderán todos los borradores e historiales de esta página. ¿Ya guardaste lo que necesitas y quieres cerrarlos?')) { setFiles([]); select(''); setNotice('Borradores locales cerrados. Los archivos originales de tu equipo no se han borrado.'); } }}>Cerrar borradores locales</button>}
      </div>
    </section>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">{notice}</p>}
    {files.length > 0 && <nav aria-label="Documentos locales abiertos" className="flex flex-wrap gap-2">{files.map((item) => <button type="button" className={`${button} max-w-full break-all ${item.draft.key === activeKey ? 'ring-2 ring-petrol-600' : ''}`} key={item.draft.key} aria-pressed={item.draft.key === activeKey} onClick={() => select(item.draft.key)}>{item.draft.name}{item.dirty ? ' · cambios locales' : ''}</button>)}</nav>}
    {active && editor && <>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Original y evidencia">
          <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-semibold text-petrol-900">Original local y evidencia</h2><button type="button" className={button} onClick={() => downloadLocal(active.file, active.file.name)}>Descargar original local</button></div>
          <p className="break-all text-sm">{active.draft.name} · {Math.ceil(active.draft.size / 1024)} KB</p>
          <details className="text-xs text-slate-600"><summary>Identidad del archivo y alcance</summary><p className="break-all pt-2">SHA-256: {active.draft.sha256}</p><p>Lector: {active.draft.parserVersion}. Sesión de {actor.name}; {scope.departmentId ? 'área de su cuenta' : 'cuenta sin área'}. La huella evita duplicados sólo dentro de esta sesión, usuario y alcance.</p></details>
          <ul className="list-disc space-y-1 pl-4 text-xs text-amber-800">{active.draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          {active.draft.format === 'pdf' ? <>
            <div className="flex items-center gap-2"><button type="button" className={button} disabled={page <= 1} onClick={() => { setPage(page - 1); setEvidencePage(0); }}>Anterior</button><label className="text-sm">Página <select aria-label="Página del original" className="input-base" value={page} onChange={(e) => { setPage(Number(e.target.value)); setEvidencePage(0); }}>{Array.from({ length: active.draft.pageCount ?? 1 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select> de {active.draft.pageCount}</label><button type="button" className={button} disabled={page >= (active.draft.pageCount ?? 1)} onClick={() => { setPage(page + 1); setEvidencePage(0); }}>Siguiente</button></div>
            <LocalPdfPreview key={`${activeKey}:${page}`} file={active.file} page={page} />
          </> : <label className="block text-sm">Hoja de valores leídos <select className={input} value={selectedSheet} onChange={(e) => { setSheet(e.target.value); setEvidencePage(0); }}>{active.draft.sheets.map((name) => <option key={name}>{name}</option>)}</select></label>}
          <h3 className="text-sm font-semibold">{active.draft.format === 'pdf' ? 'Texto y transcripciones de esta página' : 'Celdas del original, sin ejecutar fórmulas'}</h3>
          <label className="block text-sm">Buscar en esta página/hoja <input type="search" className={input} value={search} onChange={(e) => { setSearch(e.target.value); setEvidencePage(0); }} /></label>
          <p className="text-xs text-slate-500">{filteredEvidence.length} fragmentos/celdas. El texto fuente no acredita por sí solo que una operación se haya realizado.</p>
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">{displayedEvidence.map((item) => <li key={item.id} className="space-y-1 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium text-slate-600">{evidenceLocation(item)}{item.origin === 'manual-transcription' ? ' · escrita por el revisor' : ''}</p><button type="button" className={button} disabled={editor.claims.some((claim) => claim.evidenceId === item.id)} onClick={() => addClaim(item)}>{editor.claims.some((claim) => claim.evidenceId === item.id) ? 'Añadido' : 'Revisar dato'}</button></div><p className="whitespace-pre-wrap break-words text-sm">{item.text}</p>{item.warning && <p className="text-xs text-amber-800">{item.warning}</p>}</li>)}</ul>
          {!filteredEvidence.length && <p className="text-sm text-slate-600">No hay texto que coincida. El original sigue disponible.</p>}
          {filteredEvidence.length > 40 && <div className="flex items-center gap-3"><button type="button" className={button} disabled={evidencePage === 0} onClick={() => setEvidencePage(evidencePage - 1)}>Texto anterior</button><span className="text-xs">{evidencePage + 1} / {Math.ceil(filteredEvidence.length / 40)}</span><button type="button" className={button} disabled={(evidencePage + 1) * 40 >= filteredEvidence.length} onClick={() => setEvidencePage(evidencePage + 1)}>Más texto</button></div>}
          {active.draft.format === 'pdf' && <details className="rounded-lg bg-slate-50 p-3 text-sm"><summary>Transcribir un dato visible de la página {page}</summary><p className="my-2 text-xs text-slate-600">Para escaneos o texto omitido. Queda identificado como transcripción humana.</p><textarea aria-label="Transcripción manual del original" maxLength={2_000} className={input} value={transcription} onChange={(e) => setTranscription(e.target.value)} /><button type="button" className={`${button} mt-2`} disabled={!transcription.trim()} onClick={addTranscription}>Añadir transcripción con página</button></details>}
        </section>
        <section className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4" aria-label="Datos para revisión humana">
          <h2 className="font-semibold text-petrol-900">Datos para revisión humana</h2>
          <p className="text-sm text-slate-600">Selecciona datos del original. Corrige valores con motivo y mantén tus interpretaciones separadas de lo que dice el archivo.</p>
          {!editor.claims.length && <p className="rounded-lg bg-slate-50 p-3 text-sm">Pulsa «Revisar dato» junto a una evidencia. No se seleccionan ni confirman datos automáticamente.</p>}
          {editor.claims.map((claim, index) => {
            const evidence = active.draft.evidence.find((item) => item.id === claim.evidenceId);
            const errors = validateClaim(claim, active.draft.evidence);
            return <fieldset key={claim.id} className="space-y-2 rounded-lg border border-slate-300 p-3">
              <legend className="px-1 text-sm font-semibold">Dato {index + 1}</legend>
              <p className="whitespace-pre-wrap break-words text-xs text-slate-600">Fuente: {evidence?.text}</p>
              {evidence && <button type="button" className="text-xs text-petrol-700 underline" onClick={() => { if (evidence.page) setPage(evidence.page); if (evidence.sheet) setSheet(evidence.sheet); setSearch(''); setEvidencePage(0); }}>{evidenceLocation(evidence)}</button>}
              {evidence?.origin === 'manual-transcription' && <p className="text-xs text-amber-800">Fuente transcrita manualmente, pendiente de cotejo humano.</p>}
              <label className="block text-sm">Nombre del dato <input className={input} maxLength={200} value={claim.label} onChange={(e) => updateClaim(claim.id, { label: e.target.value })} /></label>
              <label className="block text-sm">Tipo <select aria-label="Tipo" className={input} value={claim.kind} onChange={(e) => updateClaim(claim.id, { kind: e.target.value as ReviewClaim['kind'] })}><option value="text">Texto literal</option><option value="money">Importe</option><option value="date">Fecha calendario</option></select></label>
              <label className="block text-sm">Valor a revisar <textarea aria-label="Valor a revisar" className={input} maxLength={2_000} rows={2} value={claim.value} onChange={(e) => updateClaim(claim.id, { value: e.target.value })} /></label>
              {claim.kind === 'money' && <div className="grid grid-cols-2 gap-2"><label className="text-sm">Moneda <select aria-label="Moneda" className={input} value={claim.currency} onChange={(e) => updateClaim(claim.id, { currency: e.target.value as ReviewClaim['currency'] })}><option value="">Elegir…</option><option>CLP</option><option>USD</option><option>EUR</option></select></label><label className="text-sm">Notación <select aria-label="Notación" className={input} value={claim.numberFormat} onChange={(e) => updateClaim(claim.id, { numberFormat: e.target.value as ReviewClaim['numberFormat'] })}><option value="">Elegir…</option><option value="es-CL">1.234,56</option><option value="en-US">1,234.56</option></select></label></div>}
              {claim.kind === 'date' && <label className="block text-sm">Formato de origen <select aria-label="Formato de origen" className={input} value={claim.dateFormat} onChange={(e) => updateClaim(claim.id, { dateFormat: e.target.value as ReviewClaim['dateFormat'] })}><option value="">Elegir…</option><option value="yyyy-mm-dd">AAAA-MM-DD</option><option value="dd/mm/yyyy">DD/MM/AAAA</option></select>{!errors.length && <span className="text-xs">Fecha normalizada: {parseDocumentDate(claim.value, claim.dateFormat)}; no representa una hora.</span>}</label>}
              <label className="block text-sm">Motivo de corrección o selección parcial <input aria-label="Motivo de corrección o selección parcial" className={input} maxLength={1_000} value={claim.correctionReason} onChange={(e) => updateClaim(claim.id, { correctionReason: e.target.value })} /></label>
              <label className="block text-sm">Interpretación del revisor (opcional, no es un hecho) <textarea aria-label="Interpretación del revisor" className={input} maxLength={2_000} rows={2} value={claim.interpretation} onChange={(e) => updateClaim(claim.id, { interpretation: e.target.value })} /></label>
              {!!errors.length && <ul className="list-disc pl-4 text-xs text-amber-800">{errors.map((message) => <li key={message}>{message}</li>)}</ul>}
              <button type="button" className="text-xs text-red-700 underline" onClick={() => updateEditor({ claims: editor.claims.filter((item) => item.id !== claim.id), originalCompared: false })}>Quitar del borrador actual</button>
            </fieldset>;
          })}
          {totals.length > 0 && <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold">Suma de importes seleccionados válidos</p>{totals.map((total) => <p key={total.currency}>{total.currency} {total.value}</p>)}<p className="mt-1 text-xs text-slate-600">Suma exacta, separada por moneda. No acredita conciliación: revisa signos y evita sumar totales con sus detalles. Los importes inválidos no se suman.</p></div>}
          <label className="block text-sm">Faltantes o dudas pendientes <textarea className={input} maxLength={4_000} rows={3} value={editor.unresolvedQuestions} onChange={(e) => updateEditor({ unresolvedQuestions: e.target.value })} /></label>
          <label className="block text-sm">Nota o motivo de devolución <textarea className={input} maxLength={4_000} rows={3} value={editor.note} onChange={(e) => updateEditor({ note: e.target.value })} /></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={editor.originalCompared} onChange={(e) => updateEditor({ originalCompared: e.target.checked })} />He comparado los datos seleccionados, signos, monedas y fechas con el original.</label>
          <p className="text-xs font-semibold text-amber-900">{active.dirty ? 'Hay cambios sin incorporar al historial local.' : LOCAL_DECISION_LABELS[active.draft.history.at(-1)?.decision ?? 'DRAFT']} No se registra una aprobación operativa.</p>
          <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => revise('DRAFT')}>Guardar versión local</button><button type="button" className={button} onClick={() => revise('PROPOSE_APPROVAL')}>Preparar aprobación local</button><button type="button" className={button} onClick={() => revise('PROPOSE_RETURN')}>Preparar devolución local</button><button type="button" className={button} onClick={exportReview}>Descargar revisión JSON</button></div>
        </section>
      </div>
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Historial de esta sesión">
        <h2 className="font-semibold text-petrol-900">Historial de esta sesión ({active.draft.history.length})</h2>
        <p className="text-xs text-slate-600">Las correcciones añaden versiones. Este historial es local, editable fuera de AROH al exportarse y no constituye una auditoría autenticada.</p>
        {active.draft.history.map((revision) => <details key={revision.revision} className="rounded-lg border border-slate-200 p-3 text-sm"><summary>Versión {revision.revision} · {LOCAL_DECISION_LABELS[revision.decision]} · {revision.actor.name} · {new Date(revision.at).toLocaleString('es-CL', { timeZone: 'America/Santiago' })} (Chile)</summary><p className="mt-2 whitespace-pre-wrap">Nota: {revision.note || 'Sin nota'}</p><p className="whitespace-pre-wrap">Dudas: {revision.unresolvedQuestions || 'Sin dudas consignadas'}</p><p>Cotejo del original: {revision.originalCompared ? 'declarado por el revisor' : 'pendiente'}</p><ul className="mt-2 list-disc space-y-1 pl-4">{revision.claims.map((claim) => <li key={claim.id} className="break-words">{claim.label || '(Sin nombre)'}: {claim.value} {claim.kind === 'money' ? claim.currency : ''}. Corrección: {claim.correctionReason || 'sin cambio indicado'}. Interpretación: {claim.interpretation || 'ninguna'}.</li>)}</ul></details>)}
      </section>
    </>}
  </div>;
}
