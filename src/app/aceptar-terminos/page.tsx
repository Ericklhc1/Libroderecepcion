import { redirect } from 'next/navigation';
import { BookOpen, FileCheck2, LogOut, ShieldCheck, Sparkles } from 'lucide-react';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { requirePageUser } from '@/server/auth/guard';
import { logoutAction } from '@/server/actions/auth';
import { acceptTermsAction } from '@/server/actions/legal';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import {
  AI_ATTRIBUTION,
  TERMS_SECTIONS,
  TERMS_TITLE,
  TERMS_VERSION,
} from '@/domain/legal';

export const metadata = { title: 'Términos de uso' };
export const dynamic = 'force-dynamic';

export default async function AcceptTermsPage() {
  const user = await requirePageUser({ allowIncompleteAccess: true });

  if (user.mustChangePassword) redirect('/cambiar-contrasena');
  if (await hasAcceptedCurrentTerms(user.id)) redirect('/');

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-5 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-petrol-900 text-gold-300">
            <BookOpen className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-medium text-slate-500">Libro Operativo de Recepción</p>
            <h1 className="text-xl font-semibold text-petrol-950">{TERMS_TITLE}</h1>
          </div>
        </header>

        <section className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-200">
          <div className="border-b border-slate-200 bg-petrol-50 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-petrol-900">
                <FileCheck2 className="h-4 w-4" aria-hidden="true" />
                Aceptación requerida antes del primer uso
              </p>
              <span className="rounded-full bg-white px-2.5 py-1 text-[0.68rem] font-medium text-slate-600 ring-1 ring-slate-200">
                Versión {TERMS_VERSION}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Hola, {user.name}. Lee estos términos antes de entrar a la plataforma. La aceptación queda
              registrada con fecha y versión para trazabilidad.
            </p>
          </div>

          <div className="max-h-[58vh] space-y-5 overflow-y-auto px-5 py-5">
            {TERMS_SECTIONS.map((section) => (
              <section key={section.title}>
                <h2 className="text-sm font-semibold text-petrol-900">{section.title}</h2>
                <div className="mt-2 space-y-2">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph} className="text-sm leading-6 text-slate-600">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            ))}

            <div className="rounded-xl bg-petrol-950 px-4 py-3 text-center text-xs text-petrol-100">
              <p className="flex items-center justify-center gap-1.5 font-medium text-gold-300">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                {AI_ATTRIBUTION}
              </p>
            </div>
          </div>

          <div className="border-t border-slate-200 px-5 py-5">
            <ActionForm action={acceptTermsAction} className="space-y-4">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                <input
                  type="checkbox"
                  name="accept"
                  value="yes"
                  required
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-petrol-700 focus:ring-petrol-500"
                />
                <span className="text-sm leading-5 text-slate-700">
                  He leído y acepto estos términos y condiciones de desarrollo y uso interno,
                  incluida la sección relativa al uso de inteligencia artificial.
                </span>
              </label>

              <SubmitButton className="w-full" pendingLabel="Registrando aceptación…">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Aceptar y entrar al Libro
              </SubmitButton>
            </ActionForm>

            <form action={logoutAction} className="mt-3 text-center">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-petrol-700"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Cerrar sesión sin aceptar
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
