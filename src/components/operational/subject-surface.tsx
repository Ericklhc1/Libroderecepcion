import type { ReactNode } from 'react';

/** Fachada de lectura; los servicios, estados y permisos de cada fuente siguen vigentes. */
export function SubjectContext({folio, origin, nextAction, impediment, result,resultLabel='Resultado'}: {
  folio: string; origin: string; nextAction: string; impediment?: string | null; result?: string | null;resultLabel?:string;
}) {
  return <section aria-label="Continuidad del asunto" className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
    <p className="font-semibold text-petrol-900">{folio}</p>
    <p className="mt-1 text-slate-600">Origen: {origin}</p>
    <p className="mt-2"><span className="font-semibold">Siguiente acción: </span>{nextAction}</p>
    {impediment && <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-amber-900"><span className="font-semibold">Impedimento: </span>{impediment}</p>}
    {result && <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]"><span className="font-semibold">{resultLabel}: </span>{result}</p>}
  </section>;
}

/** Acciones nativas visibles en escritorio; el mismo conjunto se pliega en móvil. */
export function SubjectActions({primary, secondary, more}: {primary: ReactNode; secondary?: ReactNode; more?: ReactNode}) {
  return <div aria-label="Acciones del asunto" className="subject-actions flex flex-wrap items-center gap-2 no-print">
    {primary}{secondary}
    {more && <details className="responsive-disclosure">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-petrol-800">Más ···</summary>
      <div className="responsive-disclosure-content flex-wrap items-center gap-2">{more}</div>
    </details>}
  </div>;
}
