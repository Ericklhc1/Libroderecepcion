import { Fragment, type ReactNode } from 'react';

/** Plain text stays text. Only recognized internal read pages become same-origin links. */
export function FrontiSourceLinks({ text }: { text: string }) {
  const pattern = /\/(?:fronti\/procedimientos|coordinacion(?:\/(?:automatizaciones|indicadores))?|tareas\/[a-zA-Z0-9_-]+|libro\/[a-zA-Z0-9_-]+|admin\/housekeeping|seguimientos)(?:\?[a-zA-Z0-9_%=&.-]+)?/g;
  const output: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    // Never reinterpret a suffix of an external URL or an unrecognized path.
    if ((start > 0 && !/[\s(\[]/.test(text[start - 1]!)) || (end < text.length && /[a-zA-Z0-9_/\\?#%-]/.test(text[end]!))) continue;
    output.push(text.slice(offset, start));
    output.push(<a key={start} href={match[0]} className="break-all font-medium underline underline-offset-2">{match[0]}</a>);
    offset = end;
  }
  output.push(text.slice(offset));
  return <>{output.map((node,index)=><Fragment key={index}>{node}</Fragment>)}</>;
}
