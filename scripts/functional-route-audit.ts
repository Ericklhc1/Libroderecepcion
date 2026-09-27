import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';

type Status = 'PASS' | 'LIMITED' | 'EMPTY' | 'STATIC' | 'ERROR';
type AuditResult = {
  route: string;
  status: Status;
  samples: number;
  source: string;
  detail?: string;
};

type Probe = {
  source: string;
  run: () => Promise<number>;
};

const sample = async <T>(promise: Promise<T[]>): Promise<number> =>
  Math.min(3, (await promise).length);

const combined = async (...counts: Array<Promise<number>>): Promise<number> =>
  Math.min(3, (await Promise.all(counts)).reduce((sum, count) => sum + count, 0));

const probes: Record<string, Probe> = {
  '/': {
    source: 'OperationalEntry + Task + Alert',
    run: () =>
      combined(
        prisma.operationalEntry.count({ where: { deletedAt: null }, take: undefined }),
        prisma.task.count({ where: { deletedAt: null }, take: undefined }),
        prisma.alert.count({ where: { deletedAt: null }, take: undefined }),
      ),
  },
  '/admin': { source: 'User', run: () => sample(prisma.user.findMany({ take: 3, select: { id: true } })) },
  '/admin/areas': { source: 'Department', run: () => sample(prisma.department.findMany({ take: 3, select: { id: true } })) },
  '/admin/auditoria': { source: 'AuditLog', run: () => sample(prisma.auditLog.findMany({ take: 3, select: { id: true } })) },
  '/admin/correo': { source: 'MailSettings', run: () => sample(prisma.mailSettings.findMany({ take: 3, select: { id: true } })) },
  '/admin/diagnostico': { source: 'SystemSetting', run: () => sample(prisma.systemSetting.findMany({ take: 3, select: { id: true } })) },
  '/admin/eliminados': {
    source: 'soft-delete transversal',
    run: () =>
      combined(
        prisma.operationalEntry.count({ where: { deletedAt: { not: null } } }),
        prisma.task.count({ where: { deletedAt: { not: null } } }),
        prisma.followUp.count({ where: { deletedAt: { not: null } } }),
      ),
  },
  '/admin/fronti': { source: 'ai_conversation', run: () => sample(prisma.ai_conversation.findMany({ take: 3, select: { id: true } })) },
  '/admin/parametros': { source: 'SystemSetting', run: () => sample(prisma.systemSetting.findMany({ take: 3, select: { id: true } })) },
  '/admin/puesta-en-cero': { source: 'AuditLog', run: () => sample(prisma.auditLog.findMany({ take: 3, select: { id: true } })) },
  '/admin/roles': { source: 'Role', run: () => sample(prisma.role.findMany({ take: 3, select: { id: true } })) },
  '/admin/turnos': { source: 'Shift', run: () => sample(prisma.shift.findMany({ take: 3, select: { id: true } })) },
  '/admin/usuarios': { source: 'User', run: () => sample(prisma.user.findMany({ take: 3, select: { id: true } })) },
  '/alertas': { source: 'Alert', run: () => sample(prisma.alert.findMany({ where: { deletedAt: null }, take: 3, select: { id: true } })) },
  '/avisos': { source: 'Announcement', run: () => sample(prisma.announcement.findMany({ take: 3, select: { id: true } })) },
  '/buscar': {
    source: 'HumanOperationalRecord',
    run: async () => {
      const rows = await prisma.$queryRaw<Array<{ humanId: number }>>(Prisma.sql`
        SELECT "humanId" FROM "HumanOperationalRecord" ORDER BY "humanId" DESC LIMIT 3
      `);
      for (const row of rows) {
        const exact = await prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
          SELECT COUNT(*)::bigint AS total
          FROM "HumanOperationalRecord"
          WHERE "humanId" = ${row.humanId}
        `);
        if (Number(exact[0]?.total ?? 0) !== 1) {
          throw new Error('Un #ID humano no resuelve exactamente un registro.');
        }
      }
      return rows.length;
    },
  },
  '/caja': { source: 'CashMovement', run: () => sample(prisma.cashMovement.findMany({ take: 3, select: { id: true } })) },
  '/caja/cierre': { source: 'CashAudit', run: () => sample(prisma.cashAudit.findMany({ take: 3, select: { id: true } })) },
  '/caja/gimnasio': { source: 'GymPass', run: () => sample(prisma.gymPass.findMany({ take: 3, select: { id: true } })) },
  '/habitaciones': { source: 'Room', run: () => sample(prisma.room.findMany({ where: { active: true }, take: 3, select: { id: true } })) },
  '/habitaciones/importar': { source: 'PmsImportBatch', run: () => sample(prisma.pmsImportBatch.findMany({ take: 3, select: { id: true } })) },
  '/historial': { source: 'AuditLog', run: () => sample(prisma.auditLog.findMany({ take: 3, select: { id: true } })) },
  '/huespedes': { source: 'GuestReference', run: () => sample(prisma.guestReference.findMany({ where: { deletedAt: null }, take: 3, select: { id: true } })) },
  '/huespedes/importar': { source: 'PmsImportBatch', run: () => sample(prisma.pmsImportBatch.findMany({ take: 3, select: { id: true } })) },
  '/huespedes/nueva-reserva': { source: 'ReservationReference', run: () => sample(prisma.reservationReference.findMany({ where: { deletedAt: null }, take: 3, select: { id: true } })) },
  '/huespedes/reservas/[id]': {
    source: 'ReservationReference por id',
    run: async () => {
      const rows = await prisma.reservationReference.findMany({ where: { deletedAt: null }, take: 3, select: { id: true } });
      for (const row of rows) {
        if (!(await prisma.reservationReference.findUnique({ where: { id: row.id }, select: { id: true } }))) {
          throw new Error('La reserva muestreada dejó de resolver por id.');
        }
      }
      return rows.length;
    },
  },
  '/incidencias': { source: 'OperationalEntry.INCIDENCIA', run: () => sample(prisma.operationalEntry.findMany({ where: { deletedAt: null, type: 'INCIDENCIA' }, take: 3, select: { id: true } })) },
  '/indicadores': { source: 'OperationalMetricEvent', run: () => sample(prisma.operationalMetricEvent.findMany({ take: 3, select: { id: true } })) },
  '/libro': { source: 'OperationalEntry', run: () => sample(prisma.operationalEntry.findMany({ where: { deletedAt: null }, take: 3, select: { id: true } })) },
  '/libro/[id]': {
    source: 'OperationalEntry por id',
    run: async () => {
      const rows = await prisma.operationalEntry.findMany({ where: { deletedAt: null }, take: 3, select: { id: true } });
      for (const row of rows) {
        if (!(await prisma.operationalEntry.findFirst({ where: { id: row.id, deletedAt: null }, select: { id: true } }))) {
          throw new Error('El registro muestreado dejó de resolver por id.');
        }
      }
      return rows.length;
    },
  },
  '/llaves': { source: 'RoomKey + KeyInventoryCount', run: () => combined(prisma.roomKey.count(), prisma.keyInventoryCount.count()) },
  '/notificaciones': { source: 'Notification', run: () => sample(prisma.notification.findMany({ take: 3, select: { id: true } })) },
  '/perfil': { source: 'User', run: () => sample(prisma.user.findMany({ where: { active: true }, take: 3, select: { id: true } })) },
  '/reservas': { source: 'ReservationReference', run: () => sample(prisma.reservationReference.findMany({ where: { deletedAt: null }, take: 3, select: { id: true } })) },
  '/reservas/[code]': {
    source: 'ReservationReference por code',
    run: async () => {
      const rows = await prisma.reservationReference.findMany({ where: { deletedAt: null }, take: 3, select: { code: true } });
      for (const row of rows) {
        if (!(await prisma.reservationReference.findUnique({ where: { code: row.code }, select: { id: true } }))) {
          throw new Error('La carpeta muestreada dejó de resolver por código.');
        }
      }
      return rows.length;
    },
  },
  '/seguimientos': { source: 'FollowUp', run: () => sample(prisma.followUp.findMany({ where: { deletedAt: null }, take: 3, select: { id: true } })) },
  '/supervision': { source: 'SupervisionShift', run: () => sample(prisma.supervisionShift.findMany({ take: 3, select: { id: true } })) },
  '/supervision/auditorias': { source: 'ChecklistRun', run: () => sample(prisma.checklistRun.findMany({ where: { deletedAt: null }, take: 3, select: { id: true } })) },
  '/supervision/informes': { source: 'Fine + GymPass + OperationalEntry', run: () => combined(prisma.fine.count({ where: { deletedAt: null } }), prisma.gymPass.count(), prisma.operationalEntry.count({ where: { deletedAt: null } })) },
  '/supervision/rendimiento': { source: 'PerformanceObservation', run: () => sample(prisma.performanceObservation.findMany({ take: 3, select: { id: true } })) },
  '/supervision/salud': { source: 'OperationalMetricEvent', run: () => sample(prisma.operationalMetricEvent.findMany({ take: 3, select: { id: true } })) },
  '/supervision/tablero': { source: 'Task + OperationalEntry', run: () => combined(prisma.task.count({ where: { deletedAt: null } }), prisma.operationalEntry.count({ where: { deletedAt: null } })) },
  '/tareas': { source: 'Task', run: () => sample(prisma.task.findMany({ where: { deletedAt: null }, take: 3, select: { id: true } })) },
  '/tareas/[id]': {
    source: 'Task por id',
    run: async () => {
      const rows = await prisma.task.findMany({ where: { deletedAt: null }, take: 3, select: { id: true } });
      for (const row of rows) {
        if (!(await prisma.task.findFirst({ where: { id: row.id, deletedAt: null }, select: { id: true } }))) {
          throw new Error('La tarea muestreada dejó de resolver por id.');
        }
      }
      return rows.length;
    },
  },
  '/turno': { source: 'Shift', run: () => sample(prisma.shift.findMany({ where: { archivedAt: null }, take: 3, select: { id: true } })) },
  '/turno/entrega/[id]': {
    source: 'ShiftHandover por id',
    run: async () => {
      const rows = await prisma.shiftHandover.findMany({ take: 3, select: { id: true } });
      for (const row of rows) {
        if (!(await prisma.shiftHandover.findUnique({ where: { id: row.id }, select: { id: true } }))) {
          throw new Error('La entrega muestreada dejó de resolver por id.');
        }
      }
      return rows.length;
    },
  },
};

const staticRoutes = new Set([
  '/aceptar-terminos',
  '/cambiar-contrasena',
  '/habitaciones/[numero]',
  '/instalacion',
  '/login',
  '/sin-permisos',
]);

function discoverPageRoutes(root: string): string[] {
  const pages: string[] = [];
  const visit = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const absolute = join(directory, name);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!/^page\.(ts|tsx)$/.test(name)) continue;
      const rel = relative(root, absolute).split(sep).join('/');
      const segments = rel
        .replace(/\/page\.(ts|tsx)$/, '')
        .split('/')
        .filter((segment) => segment && !/^\(.+\)$/.test(segment));
      pages.push('/' + segments.join('/'));
    }
  };
  visit(root);
  return pages.sort();
}

async function main() {
  const routes = discoverPageRoutes(join(process.cwd(), 'src', 'app'));
  const unmapped = routes.filter((route) => !probes[route] && !staticRoutes.has(route));
  if (unmapped.length > 0) {
    throw new Error(`Rutas sin estrategia de auditoría: ${unmapped.join(', ')}`);
  }

  const results: AuditResult[] = [];
  for (const route of routes) {
    if (staticRoutes.has(route)) {
      results.push({
        route,
        status: 'STATIC',
        samples: 0,
        source: route === '/habitaciones/[numero]' ? 'redirección histórica verificada por build' : 'ruta sin dataset operativo',
      });
      continue;
    }

    const probe = probes[route]!;
    try {
      const samples = await probe.run();
      results.push({
        route,
        status: samples >= 3 ? 'PASS' : samples > 0 ? 'LIMITED' : 'EMPTY',
        samples,
        source: probe.source,
      });
    } catch (error) {
      results.push({
        route,
        status: 'ERROR',
        samples: 0,
        source: probe.source,
        detail: error instanceof Error ? error.message : 'Error desconocido',
      });
    }
  }

  console.log('\n=== AUDITORÍA FUNCIONAL DE RUTAS · SÓLO LECTURA ===');
  for (const result of results) {
    console.log(
      `[route-audit] ${result.status.padEnd(7)} ${result.route.padEnd(34)} muestras=${result.samples} · ${result.source}` +
        (result.detail ? ` · ${result.detail}` : ''),
    );
  }

  const summary = results.reduce<Record<Status, number>>(
    (acc, result) => {
      acc[result.status] += 1;
      return acc;
    },
    { PASS: 0, LIMITED: 0, EMPTY: 0, STATIC: 0, ERROR: 0 },
  );
  console.log('[route-audit] resumen=' + JSON.stringify(summary));

  if (summary.ERROR > 0) {
    throw new Error(`${summary.ERROR} ruta(s) fallaron su consulta de auditoría.`);
  }
}

main()
  .catch((error) => {
    console.error('[route-audit] FATAL', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
