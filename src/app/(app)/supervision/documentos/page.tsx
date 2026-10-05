import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePagePermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { ManualDocumentReview } from '@/components/supervision/manual-documents/review-workspace';

export const metadata = { title: 'Preparar revisión documental · Supervisión' };
export const dynamic = 'force-dynamic';

export default async function ManualDocumentsPage() {
  const user = await requirePagePermission('supervision.center.view');
  if (!hasPermission(user, 'supervision.audit.create')) redirect('/sin-permisos');
  return <div className="mx-auto max-w-7xl space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-petrol-900">Preparar revisión documental</h1>
        <p className="mt-1 text-sm text-slate-600">Carga manual, comparación con el original y decisiones propuestas por {user.name}.</p></div>
      <Link href="/supervision" className="text-sm font-medium underline">Volver a Supervisión</Link>
    </header>
    <ManualDocumentReview key={`${user.id}:${user.departmentId ?? ''}`} actor={{ id: user.id, name: user.name }} scope={{ userId: user.id, departmentId: user.departmentId }} />
  </div>;
}
