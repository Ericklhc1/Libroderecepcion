import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { FrontiSourceLinks } from '@/components/layout/fronti-source-links';

describe('Fuentes de Fronti navegables y texto no confiable',()=>{
  it('vincula historial y fuentes internas sin interpretar HTML',()=>{
    const html=renderToStaticMarkup(<FrontiSourceLinks text={'Resultado: /fronti/procedimientos?ejecucion=abc123\nFuente: /tareas/tarea1 <script>no ejecutar</script>'}/>);
    expect(html).toContain('href="/fronti/procedimientos?ejecucion=abc123"');expect(html).toContain('href="/tareas/tarea1"');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
  });
  it('no convierte rutas ajenas, API, protocolos ni sufijos de dominios en enlaces internos',()=>{
    const text='https://third.invalid/tareas/1 //third.invalid/libro/2 javascript:/coordinacion /api/cron/web-push /admin/usuarios /tareas/1/../../admin /coordinacion-secreta';
    expect(renderToStaticMarkup(<FrontiSourceLinks text={text}/>)).not.toContain('href=');
  });
});
