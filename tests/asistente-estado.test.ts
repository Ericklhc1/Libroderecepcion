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

/** Las causas conocidas, para no repetirlas en cada prueba. */
const CAUSAS: AssistantFailure[] = [
  'SIN_CLAVE',
  'CLAVE_RECHAZADA',
  'MODELO_DESCONOCIDO',
  'CUOTA',
  'SATURADO',
  'CAIDO',
  'SIN_RESPUESTA',
  'PETICION_INVALIDA',
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
    y no se pudo verificar contra la documentación de el proveedor desde este
    entorno. Si el identificador resultara equivocado, el proveedor responde 400
    nombrando el modelo, y el sistema tiene que decir «el modelo no existe» y
    no «el proveedor está caído»: lo primero se arregla, lo segundo se espera.
  */
  it('un 400 que nombra el modelo se atribuye al modelo', () => {
    expect(
      classifyAssistantFailure({
        status: 400,
        message: "The model 'modelo-inexistente' does not exist or you do not have access to it.",
      }),
    ).toBe('MODELO_DESCONOCIDO');
  });

  /*
    El fallo real que Fronti mostró en producción, palabra por palabra.

    El historial mandaba los mensajes del asistente como `input_text`, que la
    API sólo acepta para lo que ENTRA; para lo que sale exige `output_text`. Y
    como el saludo de Fronti es un mensaje de asistente y viaja en el
    historial, la conversación fallaba desde la primera pregunta: Fronti nunca
    contestó nada.

    Lo que se prueba acá es la CLASIFICACIÓN, que es la otra mitad del
    problema: un 400 así no es una caída de el proveedor —entendió la petición y la
    rechazó con razón— sino un error del Libro. Si se llamara caída, el mesón
    leería «vuelve a intentarlo en un rato» para algo que no se arregla nunca
    solo.
  */
  it('el error real de input_text se atribuye al Libro, no a el proveedor', () => {
    expect(
      classifyAssistantFailure({
        status: 400,
        message: "Invalid value: 'input_text'. Supported values are: 'output_text' and 'refusal'.",
      }),
    ).toBe('PETICION_INVALIDA');
  });

  it('un 400 nuestro no se disfraza de caída del proveedor', () => {
    expect(
      classifyAssistantFailure({ status: 400, message: 'Invalid value for parameter input.' }),
    ).toBe('PETICION_INVALIDA');
    expect(classifyAssistantFailure({ status: 422 })).toBe('PETICION_INVALIDA');
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

  it('el endpoint delega los estados al dominio y sondea el proveedor real', () => {
    /*
      El endpoint ya no repite los literales NO_CONFIGURADO/CON_FALLO:
      assistantHealthFromFailure es la única fuente de verdad para esos estados.
      Lo importante es que delegue ahí y que el único estado construido
      directamente sea OK tras un sondeo exitoso.
    */
    const source = readFileSync('src/app/api/health/asistente/route.ts', 'utf-8');
    expect(source).toContain('assistantHealthFromFailure');
    expect(source).toContain('probeFrontiProvider');
    expect(source).toContain("estado: 'OK'");
    // Sin exponer credenciales ni el modelo en la respuesta.
    expect(source).not.toMatch(/apiKey|GROQ_API_KEY|OPENAI_API_KEY|FRONTI_API_KEY/);
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
    const source = readFileSync('src/server/ai/fronti-provider.ts', 'utf-8');
    expect(source).toContain('AbortSignal.timeout(ASSISTANT_TIMEOUT_MS)');
    expect(ASSISTANT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(ASSISTANT_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it('el loop de Fronti usa el adaptador y no llama directamente a un proveedor', () => {
    const source = readFileSync('src/server/ai/reception-assistant.ts', 'utf-8');
    expect(source).toContain('chatWithFrontiProvider');
    expect(source).toContain('resolveFrontiProvider');
    expect(source).not.toContain('api.openai.com');
    expect(source).not.toContain('api.groq.com');
  });

  it('el adaptador soporta Groq, vLLM y fallback OpenAI sin filtrar secretos', () => {
    const source = readFileSync('src/server/ai/fronti-provider.ts', 'utf-8');
    expect(source).toContain("provider === 'vllm'");
    expect(source).toContain("provider === 'openai'");
    expect(source).toContain('api.groq.com/openai/v1');
    expect(source).toContain('/chat/completions');
    expect(source).toContain('AbortSignal.timeout(ASSISTANT_TIMEOUT_MS)');
  });

  it('normaliza credenciales copiadas desde paneles antes de enviarlas al proveedor', () => {
    const source = readFileSync('src/lib/env.ts', 'utf-8');
    expect(source).toContain('const secretEnv = z.preprocess');
    expect(source).toContain('value.trim()');
    expect(source).toContain('GROQ_API_KEY: secretEnv');
    expect(source).toContain('FRONTI_API_KEY: secretEnv');
    expect(source).toContain('OPENAI_API_KEY: secretEnv');
  });

  it('el endpoint de conversación responde con el estado de la causa', () => {
    const source = readFileSync('src/app/api/fronti/route.ts', 'utf-8');
    expect(source).toContain('AssistantError');
    expect(source).toContain('ASSISTANT_FAILURE_STATUS');
  });

  it('las confirmaciones mutables son de un solo uso persistente', () => {
    const source = readFileSync('src/server/ai/reception-assistant.ts', 'utf-8');
    const schema = readFileSync('prisma/schema.prisma', 'utf-8');

    expect(source).toContain('nonce: randomUUID()');
    expect(source).toContain('assistantActionReceipt.create');
    expect(source).toContain('claimConfirmation(pending)');
    expect(schema).toContain('model AssistantActionReceipt');
    expect(schema).toContain('nonce     String   @unique');
  });
});


describe('credenciales administrables de Fronti', () => {
  it('guarda sólo material cifrado y mantiene fallback al entorno', () => {
    const source = readFileSync('src/server/ai/fronti-provider.ts', 'utf-8');
    expect(source).toContain('sealSecret');
    expect(source).toContain('openSecret');
    expect(source).toContain("__secret.fronti.provider.");
    expect(source).toContain('resolveFrontiProviderRuntime');
    expect(source).toContain('runtime.GROQ_API_KEY');
    expect(source).toContain('runtime.OPENAI_API_KEY');
    expect(source).toContain('runtime.FRONTI_API_KEY');
  });

  it('todos los consumidores operativos resuelven la credencial efectiva', () => {
    for (const file of [
      'src/server/ai/reception-assistant.ts',
      'src/server/ai/operational-brief.ts',
      'src/server/ai/memory.ts',
      'src/app/api/health/asistente/route.ts',
      'src/app/(app)/admin/fronti/page.tsx',
    ]) {
      const source = readFileSync(file, 'utf-8');
      expect(source, file).toContain('resolveFrontiProviderRuntime');
      expect(source, file).not.toContain('resolveFrontiProvider(config)');
    }
  });

  it('la auditoría registra estado, nunca la credencial', () => {
    const actions = readFileSync('src/server/actions/fronti.ts', 'utf-8');
    expect(actions).toContain('saveFrontiProviderCredentialAction');
    expect(actions).toContain('clearFrontiProviderCredentialAction');
    expect(actions).toContain("entity: 'FrontiProviderCredential'");
    expect(actions).not.toContain('after: { apiKey');
    expect(actions).not.toContain('before: { apiKey');
  });
});
