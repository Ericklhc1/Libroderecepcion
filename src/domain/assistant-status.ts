/**
 * Por qué puede fallar Fronti, y qué se le dice al mesón cuando falla.
 *
 * Antes no había nada de esto: cualquier fallo de la API se convertía en una
 * excepción con el mensaje que viniera de OpenAI, el endpoint lo devolvía como
 * HTTP 400 y el pop-up lo pintaba tal cual en el chat. Eso tiene tres
 * problemas, y los tres importan en un mesón:
 *
 *  - El recepcionista leía texto técnico en inglés que no le dice qué hacer.
 *  - No se distinguía «no está configurado» de «la clave es inválida» de «está
 *    saturado». Son tres cosas con tres destinatarios distintos: el
 *    Administrador de sistema, el Administrador de sistema con urgencia, y
 *    nadie —hay que esperar—.
 *  - Todo salía como 400, así que ninguna monitorización podía distinguir un
 *    error del usuario de una caída del proveedor.
 *
 * Este archivo es dominio puro y no importa nada: se puede probar sin base,
 * sin red y sin Next, y lo usan el servicio, el endpoint de salud y el de
 * conversación, para que los tres digan lo MISMO.
 */

/**
 * El modelo con el que habla Fronti, declarado en un solo lugar.
 *
 * Vive acá y no como literal dentro del esquema de variables de entorno para
 * que exista un valor por omisión explícito y localizable: si mañana el
 * identificador deja de ser válido, se cambia en una línea y no hay que buscar
 * en qué archivo estaba escondido. `OPENAI_MODEL` lo sigue pudiendo pisar.
 */
export const DEFAULT_ASSISTANT_MODEL = 'gpt-5.6-luna';

/** Cuánto se espera a OpenAI antes de darlo por perdido. */
export const ASSISTANT_TIMEOUT_MS = 30_000;

/**
 * Las causas de fallo que el sistema sabe nombrar.
 *
 * No son los códigos de OpenAI: son las situaciones que cambian lo que hay que
 * HACER. Dos códigos distintos que exigen la misma acción son una sola causa.
 */
export type AssistantFailure =
  /** No hay clave configurada: Fronti nunca estuvo encendido. */
  | 'SIN_CLAVE'
  /** Hay clave, y OpenAI la rechaza. */
  | 'CLAVE_RECHAZADA'
  /** La clave sirve, pero el modelo configurado no existe para esta cuenta. */
  | 'MODELO_DESCONOCIDO'
  /** La cuenta se quedó sin saldo. */
  | 'CUOTA'
  /** Demasiadas consultas a la vez: se pasa esperando. */
  | 'SATURADO'
  /** OpenAI está con problemas. */
  | 'CAIDO'
  /** No contestó dentro del plazo, o no hubo red. */
  | 'SIN_RESPUESTA'
  /** El Administrador de sistema lo apagó a propósito. */
  | 'DESACTIVADO';

/**
 * Qué lee el recepcionista. Cada mensaje dice tres cosas: qué pasó, a quién le
 * toca, y que el Libro sigue funcionando —porque sigue: Fronti es ayuda, no
 * una pieza del turno—.
 */
export const ASSISTANT_FAILURE_MESSAGE: Record<AssistantFailure, string> = {
  SIN_CLAVE:
    'Fronti todavía no está configurado. Avisa al Administrador de sistema: falta la clave de OpenAI. El Libro funciona igual sin él.',
  CLAVE_RECHAZADA:
    'OpenAI rechazó la clave de Fronti. Esto no se arregla desde el mesón: avisa al Administrador de sistema. El Libro funciona igual sin él.',
  MODELO_DESCONOCIDO:
    'OpenAI no reconoce el modelo configurado para Fronti. Avisa al Administrador de sistema. El Libro funciona igual sin él.',
  CUOTA:
    'La cuenta de OpenAI se quedó sin saldo, así que Fronti no puede responder. Avisa al Administrador de sistema. El Libro funciona igual sin él.',
  SATURADO:
    'Fronti está recibiendo muchas consultas a la vez. Espera unos segundos y vuelve a preguntar.',
  CAIDO:
    'OpenAI está con problemas en este momento. Vuelve a intentarlo en un rato; el Libro no depende de Fronti.',
  SIN_RESPUESTA:
    'Fronti tardó demasiado en responder. Vuelve a preguntar; si sigue igual, sigue trabajando sin él.',
  DESACTIVADO: 'Fronti está desactivado por el Administrador de sistema.',
};

/**
 * ¿Vale la pena volver a intentar?
 *
 * Lo usa la pantalla para decidir si ofrece reintentar o si sería crueldad:
 * insistir contra una clave rechazada no la arregla.
 */
export const ASSISTANT_FAILURE_IS_TEMPORARY: Record<AssistantFailure, boolean> = {
  SIN_CLAVE: false,
  CLAVE_RECHAZADA: false,
  MODELO_DESCONOCIDO: false,
  CUOTA: false,
  SATURADO: true,
  CAIDO: true,
  SIN_RESPUESTA: true,
  DESACTIVADO: false,
};

/**
 * El estado HTTP con que se responde cada causa.
 *
 * Importa para la monitorización: un 503 dice «el servicio de apoyo no está»,
 * un 429 dice «insiste más lento» y un 504 dice «se agotó el plazo». Antes
 * todo era 400, que significa «lo pediste mal» y era falso en los ocho casos.
 */
export const ASSISTANT_FAILURE_STATUS: Record<AssistantFailure, number> = {
  SIN_CLAVE: 503,
  CLAVE_RECHAZADA: 503,
  MODELO_DESCONOCIDO: 503,
  CUOTA: 503,
  SATURADO: 429,
  CAIDO: 502,
  SIN_RESPUESTA: 504,
  DESACTIVADO: 503,
};

/** Lo que se le puede sacar a una respuesta fallida de OpenAI. */
export type OpenAIFailureSignal = {
  /** Estado HTTP, si hubo respuesta. */
  status?: number | null;
  /** `error.code` o `error.type` del cuerpo, si vino. */
  code?: string | null;
  /** Texto del error, sólo para reconocer al modelo por su nombre. */
  message?: string | null;
  /** Se cortó antes de tener respuesta. */
  aborted?: boolean;
  /** No se pudo ni conectar. */
  network?: boolean;
};

/**
 * Traduce lo que devolvió OpenAI a una de las causas de arriba.
 *
 * El orden de las comprobaciones no es libre. `insufficient_quota` llega con
 * estado 429, igual que el límite de velocidad, y son cosas opuestas —una se
 * arregla pagando y la otra esperando— así que el código se mira ANTES que el
 * estado. Lo mismo con el modelo: OpenAI lo rechaza con 404 unas veces y con
 * 400 otras, según el endpoint, de modo que tampoco se puede decidir sólo por
 * el estado.
 */
export function classifyAssistantFailure(signal: OpenAIFailureSignal): AssistantFailure {
  if (signal.aborted) return 'SIN_RESPUESTA';
  if (signal.network) return 'SIN_RESPUESTA';

  const code = (signal.code ?? '').toLowerCase();
  const message = (signal.message ?? '').toLowerCase();
  const status = signal.status ?? 0;

  if (code === 'insufficient_quota' || message.includes('insufficient_quota')) return 'CUOTA';
  if (code === 'model_not_found' || code === 'invalid_model') return 'MODELO_DESCONOCIDO';
  if (code === 'invalid_api_key' || code === 'authentication_error') return 'CLAVE_RECHAZADA';

  if (status === 401 || status === 403) return 'CLAVE_RECHAZADA';
  if (status === 404) return 'MODELO_DESCONOCIDO';
  if (status === 429) return 'SATURADO';
  if (status === 408 || status === 504) return 'SIN_RESPUESTA';

  /*
    Un 400 puede ser culpa nuestra (una petición mal armada) o del modelo
    inexistente. Sólo se atribuye al modelo si el mensaje lo nombra; si no, se
    trata como caída, que es lo honesto: no sabemos.
  */
  if (status === 400 && /\bmodel\b/.test(message)) return 'MODELO_DESCONOCIDO';

  return 'CAIDO';
}

/** Los tres estados que puede reportar la salud del asistente. */
export type AssistantHealth =
  /** Clave presente y aceptada, y el modelo existe. */
  | { estado: 'OK' }
  /** Nunca se configuró. */
  | { estado: 'NO_CONFIGURADO' }
  /** Hay clave, pero algo la rechaza o el modelo no existe. */
  | { estado: 'CON_FALLO'; causa: AssistantFailure; detalle: string };

/** Arma la respuesta de salud a partir de la causa, para no repetirla. */
export function assistantHealthFromFailure(failure: AssistantFailure): AssistantHealth {
  if (failure === 'SIN_CLAVE') return { estado: 'NO_CONFIGURADO' };
  return {
    estado: 'CON_FALLO',
    causa: failure,
    detalle: ASSISTANT_FAILURE_MESSAGE[failure],
  };
}
