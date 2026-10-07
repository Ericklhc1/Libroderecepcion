import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright-core';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { HandoverPrint } from '@/components/operational/handover-print';
import { handoverPrintRows, handoverPrintCounts, closurePrintValidation } from '@/domain/handover-print';
import { handover02Fixture, confirmedHandover02Fixture } from './fixtures/handover-02-10';

const css = readFileSync('src/app/globals.css', 'utf8');
describe('impresión de entrega 02-10-2026', () => {
  it('cuenta solo lo impreso y agrupa repetidos sin perder detalle ni cantidades', () => {
    const f = handover02Fixture();
    const rows = handoverPrintRows([...f.items, f.items[0]!]);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ priority: 'URG', ref: '1431', count: 2 });
    expect(handoverPrintCounts(rows)).toEqual({ urgente: 5, importante: 4, informativo: 4 });
    expect(rows.find(r => r.ref === '1424')?.due).toBe('05-10-26 11:00');
  });

  it('imprime la custodia fotografiada aunque las garantías actuales cambien', () => {
    const fixture=handover02Fixture(); fixture.cash.cashGuarantees=[];
    const html=renderToStaticMarkup(<HandoverPrint {...fixture} />);
    expect(html).toContain('7542392'); expect(html).toContain('7541967'); expect(html).toContain('Garantía hab 628');
  });

  it('una reimpresión sin fotografía no sustituye garantías históricas por actuales',()=>{
    const fixture=handover02Fixture();fixture.cash.declared!.guaranteeSnapshotRecorded=false;
    const html=renderToStaticMarkup(<HandoverPrint {...fixture} />);
    expect(html).toContain('Fotografía histórica de garantías no disponible');
    expect(html).not.toContain('7542392');expect(html).not.toContain('7541967');
  });
  it('observar un cierre histórico elimina la firma heredada de validación',()=>{
    const legacy={name:'Firma antigua'};const current={name:'Firma nueva'};
    expect(closurePrintValidation('OBSERVADA',current,legacy)).toBeNull();
    expect(closurePrintValidation('VALIDADA',current,legacy)).toEqual(current);
    expect(closurePrintValidation(null,current,legacy)).toEqual(legacy);
  });

  for (const confirmed of [false, true]) it(`PDF real ${confirmed ? 'recibido' : 'enviado'}: A4 horizontal, ≤2 páginas, todos los registros y firmas`, async () => {
    const fixture = confirmed ? confirmedHandover02Fixture() : handover02Fixture();
    const browser = await chromium.launch({ headless: true, ...(existsSync('/usr/bin/chromium') ? {executablePath:'/usr/bin/chromium'} : {}), args:['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div style="min-height:100vh"><header class="no-print">MENÚ_NO_IMPRIMIR</header><main id="contenido-principal" style="padding:20px 16px 80px">${renderToStaticMarkup(<HandoverPrint {...fixture} />)}<div class="handover-screen">PANTALLA_NO_IMPRIMIR</div></main><div>AROH_PIE_GLOBAL_NO_IMPRIMIR</div></div><aside>FRONTI_NO_IMPRIMIR</aside></body></html>`);
      await page.emulateMedia({ media: 'print' });
      const signature = await page.locator('.handover-print-signatures section').first().boundingBox();
      expect(signature!.height).toBeGreaterThanOrEqual(24 * 96 / 25.4 - 1);
      expect(await page.locator('.handover-print').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Arial');
      expect(await page.locator('.handover-print').evaluate(el => getComputedStyle(el).fontSize)).toBe('10.6667px');
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const doc = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
      expect(doc.numPages).toBeGreaterThan(0); expect(doc.numPages).toBeLessThanOrEqual(2);
      const texts = [];
      for (let i=1;i<=doc.numPages;i++) {
        const p = await doc.getPage(i); const [left,bottom,right,top] = p.view;
        expect(right!-left!).toBeCloseTo(841.89, 0); expect(top!-bottom!).toBeCloseTo(595.28, 0);
        const text = (await p.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ');
        expect(text).toContain('Imprimir a doble cara'); expect(text).toContain(`Página ${i}/${doc.numPages}`);
        texts.push(text);
      }
      const text = texts.join(' ');
      for (const ref of ['1431','1424','1314','1435','1432','1429','1426','1402','1393','1389','1227','7542392','7541967']) expect(text).toContain(ref);
      expect(text).toContain('falta USD 25'); expect(text).toContain('Firma:'); expect(text).toContain('Supervisión');
      for (const hidden of ['MENÚ_NO_IMPRIMIR','PANTALLA_NO_IMPRIMIR','AROH_PIE_GLOBAL_NO_IMPRIMIR','FRONTI_NO_IMPRIMIR']) expect(text).not.toContain(hidden);
      expect(text).not.toContain('TAREA_NO_IMPRIMIR'); expect(text).not.toContain('Validar cierre de turno');
      if(confirmed) expect(text).toContain('− entrega: USD -25');
      mkdirSync('work', {recursive:true}); writeFileSync(`work/handover-02-10-${confirmed ? 'recibida' : 'enviada'}.pdf`, pdf);
      await doc.destroy();
    } finally { await browser.close(); }
  });
});
