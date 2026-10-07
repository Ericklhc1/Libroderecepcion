import { describe, expect, it } from 'vitest';
import { frontiClientError } from '@/lib/fronti-client-error';
describe('Fronti: fallos visibles del transporte', () => {
  it.each(['TimeoutError', 'AbortError'])('explica %s sin sugerir duplicar una confirmación pendiente', name => {
    const message = frontiClientError(new DOMException('The operation timed out', name));
    expect(message).toContain('no respondió a tiempo');
    expect(message).toContain('Revisa la conversación y el módulo');
    expect(message).not.toContain('The operation');
  });
  it.each([new TypeError('Failed to fetch'), new SyntaxError('Unexpected token <')])('explica red caída o respuesta ilegible en español', error => {
    expect(frontiClientError(error)).toContain('No se pudo recibir una respuesta de Fronti');
    expect(frontiClientError(error)).toContain('verifica primero su resultado');
  });
  it('conserva errores operativos claros que ya clasificó el servidor', () => {
    expect(frontiClientError(new Error('Tu sesión venció.'))).toBe('Tu sesión venció.');
    expect(frontiClientError(null)).toBe('Fronti no pudo procesar la solicitud.');
  });
});
