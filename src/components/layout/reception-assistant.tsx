'use client';

import { useMemo, useRef, useState } from 'react';
import { Check, Loader2, Send, ShieldAlert, Sparkles, X } from 'lucide-react';

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
  error?: string;
};

function id(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const WELCOME =
  'Dime qué necesitas hacer o consultar. Por ejemplo: “¿qué debería revisar primero?”, “próximos vencimientos” o “marca check-out 415 y 417”.';

export function ReceptionAssistant() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'assistant', content: WELCOME },
  ]);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const apiMessages = useMemo(
    () => messages.map(({ role, content }) => ({ role, content })).slice(-17),
    [messages],
  );

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
    const conversation = [...apiMessages, { role: 'user' as const, content }].slice(-18);
    setMessages((current) => [...current, userMessage]);
    setText('');
    setBusy(true);

    try {
      const response = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversation }),
      });
      const payload = (await response.json()) as AssistantResponse;
      if (!response.ok) throw new Error(payload.error || 'No se pudo consultar al asistente.');

      addAssistant(payload.reply || 'Listo.');
      if (payload.confirmations?.length) mergeConfirmations(payload.confirmations);
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
      if (!response.ok) throw new Error(payload.error || 'No se pudo ejecutar la acción.');

      setConfirmations((current) => current.filter((candidate) => candidate.token !== item.token));
      addAssistant(payload.reply || 'Acción ejecutada.');
    } catch (error) {
      addAssistant(error instanceof Error ? error.message : 'No se pudo ejecutar la acción.');
    } finally {
      setBusy(false);
    }
  }

  function newConversation() {
    setMessages([{ id: 'welcome', role: 'assistant', content: WELCOME }]);
    setConfirmations([]);
    setText('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <div className="fixed bottom-20 right-3 z-50 lg:bottom-5 lg:right-5 no-print">
      {open ? (
        <section
          className="flex h-[min(72vh,620px)] w-[min(calc(100vw-1.5rem),410px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          aria-label="Asistente de Recepción"
        >
          <header className="flex items-center gap-3 border-b border-petrol-800 bg-petrol-900 px-4 py-3 text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-500 text-petrol-950">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">Asistente de Recepción</h2>
              <p className="text-[0.68rem] text-petrol-100">Consulta, prepara y ejecuta acciones del Libro</p>
            </div>
            <button
              type="button"
              onClick={newConversation}
              className="rounded-lg px-2 py-1 text-[0.68rem] font-medium text-petrol-100 hover:bg-petrol-800 hover:text-white"
            >
              Nuevo
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-petrol-100 hover:bg-petrol-800 hover:text-white"
              aria-label="Cerrar asistente"
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
          </div>

          <div className="border-t border-slate-200 bg-white p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {['¿Qué debería revisar primero?', 'Próximos vencimientos'].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setText(suggestion);
                    requestAnimationFrame(() => inputRef.current?.focus());
                  }}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[0.68rem] text-slate-600 hover:border-petrol-300 hover:bg-petrol-50 hover:text-petrol-800 disabled:opacity-50"
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
            <p className="mt-1.5 text-center text-[0.62rem] text-slate-400">
              Las acciones sensibles requieren confirmación y respetan tus permisos.
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
          className="flex items-center gap-2 rounded-full bg-petrol-900 px-4 py-3 text-sm font-semibold text-white shadow-xl ring-1 ring-petrol-800 hover:bg-petrol-800"
          aria-label="Abrir Asistente de Recepción"
        >
          <Sparkles className="h-4 w-4 text-gold-400" aria-hidden="true" />
          <span>Asistente</span>
        </button>
      )}
    </div>
  );
}
