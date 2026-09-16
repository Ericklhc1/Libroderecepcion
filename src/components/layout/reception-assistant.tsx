'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Loader2,
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

type AssistantResponse = {
  reply?: string;
  confirmations?: Confirmation[];
  messages?: ChatMessage[];
  retentionDays?: number;
  reset?: boolean;
  error?: string;
};

function id(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const WELCOME =
  'Dime qué necesitas hacer o consultar. Puedo revisar prioridades, vencimientos, habitaciones y preparar acciones del Libro.';

function initialMessages(): ChatMessage[] {
  return [{ id: 'welcome', role: 'assistant', content: WELCOME }];
}

export function ReceptionAssistant() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [retentionDays, setRetentionDays] = useState(30);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/asistente', { cache: 'no-store' });
        if (response.status === 401) return;
        const payload = (await response.json()) as AssistantResponse;
        if (!response.ok || cancelled) return;
        if (payload.messages?.length) setMessages(payload.messages);
        else setMessages(initialMessages());
        if (payload.retentionDays) setRetentionDays(payload.retentionDays);
      } catch {
        // La UI principal del Libro no depende del asistente.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    async function heartbeat() {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await fetch('/api/asistente?heartbeat=1', {
          cache: 'no-store',
        });
        if (response.status === 401) window.location.assign('/login');
      } catch {
        // Una caída temporal de red no debe expulsar al recepcionista.
      }
    }

    const timer = window.setInterval(() => void heartbeat(), 4 * 60 * 1000);
    const onFocus = () => void heartbeat();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }, [messages, confirmations, busy, open]);

  function addAssistant(content: string) {
    setMessages((current) => [...current, { id: id(), role: 'assistant', content }]);
  }

  function mergeConfirmations(incoming: Confirmation[]) {
    setConfirmations((current) => {
      const byToken = new Map(current.map((item) => [item.token, item]));
      for (const item of incoming) byToken.set(item.token, item);
      return Array.from(byToken.values()).slice(-6);
    });
  }

  async function sendMessage() {
    const content = text.trim();
    if (!content || busy) return;

    const userMessage: ChatMessage = { id: id(), role: 'user', content };
    setMessages((current) => [...current, userMessage]);
    setText('');
    setBusy(true);

    try {
      const response = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content }),
      });
      const payload = (await response.json()) as AssistantResponse;
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok) throw new Error(payload.error || 'No se pudo consultar al asistente.');

      if (payload.reset) {
        setMessages([
          ...initialMessages(),
          ...(payload.reply
            ? [{ id: id(), role: 'assistant' as const, content: payload.reply }]
            : []),
        ]);
        setConfirmations([]);
      } else {
        addAssistant(payload.reply || 'Listo.');
        if (payload.confirmations?.length) mergeConfirmations(payload.confirmations);
      }
    } catch (error) {
      addAssistant(error instanceof Error ? error.message : 'No se pudo consultar al asistente.');
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function confirmAction(item: Confirmation) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmationToken: item.token }),
      });
      const payload = (await response.json()) as AssistantResponse;
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!response.ok) throw new Error(payload.error || 'No se pudo ejecutar la acción.');

      setConfirmations((current) => current.filter((candidate) => candidate.token !== item.token));
      addAssistant(payload.reply || 'Acción ejecutada.');
    } catch (error) {
      addAssistant(error instanceof Error ? error.message : 'No se pudo ejecutar la acción.');
    } finally {
      setBusy(false);
    }
  }

  async function newConversation() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'new_conversation' }),
      });
      const payload = (await response.json()) as AssistantResponse;
      if (!response.ok) throw new Error(payload.error || 'No se pudo iniciar otra conversación.');
      setMessages(initialMessages());
      setConfirmations([]);
      setText('');
    } catch (error) {
      addAssistant(error instanceof Error ? error.message : 'No se pudo iniciar otra conversación.');
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function forgetConversation() {
    if (busy) return;
    if (!window.confirm('¿Eliminar esta conversación y las memorias que se generaron a partir de ella?')) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'forget_conversation' }),
      });
      const payload = (await response.json()) as AssistantResponse;
      if (!response.ok) throw new Error(payload.error || 'No se pudo eliminar la conversación.');
      setMessages(initialMessages());
      setConfirmations([]);
      setText('');
    } catch (error) {
      addAssistant(error instanceof Error ? error.message : 'No se pudo eliminar la conversación.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50 no-print">
      {open ? (
        <section
          className="pointer-events-auto absolute bottom-20 left-3 right-3 flex h-[min(68vh,570px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:left-auto sm:right-4 sm:w-[390px] lg:bottom-4"
          aria-label="Asistente de Recepción"
        >
          <header className="flex items-center gap-2 border-b border-petrol-800 bg-petrol-900 px-3 py-2.5 text-white">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold-500 text-petrol-950">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold">Asistente de Recepción</h2>
              <p className="truncate text-[0.64rem] text-petrol-100">Memoria personal {retentionDays} días · contexto del turno</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void newConversation()}
              className="rounded-lg p-1.5 text-petrol-100 hover:bg-petrol-800 hover:text-white disabled:opacity-40"
              aria-label="Nueva conversación"
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
              title="Olvidar esta conversación"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-petrol-100 hover:bg-petrol-800 hover:text-white"
              aria-label="Minimizar asistente"
              title="Minimizar"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
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
                className={`rounded-xl border bg-white p-3 ${
                  item.risk === 'high' ? 'border-amber-300' : 'border-slate-200'
                }`}
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
                    onClick={() =>
                      setConfirmations((current) =>
                        current.filter((candidate) => candidate.token !== item.token),
                      )
                    }
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
                Procesando…
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
                placeholder="Escribe una orden o pregunta…"
                className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-1 py-1 text-sm text-slate-800 outline-none placeholder:text-slate-400"
                aria-label="Mensaje para el Asistente de Recepción"
              />
              <button
                type="button"
                disabled={busy || !text.trim()}
                onClick={() => void sendMessage()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-petrol-800 text-white hover:bg-petrol-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Enviar"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
            <p className="mt-1.5 text-center text-[0.61rem] leading-4 text-slate-400">
              “No guardes esto: …” evita memoria. Las acciones sensibles requieren confirmación.
            </p>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="pointer-events-auto absolute bottom-20 right-3 flex h-12 w-12 items-center justify-center rounded-full bg-petrol-900 text-white shadow-xl ring-1 ring-petrol-800 transition-transform hover:scale-105 hover:bg-petrol-800 lg:bottom-4 lg:right-4"
          aria-label="Abrir Asistente de Recepción"
          title="Asistente de Recepción"
        >
          <Sparkles className="h-5 w-5 text-gold-400" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
