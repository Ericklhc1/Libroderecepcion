import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('auditoría UX operativa 1.10.10', () => {
  it('la barra móvil usa una etiqueta explícita y no corta «Mi turno» a «Mi»', () => {
    const items = readFileSync('src/components/layout/nav-items.ts', 'utf8');
    const nav = readFileSync('src/components/layout/nav.tsx', 'utf8');
    expect(items).toContain("mobileLabel: 'Turno'");
    expect(nav).toContain('item.mobileLabel ?? item.label');
    expect(nav).not.toContain("item.label.split(' ')[0]");
  });

  it('Tareas no revive vínculos PMS retirados y permite colaboradores con toque', () => {
    const form = readFileSync('src/components/forms/task-form.tsx', 'utf8');
    expect(form).not.toContain('Usa Ctrl/Cmd');
    expect(form).not.toContain('name="roomId"');
    expect(form).not.toContain('name="reservationId"');
    expect(form).not.toContain('name="guestId"');
    expect(form).toContain('type="checkbox"');
    expect(form).toContain('name="collaboratorIds"');
  });

  it('un comunicado obligatorio puede aparecer en vivo y queda sobre el chat', () => {
    const feed = readFileSync('src/server/services/notification-feed.ts', 'utf8');
    const stream = readFileSync('src/app/api/notifications/stream/route.ts', 'utf8');
    const center = readFileSync('src/components/layout/notification-center.tsx', 'utf8');
    const gate = readFileSync('src/components/operational/announcement-gate.tsx', 'utf8');

    expect(feed).toContain('blockingAnnouncementIds');
    expect(stream).toContain('snapshot.blockingAnnouncementIds');
    expect(center).toContain('router.refresh()');
    expect(gate).toContain('z-[200]');
  });

  it('Chat usa su stream propio sin duplicar bootstrap desde notificaciones', () => {
    const chat = readFileSync('src/components/layout/chat-widget.tsx', 'utf8');
    expect(chat).toContain("new EventSource('/api/chat/stream')");
    expect(chat).not.toContain("addEventListener('libro:notification-feed'");
  });

  it('SubmitButton mantiene disabled durante pending aunque reciba disabled=false', () => {
    const button = readFileSync('src/components/ui/button.tsx', 'utf8');
    const component = button.slice(button.indexOf('export function SubmitButton'));
    const spread = component.indexOf('{...props}');
    const disabled = component.indexOf('disabled={pending || props.disabled}');
    expect(spread).toBeGreaterThan(-1);
    expect(disabled).toBeGreaterThan(spread);
  });

  it('los diálogos atrapan Tab y devuelven el foco al cerrarse', () => {
    const dialog = readFileSync('src/components/ui/dialog.tsx', 'utf8');
    expect(dialog).toContain("event.key !== 'Tab'");
    expect(dialog).toContain('previousFocusRef');
    expect(dialog).toContain('previous.focus()');
  });

  it('Inicio describe el cierre secuencial vigente', () => {
    const page = readFileSync('src/app/(app)/page.tsx', 'utf8');
    expect(page).toContain('cierra formalmente tu turno');
    expect(page).not.toContain('Tu turno se cierra cuando el turno siguiente confirme');
  });
});
