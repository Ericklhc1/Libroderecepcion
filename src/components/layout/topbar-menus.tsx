'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Building2,
  ChevronDown,
  LogOut,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { logoutAction } from '@/server/actions/auth';
import { cn } from '@/lib/cn';

function useCloseOnOutside(
  open: boolean,
  setOpen: (value: boolean) => void,
  ref: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && ref.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, ref, setOpen]);
}

const triggerClass =
  'inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-petrol-800 shadow-sm transition-colors hover:bg-slate-50';

export function FrontiLauncher({ displayName }: { displayName: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('fronti:open'))}
      className={cn(triggerClass, 'hidden lg:inline-flex')}
      aria-label={`Abrir ${displayName}`}
      title={displayName}
    >
      <Sparkles className="h-4 w-4 text-gold-600" aria-hidden="true" />
      <span className="hidden xl:inline">{displayName}</span>
    </button>
  );
}

export function PropertyMenu({ hotelName }: { hotelName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutside(open, setOpen, ref);

  return (
    <div ref={ref} className="relative hidden lg:block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={triggerClass}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Building2 className="h-4 w-4 text-petrol-600" aria-hidden="true" />
        <span>Alojamiento</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
        >
          <p className="px-2 pb-1 pt-1 text-[0.68rem] font-semibold uppercase tracking-wide text-slate-400">
            Alojamiento activo
          </p>
          <div className="rounded-lg bg-petrol-50 px-3 py-2 text-sm font-semibold text-petrol-900">
            {hotelName}
          </div>
          <p className="px-2 pt-2 text-xs leading-4 text-slate-500">
            La Central está preparada para que el alojamiento sea contexto global. Actualmente sólo existe esta propiedad.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function AccountMenu({
  userName,
  roleName,
  initialsText,
}: {
  userName: string;
  roleName: string;
  initialsText: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutside(open, setOpen, ref);

  return (
    <div ref={ref} className="relative hidden lg:block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={triggerClass}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-petrol-100 text-[0.65rem] font-semibold text-petrol-800">
          {initialsText}
        </span>
        <span className="max-w-36 truncate">{userName}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          <div className="border-b border-slate-100 px-3 py-3">
            <p className="truncate text-sm font-semibold text-petrol-900">{userName}</p>
            <p className="truncate text-xs text-slate-500">{roleName}</p>
          </div>
          <div className="p-2">
            <Link
              href="/perfil"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <UserRound className="h-4 w-4 text-petrol-600" aria-hidden="true" />
              Mi perfil
            </Link>
            <Link
              href="/notificaciones"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Bell className="h-4 w-4 text-petrol-600" aria-hidden="true" />
              Mis notificaciones
            </Link>
          </div>
          <form action={logoutAction} className="border-t border-slate-100 p-2">
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Cerrar sesión
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
