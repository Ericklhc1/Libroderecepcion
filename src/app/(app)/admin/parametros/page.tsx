import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { getAllSettings } from '@/server/services/settings';
import { prisma } from '@/lib/prisma';
import { Card, CardHeader, CardScroll } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import type { RawSearchParams } from '@/lib/search-params';
import { Chip } from '@/components/ui/badge';
import { SettingForm } from '../admin-forms';
import { CashConfigForm } from '@/components/admin/cash-config-form';
import { HandoverElementsConfig } from '@/components/admin/handover-elements-config';
import { formatDateTime } from '@/lib/format';

export const metadata = { title: 'Parámetros' };
export const dynamic = 'force-dynamic';

function kindOf(value: unknown): 'boolean' | 'number' | 'string' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

function boolSetting(
  settings: Awaited<ReturnType<typeof getAllSettings>>,
  key: string,
  fallback: boolean,
): boolean {
  const value = settings.find((setting) => setting.key === key)?.value;
  return typeof value === 'boolean' ? value : fallback;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePagePermission('system.configure');
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().toLowerCase() : '';
  const categoria = typeof params.categoria === 'string' ? params.categoria : '';
  const [allSettings, cashFunds, handoverElements] = await Promise.all([
    getAllSettings(),
    prisma.cashFund.findMany({ where: { currency: { in: ['CLP', 'USD'] } } }),
    prisma.handoverElementType.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
  ]);

  // Fronti y Caja tienen pantallas/formularios propios: no se duplican abajo
  // como parámetros técnicos sueltos.
  const settings = allSettings.filter(
    (setting) => !setting.key.startsWith('fronti.') && !setting.key.startsWith('cash.'),
  );

  const byCategory = Array.from(
    settings.reduce((map, setting) => {
      const list = map.get(setting.category) ?? [];
      list.push(setting);
      map.set(setting.category, list);
      return map;
    }, new Map<string, typeof settings>()),
  );

  const visibleByCategory = byCategory
    .filter(([category]) => !categoria || category === categoria)
    .map(([category, list]) => [
      category,
      list.filter((setting) => {
        if (!q) return true;
        return [
          setting.key,
          setting.category,
          setting.description,
          String(setting.value),
          String(setting.defaultValue),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
    ] as const)
    .filter(([, list]) => list.length > 0);

  const clpMinimum = Number(cashFunds.find((fund) => fund.currency === 'CLP')?.amount ?? 100000);
  const usdMinimum = Number(cashFunds.find((fund) => fund.currency === 'USD')?.amount ?? 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver a Administración
      </Link>

      <header>
        <h1 className="text-xl font-semibold text-petrol-900">Parámetros del sistema</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Cada parámetro tiene un valor por defecto en el código; aquí se sobrescribe sin
          necesidad de desplegar. Fronti y Caja tienen controles dedicados para no mezclar reglas operativas con claves técnicas.
        </p>
      </header>

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Buscar parámetro, descripción o valor…"
        clearHref="/admin/parametros"
      >
        <label className="min-w-[12rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Categoría</span>
          <select name="categoria" defaultValue={categoria} className="input-base w-full">
            <option value="">Todas</option>
            {byCategory.map(([category]) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
      </ListFilterBar>

      <Card>
        <CardHeader title="Caja" />
        <div className="px-4 py-4">
          <CashConfigForm
            clpMinimum={clpMinimum}
            usdMinimum={usdMinimum}
            treasuryTransfersEnabled={boolSetting(allSettings, 'cash.treasuryTransfersEnabled', true)}
            transferReceiptRequired={boolSetting(allSettings, 'cash.transferReceiptRequired', false)}
            usdRateEnabled={boolSetting(allSettings, 'cash.usdRateEnabled', true)}
            requireDifferenceNote={boolSetting(allSettings, 'cash.requireDifferenceNote', true)}
          />
        </div>
        <div className="border-t border-slate-200 px-4 py-4">
          <HandoverElementsConfig
            elements={handoverElements.map((element) => ({
              id: element.id,
              name: element.name,
              detail: element.detail,
              required: element.required,
              active: element.active,
              order: element.order,
            }))}
          />
        </div>
      </Card>

      {visibleByCategory.map(([category, list]) => (
        <Card key={category}>
          <CardHeader title={category} count={list.length} />
          <CardScroll>
            <ul className="divide-y divide-slate-100">
            {list.map((setting) => (
              <li key={setting.key} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-sm font-medium text-petrol-900">{setting.key}</code>
                  {setting.overridden ? <Chip>Personalizado</Chip> : <Chip>Por defecto</Chip>}
                </div>
                {setting.description ? (
                  <p className="mt-0.5 text-sm text-slate-600">{setting.description}</p>
                ) : null}
                <p className="mt-0.5 text-xs text-slate-500">
                  Valor por defecto: {String(setting.defaultValue)}
                  {setting.updatedAt ? ` · actualizado ${formatDateTime(setting.updatedAt)}` : ''}
                </p>
                <div className="mt-2">
                  <SettingForm
                    settingKey={setting.key}
                    value={String(setting.value)}
                    kind={kindOf(setting.defaultValue)}
                  />
                </div>
              </li>
            ))}
            </ul>
          </CardScroll>
        </Card>
      ))}
    </div>
  );
}
