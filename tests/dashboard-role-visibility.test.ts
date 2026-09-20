import { AlertLevel, AlertStatus, AlertType } from '@prisma/client';
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

  it('reserva la validación de cierre para Supervisión y Administración', async () => {
    const receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    const supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    const alert = await prisma.alert.create({
      data: {
        type: AlertType.OTRO,
        level: AlertLevel.CRITICA,
        status: AlertStatus.NUEVA,
        title: 'Validar cierre de turno',
        dedupeKey: 'shift-validation:prueba',
      },
    });

    const [receptionData, supervisorData] = await Promise.all([
      getDashboardData(receptionist),
      getDashboardData(supervisor),
    ]);

    expect(receptionData.alerts.map((item) => item.id)).not.toContain(alert.id);
    expect(receptionData.attention.map((item) => item.id)).not.toContain(
      `alert:${alert.id}`,
    );
    expect(receptionData.counters.liveAlerts).toBe(0);

    expect(supervisorData.alerts.map((item) => item.id)).toContain(alert.id);
    expect(supervisorData.attention.map((item) => item.id)).toContain(
      `alert:${alert.id}`,
    );
    expect(supervisorData.counters.liveAlerts).toBe(1);
  });
});
