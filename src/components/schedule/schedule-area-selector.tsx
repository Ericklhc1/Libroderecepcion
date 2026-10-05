'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { scheduleHref } from '@/domain/schedule-navigation';

/** Reflect the rendered server selection, including Back/Forward and areas without a plan. */
export function ScheduleAreaSelector({ departments, departmentId, section }: {
  departments: { id: string; name: string }[];
  departmentId: string;
  section: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <form action="/equipo" className="flex flex-wrap items-end gap-3" aria-busy={pending}>
    <label className="min-w-[180px] text-sm font-medium text-slate-700">Área
      <select className="input-base mt-1 w-full" name="area" value={departmentId} disabled={pending}
        onChange={(event) => {
          const area = event.target.value;
          if (area !== departmentId) startTransition(() => router.push(scheduleHref({ area, seccion: section })));
        }}>
        {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
      </select>
    </label>
    <input name="seccion" type="hidden" value={section} />
    {pending && <p role="status" className="py-2 text-sm text-slate-600">Consultando área…</p>}
    <noscript><button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium" type="submit">Consultar área</button></noscript>
  </form>;
}
