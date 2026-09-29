import {
  AlertLevel,
  AlertStatus,
  AlertType,
  OperationalAlarmKind,
  OperationalAlarmScope,
} from '@prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import { getDashboardData } from '@/server/services/dashboard';

describe('visibilidad de acciones por rol en Inicio', () => {
  beforeAll(seedCatalog);
  beforeEach(resetOperationalData);

  it('separa señales internas legadas de las Alertas programables del usuario', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });

    const internalSignal = await prisma.alert.create({
      data: {
        type: AlertType.OTRO,
        level: AlertLevel.CRITICA,
        status: AlertStatus.NUEVA,
        title: 'Validar cierre de turno',
        dedupeKey: 'shift-validation:prueba',
      },
    });

    await prisma.operationalAlarm.create({
      data: {
        kind: OperationalAlarmKind.RECORDATORIO,
        scope: OperationalAlarmScope.INDIVIDUAL,
        title: 'Revisar registro programado',
        dueAt: new Date(Date.now() + 60_000),
        createdById: supervisor.id,
        recipients: {
          create: { userId: supervisor.id },
        },
      },
    });

    const [receptionData, supervisorData] = await Promise.all([
      getDashboardData(receptionist),
      getDashboardData(supervisor),
    ]);

    // El modelo histórico Alert ya no alimenta Inicio como si fuera otra
    // novedad/tarea. Conserva su trazabilidad y sus flujos internos aparte.
    expect(receptionData.alerts).toEqual([]);
    expect(supervisorData.alerts).toEqual([]);
    expect(receptionData.attention.map((item) => item.id)).not.toContain(
      `alert:${internalSignal.id}`,
    );
    expect(supervisorData.attention.map((item) => item.id)).not.toContain(
      `alert:${internalSignal.id}`,
    );

    // El contador "Alertas" representa las llamadas de atención programables
    // pendientes de la cuenta, no señales técnicas globales.
    expect(receptionData.counters.liveAlerts).toBe(0);
    expect(supervisorData.counters.liveAlerts).toBe(1);
  });
});
