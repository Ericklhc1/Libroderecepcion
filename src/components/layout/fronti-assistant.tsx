'use client';

import { useEffect, useRef, useState } from 'react';
import { AiAttribution } from '@/components/ai/ai-attribution';
import {
  Check,
  Loader2,
  MessageCircle,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type Confirmation = {
  token: string;
  title: string;
  detail: string;
  risk: 'normal' | 'high';
};

type ClientConfig = {
  enabled: boolean;
  displayName: string;
  welcomeMessage: string;
  sessionActivityMinutes: number;
};

type FrontiResponse = {
  reply?: string;
  confirmations?: Confirmation[];
  messages?: ChatMessage[];
  retentionDays?: number;
  assistant?: string;
  config?: ClientConfig;
  reset?: boolean;
  error?: string;
  /** Causa del fallo, cuando el servidor la supo nombrar. */
  causa?: string;
  /** Si insistir tiene alguna posibilidad de servir. */
  reintentable?: boolean;
};

/**
 * Un fallo que ya viene clasificado por el servidor.
 *
 * Se envuelve en una clase propia para que el `catch` pueda saber si el fallo
 * es temporal sin tener que leer el texto del mensaje. El mensaje ya llega en
 * español y operativo —lo arma `@/domain/assistant-status`— así que la
 * pantalla no tiene que redactar nada: sólo decide cuántas veces lo repite.
 */
class FrontiFailure extends Error {
  readonly causa: string;
  readonly reintentable: boolean;

  constructor(message: string, causa: string, reintentable: boolean) {
    super(message);
    this.name = 'FrontiFailure';
    this.causa = causa;
    this.reintentable = reintentable;
  }
}

const API = '/api/fronti';
const OPEN_KEY = 'fronti-open';
const DEFAULT_CONFIG: ClientConfig = {
  enabled: true,
  displayName: 'Fronti',
  welcomeMessage:
    'Hola, soy Fronti. Puedo revisar el Libro, recordar contexto útil, consultar habitaciones y vencimientos, y preparar acciones para que las confirmes.',
  sessionActivityMinutes: 15,
};

function localId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function welcomeMessages(config: ClientConfig): ChatMessage[] {
  return [{ id: 'fronti-welcome', role: 'assistant', content: config.welcomeMessage }];
}

export function FrontiAssistant() {
  const [config, setConfig] = useState<ClientConfig>(DEFAULT_CONFIG);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(welcomeMessages(DEFAULT_CONFIG));
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [retentionDays, setRetentionDays] = useState(30);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastActivityRef = useRef(Date.now());
  /** Última causa de fallo contada, para no repetir el mismo aviso. */
  const lastFailureRef = useRef<string | null>(null);

  useEffect(() => {
    setHydrated(true);
    setOpen(window.sessionStorage.getItem(OPEN_KEY) === '1');

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(API, { cache: 'no-store' });
        if (response.status === 401) {
          window.location.assign('/login');
          return;
        }
        const payload = (await response.json()) as FrontiResponse;
        if (!response.ok || cancelled) return;
        const nextConfig = payload.config ?? DEFAULT_CONFIG;
        setConfig(nextConfig);
        setMessages(payload.messages?.length ? payload.messages : welcomeMessages(nextConfig));
        if (payload.retentionDays) setRetentionDays(payload.retentionDays);
      } catch {
        // Fronti nunca debe impedir usar el Libro.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.sessionStorage.setItem(OPEN_KEY, open ? '1' : '0');
  }, [hydrated, open]);

  useEffect(() => {
    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'focus'];
    for (const event of events) window.addEventListener(event, markActivity, { passive: true });

    async function heartbeat() {
      if (document.visibilityState !== 'visible') return;
      const activeWindowMs = config.sessionActivityMinutes * 60 * 1000;
      if (Date.now() - lastActivityRef.current > activeWindowMs) return;
      try {
        const response = await fetch(`${API}?heartbeat=1&active=1`, { cache: 'no-store' });
        if (response.status === 401) window.location.assign('/login');
      } catch {
        // Una caída temporal de red no debe cerrar una sesión todavía válida.
      }
    }

    const timer = window.setInterval(() => void heartbeat(), 4 * 60 * 1000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        markActivity();
        void heartbeat();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const event of events) window.removeEventListener(event, markActivity);
    };
  }, [config.sessionActivityMinutes]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }, [messages, confirmations, busy, open]);

  function addFronti(content: string) {
    setMessages((current) => [...current, { id: localId(), role: 'assistant', content }]);
  }

  /**
   * Cuenta un fallo en el chat, sin volverse repetitivo.
   *
   * Un fallo definitivo —clave rechazada, modelo inexistente, sin saldo— no se
   * arregla insistiendo, y el recepcionista sí insiste: es lo natural. Sin
   * esto, el hilo se llenaba del mismo párrafo una vez por intento y tapaba la
   * conversación de trabajo. Se dice una vez por causa: si la causa cambia, se
   * vuelve a decir, porque es información nueva.
   */
  function reportFailure(error: unknown) {
    const fallback = `${config.displayName} no pudo procesar la solicitud.`;

    if (!(error instanceof FrontiFailure)) {
      addFronti(error instanceof Error ? error.message : fallback);
      lastFailureRef.current = null;
      return;
    }

    const repetido = !error.reintentable && lastFailureRef.current === error.causa;
    lastFailureRef.current = error.causa;
    if (!repetido) addFronti(error.message);
  }

  function mergeConfirmations(incoming: Confirmation[]) {
    setConfirmations((current) => {
      const byToken = new Map(current.map((item) => [item.token, item]));
      for (const item of incoming) byToken.set(item.token, item);
      return Array.from(byToken.values()).slice(-6);
    });
  }

  async function request(payload: Record<string, unknown>): Promise<FrontiResponse> {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as FrontiResponse;
    if (response.status === 401) {
      window.location.assign('/login');
      throw new Error('Tu sesión venció.');
    }
    if (!response.ok) {
      throw new FrontiFailure(
        data.error || `${config.displayName} no pudo procesar la solicitud.`,
        data.causa ?? 'DESCONOCIDA',
        data.reintentable ?? true,
      );
    }
    if (data.config) setConfig(data.config);
    // Una respuesta buena borra la memoria del último fallo: si vuelve a
    // fallar después, es información nueva y hay que contarla otra vez.
    lastFailureRef.current = null;
    return data;
  }

  async function sendMessage() {
    const content = text.trim();
    if (!content || busy) return;

    setMessages((current) => [...current, { id: localId(), role: 'user', content }]);
    setText('');
    setBusy(true);
    lastActivityRef.current = Date.now();

    try {
      const payload = await request({ message: content });
      if (payload.reset) {
        setMessages([
          ...welcomeMessages(config),
          ...(payload.reply
            ? [{ id: localId(), role: 'assistant' as const, content: payload.reply }]
            : []),
        ]);
        setConfirmations([]);
      } else {
        addFronti(payload.reply || 'Listo.');
        if (payload.confirmations?.length) mergeConfirmations(payload.confirmations);
      }
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function confirmAction(item: Confirmation) {
    if (busy) return;
    setBusy(true);
    lastActivityRef.current = Date.now();
    try {
      const payload = await request({ confirmationToken: item.token });
      setConfirmations((current) => current.filter((candidate) => candidate.token !== item.token));
      addFronti(payload.reply || 'Acción ejecutada.');
    } catch (error) {
      addFronti(error instanceof Error ? error.message : 'No se pudo ejecutar la acción.');
    } finally {
      setBusy(false);
    }
  }

  async function newConversation() {
    if (busy) return;
    setBusy(true);
    try {
      await request({ action: 'new_conversation' });
      setMessages(welcomeMessages(config));
      setConfirmations([]);
      setText('');
    } catch (error) {
      addFronti(error instanceof Error ? error.message : 'No se pudo iniciar otra conversación.');
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function forgetConversation() {
    if (busy) return;
    if (!window.confirm(`¿Quieres que ${config.displayName} elimine esta conversación y las memorias generadas a partir de ella?`)) return;

    setBusy(true);
    try {
      await request({ action: 'forget_conversation' });
      setMessages(welcomeMessages(config));
      setConfirmations([]);
      setText('');
    } catch (error) {
      addFronti(error instanceof Error ? error.message : 'No se pudo eliminar la conversación.');
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated || !loaded || !config.enabled) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 no-print">
      {open ? (
        <section
          className="pointer-events-auto absolute bottom-20 left-3 right-3 flex h-[min(70vh,590px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:left-auto sm:right-4 sm:w-[400px] lg:bottom-4"
          aria-label={config.displayName}
        >
          <header className="flex items-center gap-2 border-b border-petrol-800 bg-petrol-900 px-3 py-2.5 text-white">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold-500 text-petrol-950">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold">{config.displayName}</h2>
              <p className="truncate text-[0.64rem] text-petrol-100">
                Asistente de Recepción · memoria {retentionDays} días
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void newConversation()}
              className="rounded-lg p-1.5 text-petrol-100 hover:bg-petrol-800 hover:text-white disabled:opacity-40"
              aria-label={`Nueva conversación con ${config.displayName}`}
              title="Nueva conversación"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void forgetConversation()}
              className="rounded-lg p-1.5 text-petrol-100 hover:bg-petrol-800 hover:text-white disabled:opacity-40"
              aria-label="Olvidar esta conversación"
              title="Olvidar conversación"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-petrol-100 hover:bg-petrol-800 hover:text-white"
              aria-label={`Minimizar ${config.displayName}`}
              title="Minimizar"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-3">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-5 ${
                    message.role === 'user'
                      ? 'rounded-br-md bg-petrol-800 text-white'
                      : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}

            {confirmations.map((item) => (
              <div
                key={item.token}
                className={`rounded-xl border bg-white p-3 ${item.risk === 'high' ? 'border-amber-300' : 'border-slate-200'}`}
              >
                <div className="flex items-start gap-2">
                  {item.risk === 'high' ? (
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                  ) : (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-petrol-600" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-petrol-900">{item.title}</p>
                    <p className="mt-1 text-xs leading-4 text-slate-600">{item.detail}</p>
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmations((current) => current.filter((candidate) => candidate.token !== item.token))}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmAction(item)}
                    className="rounded-lg bg-petrol-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-petrol-700 disabled:opacity-50"
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            ))}

            {busy ? (
              <div className="flex items-center gap-2 px-1 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                {config.displayName} está procesando…
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          <div className="border-t border-slate-200 bg-white p-3">
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
              {['¿Qué debería revisar primero?', 'Próximos vencimientos'].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setText(suggestion);
                    requestAnimationFrame(() => inputRef.current?.focus());
                  }}
                  className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[0.68rem] text-slate-600 hover:border-petrol-300 hover:bg-petrol-50 hover:text-petrol-800 disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 focus-within:border-petrol-500 focus-within:ring-2 focus-within:ring-petrol-100">
              <textarea
                ref={inputRef}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={2}
                maxLength={6000}
                placeholder={`Pregúntale o dale una instrucción a ${config.displayName}…`}
                className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-1 py-1 text-sm text-slate-800 outline-none placeholder:text-slate-400"
                aria-label={`Mensaje para ${config.displayName}`}
              />
              <button
                type="button"
                disabled={busy || !text.trim()}
                onClick={() => void sendMessage()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-petrol-800 text-white hover:bg-petrol-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={`Enviar a ${config.displayName}`}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
            <p className="mt-1.5 text-center text-[0.61rem] leading-4 text-slate-400">
              Memoria personal {retentionDays} días · “No guardes esto: …” evita memoria · acciones sensibles requieren confirmación.
            </p>
            <AiAttribution className="mt-1 opacity-80" />
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="pointer-events-auto absolute bottom-20 right-3 flex h-12 items-center gap-2 rounded-full bg-petrol-900 px-3.5 text-white shadow-xl ring-1 ring-petrol-800 transition-transform hover:scale-105 hover:bg-petrol-800 lg:bottom-4 lg:right-4"
          aria-label={`Abrir ${config.displayName}`}
          title={config.displayName}
        >
          <MessageCircle className="h-4 w-4 text-gold-400" aria-hidden="true" />
          <span className="text-xs font-semibold">{config.displayName}</span>
        </button>
      )}
    </div>
  );
}
