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

/** Un siguiente paso visible, hasta dos alternativas y acceso avanzado sin overlays. */
export function SubjectActions({primary, secondary, more}: {primary: ReactNode; secondary?: ReactNode; more?: ReactNode}) {
  return <div aria-label="Acciones del asunto" className="border-t border-slate-200 px-4 py-3 no-print">
    <div className="flex flex-wrap items-center gap-2">{primary}{secondary}</div>
    {more && <details className="mt-2">
      <summary className="w-fit cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-petrol-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500">Más ···</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">{more}</div>
    </details>}
  </div>;
}
