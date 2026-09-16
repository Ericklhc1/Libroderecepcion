import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_FAILURE_IS_TEMPORARY,
  ASSISTANT_FAILURE_MESSAGE,
  ASSISTANT_FAILURE_STATUS,
  ASSISTANT_TIMEOUT_MS,
  DEFAULT_ASSISTANT_MODEL,
  assistantHealthFromFailure,
  classifyAssistantFailure,
  type AssistantFailure,
} from '@/domain/assistant-status';

/** Las ocho causas, para no repetirlas en cada prueba. */
const CAUSAS: AssistantFailure[] = [
  'SIN_CLAVE',
  'CLAVE_RECHAZADA',
  'MODELO_DESCONOCIDO',
  'CUOTA',
  'SATURADO',
  'CAIDO',
  'SIN_RESPUESTA',
  'DESACTIVADO',
];

describe('clasificación de fallos del asistente', () => {
  it('el plazo agotado y la falta de red son «sin respuesta»', () => {
    expect(classifyAssistantFailure({ aborted: true })).toBe('SIN_RESPUESTA');
    expect(classifyAssistantFailure({ network: true })).toBe('SIN_RESPUESTA');
  });

  it('401 y 403 son clave rechazada, no caída del proveedor', () => {
    // Importa la distinción: una la arregla el Administrador de sistema, la
    // otra se espera. Antes las dos llegaban como el mismo texto crudo.
    expect(classifyAssistantFailure({ status: 401 })).toBe('CLAVE_RECHAZADA');
    expect(classifyAssistantFailure({ status: 403 })).toBe('CLAVE_RECHAZADA');
  });

  /*
    El caso que obliga a mirar el código ANTES del estado: la falta de saldo
    llega con 429, igual que el límite de velocidad, y son opuestos. Si se
    decidiera sólo por el estado, al mesón se le diría «espera unos segundos»
    durante toda una noche en que no iba a funcionar nunca.
  */
  it('sin saldo no se confunde con saturado, aunque los dos sean 429', () => {
    expect(
      classifyAssistantFailure({ status: 429, code: 'insufficient_quota' }),
    ).toBe('CUOTA');
    expect(classifyAssistantFailure({ status: 429, code: 'rate_limit_exceeded' })).toBe(
      'SATURADO',
    );
    expect(classifyAssistantFailure({ status: 429 })).toBe('SATURADO');
  });

  it('reconoce el modelo inexistente por código y por estado', () => {
    expect(classifyAssistantFailure({ status: 404 })).toBe('MODELO_DESCONOCIDO');
    expect(classifyAssistantFailure({ status: 400, code: 'model_not_found' })).toBe(
      'MODELO_DESCONOCIDO',
    );
  });

  /*
    Ésta es la prueba que importa hoy: `gpt-5.6-luna` es el modelo por omisión
    y no se pudo verificar contra la documentación de OpenAI desde este
    entorno. Si el identificador resultara equivocado, OpenAI responde 400
    nombrando el modelo, y el sistema tiene que decir «el modelo no existe» y
    no «el proveedor está caído»: lo primero se arregla, lo segundo se espera.
  */
  it('un 400 que nombra el modelo se atribuye al modelo', () => {
    expect(
      classifyAssistantFailure({
        status: 400,
        message: "The model 'gpt-5.6-luna' does not exist or you do not have access to it.",
      }),
    ).toBe('MODELO_DESCONOCIDO');
  });

  it('un 400 que no nombra el modelo no se le atribuye', () => {
    // No sabemos qué pasó, y decir «el modelo no existe» sería inventar.
    expect(
      classifyAssistantFailure({ status: 400, message: 'Invalid value for parameter input.' }),
    ).toBe('CAIDO');
  });

  it('los 5xx son caída del proveedor', () => {
    for (const status of [500, 502, 503]) {
      expect(classifyAssistantFailure({ status })).toBe('CAIDO');
    }
  });

  it('un fallo sin ninguna señal no se inventa una causa', () => {
    expect(classifyAssistantFailure({})).toBe('CAIDO');
  });
});

describe('lo que lee el mesón', () => {
  it('cada causa tiene mensaje, estado HTTP y política de reintento', () => {
    for (const causa of CAUSAS) {
      expect(ASSISTANT_FAILURE_MESSAGE[causa], causa).toBeTruthy();
      expect(ASSISTANT_FAILURE_STATUS[causa], causa).toBeGreaterThanOrEqual(400);
      expect(typeof ASSISTANT_FAILURE_IS_TEMPORARY[causa], causa).toBe('boolean');
    }
  });

  it('ningún mensaje deja al recepcionista sin saber qué hacer', () => {
    /*
      Un mensaje de error que no dice qué hacer es ruido. Los definitivos
      mandan avisar al Administrador de sistema; los temporales mandan
      esperar y volver a intentar.
    */
    for (const causa of CAUSAS) {
      const mensaje = ASSISTANT_FAILURE_MESSAGE[causa];
      const temporal = ASSISTANT_FAILURE_IS_TEMPORARY[causa];
      const dice = temporal
        ? /vuelve a (intentarlo|preguntar)|espera/i.test(mensaje)
        : /Administrador de sistema/i.test(mensaje);
      expect(dice, `${causa}: «${mensaje}»`).toBe(true);
    }
  });

  it('ningún mensaje filtra jerga técnica ni inglés de la API', () => {
    const prohibido = /openai_|status code|rate_limit|insufficient_quota|api key|bearer|token/i;
    for (const causa of CAUSAS) {
      expect(prohibido.test(ASSISTANT_FAILURE_MESSAGE[causa]), causa).toBe(false);
    }
  });

  it('los fallos definitivos no invitan a reintentar', () => {
    for (const causa of ['SIN_CLAVE', 'CLAVE_RECHAZADA', 'MODELO_DESCONOCIDO', 'CUOTA'] as const) {
      expect(ASSISTANT_FAILURE_IS_TEMPORARY[causa], causa).toBe(false);
    }
    for (const causa of ['SATURADO', 'CAIDO', 'SIN_RESPUESTA'] as const) {
      expect(ASSISTANT_FAILURE_IS_TEMPORARY[causa], causa).toBe(true);
    }
  });

  it('el estado HTTP no es 400 para nada que no sea culpa de quien pregunta', () => {
    // Antes TODO salía como 400, que significa «lo pediste mal», y era falso
    // en los ocho casos: ninguna monitorización podía distinguirlos.
    for (const causa of CAUSAS) {
      expect(ASSISTANT_FAILURE_STATUS[causa], causa).not.toBe(400);
    }
    expect(ASSISTANT_FAILURE_STATUS.SATURADO).toBe(429);
    expect(ASSISTANT_FAILURE_STATUS.SIN_RESPUESTA).toBe(504);
    expect(ASSISTANT_FAILURE_STATUS.CAIDO).toBe(502);
  });
});

describe('los tres estados de la salud', () => {
  it('sin clave es «no configurado», no un fallo', () => {
    // La distinción es la razón de existir de este endpoint: nunca haber sido
    // encendido no es lo mismo que estar roto.
    expect(assistantHealthFromFailure('SIN_CLAVE')).toEqual({ estado: 'NO_CONFIGURADO' });
  });

  it('con clave y rechazo es «con fallo», con la causa y el detalle', () => {
    expect(assistantHealthFromFailure('CLAVE_RECHAZADA')).toEqual({
      estado: 'CON_FALLO',
      causa: 'CLAVE_RECHAZADA',
      detalle: ASSISTANT_FAILURE_MESSAGE.CLAVE_RECHAZADA,
    });
  });

  it('el endpoint distingue los tres estados y no un booleano', () => {
    /*
      Se comprueba sobre el código porque lo que falla acá es el CONTRATO del
      endpoint: antes devolvía `openaiConfigured: Boolean(OPENAI_API_KEY)`, que
      responde «hay una clave escrita» cuando la pregunta es «sirve».
    */
    const source = readFileSync('src/app/api/health/asistente/route.ts', 'utf-8');
    for (const estado of ['NO_CONFIGURADO', 'OK', 'CON_FALLO']) {
      expect(source, `falta el estado ${estado}`).toContain(estado);
    }
    // Y el sondeo tiene que preguntar de verdad, con plazo.
    expect(source).toContain('api.openai.com/v1/models/');
    expect(source).toContain('AbortSignal.timeout');
    // Sin exponer la clave ni el modelo en la respuesta.
    expect(source).not.toMatch(/json\([^)]*modelo/i);
  });
});

describe('el modelo y el plazo están declarados', () => {
  it('hay un modelo por omisión explícito', () => {
    expect(DEFAULT_ASSISTANT_MODEL.trim().length).toBeGreaterThan(0);
  });

  it('el esquema de entorno usa la constante, no un literal suelto', () => {
    /*
      Fallo que esto evita: el identificador del modelo escrito a mano dentro
      del esquema de variables de entorno. Si deja de ser válido hay que poder
      cambiarlo en un solo lugar, y para eso el literal no puede estar ahí.
    */
    const source = readFileSync('src/lib/env.ts', 'utf-8');
    expect(source).toContain('DEFAULT_ASSISTANT_MODEL');
    expect(source).not.toContain(`'${DEFAULT_ASSISTANT_MODEL}'`);
  });

  it('la llamada al asistente tiene plazo explícito', () => {
    // El `fetch` de Node no trae plazo: sin esto, una llamada colgada dejaba
    // la pantalla del mesón esperando para siempre.
    const source = readFileSync('src/server/ai/reception-assistant.ts', 'utf-8');
    expect(source).toContain('AbortSignal.timeout(ASSISTANT_TIMEOUT_MS)');
    expect(ASSISTANT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(ASSISTANT_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it('el endpoint de conversación responde con el estado de la causa', () => {
    const source = readFileSync('src/app/api/fronti/route.ts', 'utf-8');
    expect(source).toContain('AssistantError');
    expect(source).toContain('ASSISTANT_FAILURE_STATUS');
  });
});
