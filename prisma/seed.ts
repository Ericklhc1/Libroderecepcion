/**
 * Semilla del Libro Operativo de Recepción.
 *
 * Crea dos capas separadas:
 *  1. Catálogo base (permisos, roles, áreas, parámetros): necesario siempre.
 *  2. Datos demo realistas (usuarios, turnos, registros...), marcados con
 *     `isDemo = true` para poder eliminarlos con `npm run demo:purge`.
 */
import 'dotenv/config';
import {
  AlertLevel,
  AlertStatus,
  AlertType,
  AssignmentRole,
  AuditAction,
  EntryStatus,
  EntryType,
  FollowUpStatus,
  GuaranteeStatus,
  HandoverLevel,
  HandoverStatus,
  Impact,
  NotificationType,
  PrismaClient,
  Priority,
  ReservationStatus,
  Severity,
  ShiftStatus,
  ShiftType,
  TaskOrigin,
  TaskStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ROLE_KEYS } from '../src/lib/permissions';
import { seedCatalog as seedBaseCatalog } from '../src/domain/catalog';
import { suggestUsername } from '../src/domain/username';
import { plannedWindow } from '../src/domain/shift';

const prisma = new PrismaClient();

function day(offset: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

function at(offset: number, hour: number, minute = 0): Date {
  const date = day(offset);
  date.setHours(hour, minute, 0, 0);
  return date;
}

async function seedCatalog() {
  await seedBaseCatalog(prisma, { hotelName: 'Hotel Costa Serena' });
  console.log('✔ Catálogo base: permisos, roles, áreas y parámetros');
}

async function seedDemo() {
  const password = process.env.SEED_DEMO_PASSWORD ?? 'Demo2024!';
  const passwordHash = await bcrypt.hash(password, 10);

  const roles = await prisma.role.findMany();
  const roleByKey = new Map(roles.map((r) => [r.key, r]));
  const departments = await prisma.department.findMany();
  const dept = (key: string) => departments.find((d) => d.key === key)?.id ?? null;

  /* Las cuentas se identifican por su USUARIO, que es lo único que las
     identifica: no tienen correo. La clave es la de `SEED_DEMO_PASSWORD`. */
  const people = [
    { key: 'admin', name: 'Sofía Reyes', roleKey: ROLE_KEYS.SYSTEM_ADMIN, departmentKey: 'SISTEMAS' },
    { key: 'supervisor', name: 'Marcela Pinto', roleKey: ROLE_KEYS.SUPERVISOR, departmentKey: 'RECEPCION' },
    { key: 'manana', name: 'Diego Alarcón', roleKey: ROLE_KEYS.RECEPTIONIST, departmentKey: 'RECEPCION' },
    { key: 'tarde', name: 'Camila Vera', roleKey: ROLE_KEYS.RECEPTIONIST, departmentKey: 'RECEPCION' },
    { key: 'noche', name: 'Rodrigo Núñez', roleKey: ROLE_KEYS.NIGHT_AUDITOR, departmentKey: 'RECEPCION' },
  ];

  const users: Record<string, { id: string; name: string }> = {};
  for (const person of people) {
    const role = roleByKey.get(person.roleKey);
    if (!role) throw new Error(`Rol no encontrado: ${person.roleKey}`);
    // El upsert se resuelve por USUARIO, que es la identidad de la cuenta.
    const user = await prisma.user.upsert({
      where: { username: suggestUsername(person.name) },
      update: { name: person.name, roleId: role.id, isDemo: true, active: true },
      create: {
        name: person.name,
        username: suggestUsername(person.name),
        passwordHash,
        roleId: role.id,
        departmentId: dept(person.departmentKey),
        isDemo: true,
      },
    });
    users[person.key] = { id: user.id, name: user.name };
  }

  const admin = users['admin']!;
  const supervisor = users['supervisor']!;
  const morning = users['manana']!;
  const evening = users['tarde']!;
  const night = users['noche']!;

  // ----------------------------- Huéspedes ------------------------------
  const guestData = [
    { fullName: 'Familia Moreau', roomNumber: '402', vip: true, language: 'Francés', notes: 'Aniversario de bodas. Prometida amenidad de cortesía.' },
    { fullName: 'Andrés Bustamante', roomNumber: '215', vip: false, language: 'Español', notes: 'Viaje corporativo, requiere factura.' },
    { fullName: 'Helen Whitaker', roomNumber: '318', vip: true, language: 'Inglés', notes: 'Alérgica a plumas: almohadas hipoalergénicas.' },
    { fullName: 'Paula Sanhueza', roomNumber: '107', vip: false, language: 'Español', notes: 'Solicitó cuna adicional.' },
    { fullName: 'Grupo Andes Trekking', roomNumber: '501', vip: false, language: 'Español', notes: 'Grupo de 12 pasajeros, salida temprana.' },
    { fullName: 'Tomás Ferreira', roomNumber: '223', vip: false, language: 'Portugués', notes: 'Traslado al aeropuerto pendiente de confirmar.' },
  ];
  const guests: Record<string, string> = {};
  for (const guest of guestData) {
    const created = await prisma.guestReference.create({
      data: { ...guest, isDemo: true },
    });
    guests[guest.fullName] = created.id;
  }

  // ------------------------------ Reservas ------------------------------
  const reservationData = [
    {
      code: 'RES-10241',
      guest: 'Familia Moreau',
      roomNumber: '402',
      checkIn: at(0, 15),
      checkOut: at(3, 12),
      channel: 'Directo',
      status: ReservationStatus.CONFIRMADA,
      guaranteeStatus: GuaranteeStatus.VALIDADA,
      balanceDue: null,
      requiresAction: true,
      actionNote: 'Preparar decoración de aniversario antes del check-in.',
    },
    {
      code: 'RES-10255',
      guest: 'Andrés Bustamante',
      roomNumber: '215',
      checkIn: at(-1, 16),
      checkOut: at(1, 12),
      channel: 'Booking',
      status: ReservationStatus.EN_CASA,
      guaranteeStatus: GuaranteeStatus.RECHAZADA,
      balanceDue: 184500,
      requiresAction: true,
      actionNote: 'Tarjeta rechazada en pre-autorización. Solicitar medio de pago alternativo.',
    },
    {
      code: 'RES-10260',
      guest: 'Helen Whitaker',
      roomNumber: '318',
      checkIn: at(0, 14),
      checkOut: at(2, 12),
      channel: 'Expedia',
      status: ReservationStatus.PENDIENTE,
      guaranteeStatus: GuaranteeStatus.PENDIENTE,
      balanceDue: null,
      requiresAction: false,
      actionNote: null,
    },
    {
      code: 'RES-10262',
      guest: 'Paula Sanhueza',
      roomNumber: '107',
      checkIn: at(-2, 15),
      checkOut: at(0, 12),
      channel: 'Directo',
      status: ReservationStatus.EN_CASA,
      guaranteeStatus: GuaranteeStatus.VALIDADA,
      balanceDue: 32000,
      requiresAction: false,
      actionNote: null,
    },
    {
      code: 'RES-10270',
      guest: 'Grupo Andes Trekking',
      roomNumber: '501',
      checkIn: at(-1, 18),
      checkOut: at(0, 6),
      channel: 'Agencia',
      status: ReservationStatus.EN_CASA,
      guaranteeStatus: GuaranteeStatus.VALIDADA,
      balanceDue: 0,
      requiresAction: true,
      actionNote: 'Salida anticipada a las 06:00: preparar desayuno para llevar y cuentas cerradas.',
    },
    {
      code: 'RES-10275',
      guest: 'Tomás Ferreira',
      roomNumber: '223',
      checkIn: at(-1, 20),
      checkOut: at(1, 12),
      channel: 'Directo',
      status: ReservationStatus.EN_CASA,
      guaranteeStatus: GuaranteeStatus.VALIDADA,
      balanceDue: null,
      requiresAction: true,
      actionNote: 'Confirmar traslado al aeropuerto para las 09:30 del día de salida.',
    },
    {
      code: 'RES-10281',
      guest: null,
      roomNumber: null,
      checkIn: at(1, 15),
      checkOut: at(4, 12),
      channel: 'Booking',
      status: ReservationStatus.PENDIENTE,
      guaranteeStatus: GuaranteeStatus.PENDIENTE,
      balanceDue: null,
      requiresAction: false,
      actionNote: null,
    },
  ];
  const reservations: Record<string, string> = {};
  for (const reservation of reservationData) {
    const created = await prisma.reservationReference.create({
      data: {
        code: reservation.code,
        guestId: reservation.guest ? guests[reservation.guest]! : null,
        roomNumber: reservation.roomNumber,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        channel: reservation.channel,
        status: reservation.status,
        guaranteeStatus: reservation.guaranteeStatus,
        balanceDue: reservation.balanceDue,
        requiresAction: reservation.requiresAction,
        actionNote: reservation.actionNote,
        isDemo: true,
      },
    });
    reservations[reservation.code] = created.id;
  }

  // ------------------------------- Turnos -------------------------------
  const shiftPlan: Array<{
    offset: number;
    type: ShiftType;
    status: ShiftStatus;
    userId: string;
    support?: string;
  }> = [
    /*
      Con dos franjas fijas y un solo turno en curso a la vez, la demo muestra
      la cadena real: tres turnos cerrados, uno con el cierre EN LA BANDEJA
      esperando a que alguien lo reciba, y ninguno en curso. Así, al entrar por
      primera vez, la primera acción posible es justamente recibir.
    */
    { offset: -2, type: ShiftType.DIA, status: ShiftStatus.CERRADO, userId: morning.id },
    { offset: -1, type: ShiftType.DIA, status: ShiftStatus.CERRADO, userId: evening.id, support: supervisor.id },
    { offset: -1, type: ShiftType.NOCHE, status: ShiftStatus.CERRADO, userId: night.id },
    { offset: 0, type: ShiftType.DIA, status: ShiftStatus.ENTREGA_ENVIADA, userId: morning.id },
  ];

  const shiftIds: Record<string, string> = {};
  for (const plan of shiftPlan) {
    const date = day(plan.offset);
    const window = plannedWindow(date, plan.type);
    const started = plan.status !== ShiftStatus.PROGRAMADO;
    const closed = plan.status === ShiftStatus.CERRADO;
    const shift = await prisma.shift.create({
      data: {
        date,
        type: plan.type,
        status: plan.status,
        plannedStart: window.start,
        plannedEnd: window.end,
        actualStart: started ? window.start : null,
        actualEnd: closed ? window.end : null,
        startedById: started ? plan.userId : null,
        closedById: closed ? plan.userId : null,
        createdById: supervisor.id,
        isDemo: true,
        assignments: {
          create: [
            { userId: plan.userId, role: AssignmentRole.TITULAR },
            ...(plan.support
              ? [{ userId: plan.support, role: AssignmentRole.APOYO }]
              : []),
          ],
        },
      },
    });
    shiftIds[`${plan.offset}:${plan.type}`] = shift.id;
  }

  const shift = (offset: number, type: ShiftType) => shiftIds[`${offset}:${type}`]!;

  // ------------------------- Registros operativos -----------------------
  type EntrySeed = {
    key: string;
    type: EntryType;
    title: string;
    description: string;
    department: string;
    priority: Priority;
    status: EntryStatus;
    createdBy: string;
    ownerId?: string;
    shiftKey: [number, ShiftType];
    occurredAt: Date;
    dueAt?: Date;
    tags?: string[];
    severity?: Severity;
    impact?: Impact;
    immediateAction?: string;
    rootCause?: string;
    resolution?: string;
    guest?: string;
    reservation?: string;
    requiresFollowUp?: boolean;
    category?: string;
  };

  const entrySeeds: EntrySeed[] = [
    {
      key: 'aire-318',
      type: EntryType.INCIDENCIA,
      title: 'Aire acondicionado sin enfriar en habitación 318',
      description:
        'La huésped reporta que el aire acondicionado no enfría desde las 22:00. Se ofreció ventilador de pie y cambio de habitación, que la huésped declinó por el equipaje ya desarmado.',
      department: 'MANTENIMIENTO',
      priority: Priority.ALTA,
      status: EntryStatus.EN_CURSO,
      createdBy: night.id,
      ownerId: morning.id,
      shiftKey: [-1, ShiftType.NOCHE],
      occurredAt: at(-1, 22, 15),
      dueAt: at(0, 12),
      tags: ['climatizacion', 'habitacion'],
      severity: Severity.ALTA,
      impact: Impact.HUESPED,
      immediateAction: 'Se entregó ventilador y se ofreció upgrade sin costo.',
      guest: 'Helen Whitaker',
      reservation: 'RES-10260',
      requiresFollowUp: true,
    },
    {
      key: 'tarjeta-215',
      type: EntryType.INCIDENCIA,
      title: 'Pre-autorización rechazada en habitación 215',
      description:
        'La tarjeta del huésped fue rechazada al intentar pre-autorizar el consumo extra. Se informó al huésped, quien indicó que regularizará el pago al regresar del aeropuerto.',
      department: 'RECEPCION',
      priority: Priority.CRITICA,
      status: EntryStatus.ABIERTO,
      createdBy: evening.id,
      ownerId: evening.id,
      shiftKey: [-1, ShiftType.DIA],
      occurredAt: at(-1, 19, 40),
      dueAt: at(0, 18),
      tags: ['garantia', 'cobro'],
      severity: Severity.CRITICA,
      impact: Impact.ECONOMICO,
      immediateAction: 'Se bloqueó el cargo a la habitación y se avisó a A&B.',
      guest: 'Andrés Bustamante',
      reservation: 'RES-10255',
      requiresFollowUp: true,
    },
    {
      key: 'filtracion-bano',
      type: EntryType.MANTENIMIENTO,
      title: 'Filtración en baño de habitación 107',
      description:
        'Se detecta filtración leve bajo el lavamanos. Housekeeping colocó paños absorbentes y se avisó a Mantenimiento.',
      department: 'MANTENIMIENTO',
      priority: Priority.MEDIA,
      status: EntryStatus.EN_ESPERA,
      createdBy: morning.id,
      ownerId: morning.id,
      shiftKey: [-1, ShiftType.DIA],
      occurredAt: at(-2, 10, 20),
      dueAt: at(-1, 18),
      tags: ['gasfiteria'],
      guest: 'Paula Sanhueza',
      requiresFollowUp: false,
    },
    {
      key: 'aniversario-402',
      type: EntryType.HUESPED,
      title: 'Aniversario de bodas Familia Moreau (hab. 402)',
      description:
        'Llegan hoy a las 15:00 para celebrar su aniversario. Coordinar decoración, espumante de cortesía y tarjeta firmada por la gerencia.',
      department: 'RECEPCION',
      priority: Priority.ALTA,
      status: EntryStatus.ABIERTO,
      createdBy: morning.id,
      ownerId: evening.id,
      shiftKey: [0, ShiftType.DIA],
      occurredAt: at(0, 8, 30),
      dueAt: at(0, 14, 30),
      tags: ['vip', 'celebracion'],
      guest: 'Familia Moreau',
      reservation: 'RES-10241',
      requiresFollowUp: true,
    },
    {
      key: 'traslado-223',
      type: EntryType.HUESPED,
      title: 'Traslado al aeropuerto pendiente de confirmar (hab. 223)',
      description:
        'El huésped solicitó traslado para las 09:30 del día de salida. Falta confirmación de la empresa de transporte.',
      department: 'RECEPCION',
      priority: Priority.MEDIA,
      status: EntryStatus.ABIERTO,
      createdBy: evening.id,
      ownerId: evening.id,
      shiftKey: [-1, ShiftType.DIA],
      occurredAt: at(-1, 20, 10),
      dueAt: at(0, 20),
      tags: ['traslado'],
      guest: 'Tomás Ferreira',
      reservation: 'RES-10275',
      requiresFollowUp: true,
    },
    {
      key: 'salida-grupo',
      type: EntryType.RESERVA,
      title: 'Salida anticipada grupo Andes Trekking (12 pax)',
      description:
        'El grupo sale a las 06:00. Cuentas deben quedar cerradas la noche anterior y desayuno para llevar coordinado con A&B.',
      department: 'RESERVAS',
      priority: Priority.ALTA,
      status: EntryStatus.RESUELTO,
      createdBy: night.id,
      ownerId: night.id,
      shiftKey: [-1, ShiftType.NOCHE],
      occurredAt: at(-1, 23, 30),
      tags: ['grupo', 'salida'],
      resolution: 'Cuentas cerradas a las 04:10 y desayunos entregados a las 05:40.',
      guest: 'Grupo Andes Trekking',
      reservation: 'RES-10270',
    },
    {
      key: 'caja-diferencia',
      type: EntryType.CAJA,
      title: 'Diferencia de caja de $2.000 en cierre de turno tarde',
      description:
        'Al cuadrar la caja se detecta una diferencia de $2.000 a favor. Se deja constancia y se informa a Administración para revisión de comprobantes.',
      department: 'ADMINISTRACION',
      priority: Priority.MEDIA,
      status: EntryStatus.EN_CURSO,
      createdBy: evening.id,
      ownerId: supervisor.id,
      shiftKey: [-1, ShiftType.DIA],
      occurredAt: at(-1, 22, 50),
      dueAt: at(0, 17),
      tags: ['caja', 'cuadratura'],
      requiresFollowUp: true,
    },
    {
      key: 'ruido-piso4',
      type: EntryType.SEGURIDAD,
      title: 'Ruido molesto en piso 4 durante la madrugada',
      description:
        'Dos habitaciones reportan ruido en el pasillo del piso 4 cerca de las 02:00. Seguridad acudió y la situación se normalizó sin incidentes.',
      department: 'SEGURIDAD',
      priority: Priority.MEDIA,
      status: EntryStatus.CERRADO,
      createdBy: night.id,
      ownerId: night.id,
      shiftKey: [-1, ShiftType.NOCHE],
      occurredAt: at(0, 2, 5),
      tags: ['ruido'],
      resolution: 'Se conversó con los huéspedes involucrados; sin reincidencia en la ronda siguiente.',
    },
    {
      key: 'pms-lento',
      type: EntryType.SISTEMAS,
      title: 'PMS con lentitud intermitente al generar facturas',
      description:
        'El PMS demora entre 20 y 40 segundos al emitir documentos. Se reportó al proveedor con número de ticket 48219.',
      department: 'SISTEMAS',
      priority: Priority.ALTA,
      status: EntryStatus.EN_ESPERA,
      createdBy: morning.id,
      ownerId: admin.id,
      shiftKey: [0, ShiftType.DIA],
      occurredAt: at(0, 9, 15),
      tags: ['pms', 'proveedor'],
      requiresFollowUp: true,
    },
    {
      key: 'toallas',
      type: EntryType.HOUSEKEEPING,
      title: 'Faltante de toallas de piscina en bodega de piso 1',
      description:
        'Quedan 14 toallas de piscina disponibles. Housekeeping solicita reposición desde lavandería antes del mediodía.',
      department: 'HOUSEKEEPING',
      priority: Priority.BAJA,
      status: EntryStatus.ABIERTO,
      createdBy: morning.id,
      shiftKey: [0, ShiftType.DIA],
      occurredAt: at(0, 9, 40),
      dueAt: at(0, 12),
      tags: ['insumos'],
    },
    {
      key: 'desayuno-tardio',
      type: EntryType.AYB,
      title: 'Reclamo por demora en desayuno buffet',
      description:
        'Dos huéspedes reportan demora en la reposición del buffet entre 08:30 y 09:00. Se ofreció disculpa y café de cortesía.',
      department: 'AYB',
      priority: Priority.MEDIA,
      status: EntryStatus.RESUELTO,
      createdBy: morning.id,
      ownerId: morning.id,
      shiftKey: [0, ShiftType.DIA],
      occurredAt: at(0, 9, 5),
      tags: ['reclamo', 'desayuno'],
      resolution: 'Se reforzó la dotación del buffet a partir de las 08:00 según acuerdo con A&B.',
    },
    {
      key: 'novedad-llaves',
      type: EntryType.NOVEDAD,
      title: 'Codificador de llaves reiniciado tras error de lectura',
      description:
        'El codificador presentó error E-04 al emitir llaves. Se reinició el equipo y volvió a operar con normalidad. Se deja constancia para seguimiento si se repite.',
      department: 'RECEPCION',
      priority: Priority.BAJA,
      status: EntryStatus.CERRADO,
      createdBy: evening.id,
      shiftKey: [-1, ShiftType.DIA],
      occurredAt: at(-1, 17, 25),
      tags: ['llaves', 'equipos'],
      resolution: 'Equipo operativo tras reinicio. Sin reincidencia durante el turno.',
    },
    {
      key: 'auditoria-nocturna',
      type: EntryType.NOVEDAD,
      title: 'Cierre de auditoría nocturna sin anomalías',
      description:
        'Se ejecutó el cierre diario del PMS. Cuadratura de ingresos correcta, 3 habitaciones con cargos pendientes revisados y conciliados.',
      department: 'RECEPCION',
      priority: Priority.BAJA,
      status: EntryStatus.CERRADO,
      createdBy: night.id,
      shiftKey: [-1, ShiftType.NOCHE],
      occurredAt: at(0, 4, 30),
      tags: ['cierre-diario', 'auditoria'],
      resolution: 'Cierre ejecutado y respaldado. Informe enviado a Administración.',
    },
    {
      key: 'luminaria',
      type: EntryType.MANTENIMIENTO,
      title: 'Luminaria intermitente en pasillo del piso 2',
      description:
        'La luminaria frente a la habitación 208 parpadea. Mantenimiento programó el recambio del balastro.',
      department: 'MANTENIMIENTO',
      priority: Priority.BAJA,
      status: EntryStatus.ABIERTO,
      createdBy: night.id,
      shiftKey: [-1, ShiftType.NOCHE],
      occurredAt: at(-2, 23, 10),
      tags: ['electricidad'],
    },
  ];

  const entryIds: Record<string, { id: string; seq: number }> = {};
  for (const seed of entrySeeds) {
    const created = await prisma.operationalEntry.create({
      data: {
        type: seed.type,
        title: seed.title,
        description: seed.description,
        category: seed.category ?? null,
        departmentId: dept(seed.department),
        priority: seed.priority,
        status: seed.status,
        createdById: seed.createdBy,
        ownerId: seed.ownerId ?? null,
        shiftId: shift(seed.shiftKey[0], seed.shiftKey[1]),
        occurredAt: seed.occurredAt,
        dueAt: seed.dueAt ?? null,
        tags: seed.tags ?? [],
        requiresFollowUp: seed.requiresFollowUp ?? false,
        severity: seed.severity ?? null,
        impact: seed.impact ?? null,
        immediateAction: seed.immediateAction ?? null,
        rootCause: seed.rootCause ?? null,
        resolution: seed.resolution ?? null,
        closedAt: seed.status === EntryStatus.CERRADO ? seed.occurredAt : null,
        closedById: seed.status === EntryStatus.CERRADO ? seed.createdBy : null,
        guestId: seed.guest ? guests[seed.guest]! : null,
        reservationId: seed.reservation ? reservations[seed.reservation]! : null,
        isDemo: true,
      },
    });
    entryIds[seed.key] = { id: created.id, seq: created.seq };

    await prisma.auditLog.create({
      data: {
        entity: 'OperationalEntry',
        entityId: created.id,
        action: AuditAction.CREAR,
        summary: `${seed.type} #${created.seq}: ${seed.title}`,
        userId: seed.createdBy,
        after: { title: seed.title, status: seed.status, priority: seed.priority },
        createdAt: seed.occurredAt,
        isDemo: true,
      },
    });
    if (seed.status === EntryStatus.CERRADO || seed.status === EntryStatus.RESUELTO) {
      await prisma.auditLog.create({
        data: {
          entity: 'OperationalEntry',
          entityId: created.id,
          action: AuditAction.CERRAR,
          summary: `Registro #${created.seq} cerrado`,
          userId: seed.createdBy,
          before: { status: EntryStatus.EN_CURSO },
          after: { status: seed.status, resolution: seed.resolution },
          createdAt: new Date(seed.occurredAt.getTime() + 3600_000),
          isDemo: true,
        },
      });
    }
  }

  // ------------------------------- Tareas -------------------------------
  const taskSeeds = [
    {
      title: 'Confirmar traslado al aeropuerto con la empresa de transporte',
      description: 'Confirmar móvil para las 09:30 y dejar constancia del número de conductor.',
      assigneeId: evening.id,
      priority: Priority.ALTA,
      status: TaskStatus.PENDIENTE,
      dueAt: at(0, 19),
      department: 'RECEPCION',
      entryKey: 'traslado-223',
      origin: TaskOrigin.REGISTRO,
      createdBy: evening.id,
      checklist: ['Llamar a la empresa de transporte', 'Registrar patente y conductor', 'Informar al huésped'],
    },
    {
      title: 'Solicitar medio de pago alternativo a huésped de hab. 215',
      description: 'La tarjeta fue rechazada. Coordinar transferencia o efectivo antes del check-out.',
      assigneeId: evening.id,
      priority: Priority.CRITICA,
      status: TaskStatus.EN_CURSO,
      dueAt: at(-1, 23),
      department: 'RECEPCION',
      entryKey: 'tarjeta-215',
      origin: TaskOrigin.INCIDENCIA,
      createdBy: supervisor.id,
      checklist: ['Contactar al huésped', 'Registrar nuevo medio de pago', 'Liberar bloqueo de cargos'],
    },
    {
      title: 'Reparar aire acondicionado de habitación 318',
      description: 'Mantenimiento debe revisar el equipo y confirmar temperatura antes del mediodía.',
      assigneeId: morning.id,
      priority: Priority.ALTA,
      status: TaskStatus.BLOQUEADA,
      dueAt: at(0, 12),
      department: 'MANTENIMIENTO',
      entryKey: 'aire-318',
      origin: TaskOrigin.INCIDENCIA,
      createdBy: night.id,
      blockedReason: 'Falta repuesto de condensador; llega con el proveedor a las 11:00.',
      checklist: ['Revisar unidad', 'Cambiar filtro', 'Confirmar temperatura con la huésped'],
    },
    {
      title: 'Preparar decoración de aniversario hab. 402',
      description: 'Coordinar con Housekeeping y A&B: decoración, espumante y tarjeta de gerencia.',
      assigneeId: evening.id,
      priority: Priority.ALTA,
      status: TaskStatus.PENDIENTE,
      dueAt: at(0, 14, 30),
      department: 'RECEPCION',
      entryKey: 'aniversario-402',
      origin: TaskOrigin.REGISTRO,
      createdBy: morning.id,
      checklist: ['Solicitar decoración a Housekeeping', 'Pedir espumante a A&B', 'Imprimir tarjeta'],
    },
    {
      title: 'Reponer toallas de piscina en bodega piso 1',
      description: 'Solicitar 40 toallas a lavandería y registrar la recepción.',
      assigneeId: morning.id,
      priority: Priority.BAJA,
      status: TaskStatus.COMPLETADA,
      dueAt: at(0, 12),
      department: 'HOUSEKEEPING',
      entryKey: 'toallas',
      origin: TaskOrigin.REGISTRO,
      createdBy: morning.id,
      checklist: [],
    },
    {
      title: 'Cerrar cuentas del grupo Andes Trekking',
      description: 'Dejar cuentas cerradas y facturas emitidas antes de la salida de las 06:00.',
      assigneeId: night.id,
      priority: Priority.ALTA,
      status: TaskStatus.COMPLETADA,
      dueAt: at(0, 5),
      department: 'RECEPCION',
      entryKey: 'salida-grupo',
      origin: TaskOrigin.REGISTRO,
      createdBy: night.id,
      checklist: [],
    },
    {
      title: 'Revisar comprobantes por diferencia de caja',
      description: 'Contrastar boletas y vouchers del turno tarde para ubicar la diferencia de $2.000.',
      assigneeId: supervisor.id,
      priority: Priority.MEDIA,
      status: TaskStatus.PENDIENTE,
      dueAt: at(0, 17),
      department: 'ADMINISTRACION',
      entryKey: 'caja-diferencia',
      origin: TaskOrigin.REGISTRO,
      createdBy: evening.id,
      checklist: ['Revisar vouchers', 'Revisar boletas manuales', 'Informar resultado'],
    },
    {
      title: 'Escalar ticket 48219 con proveedor del PMS',
      description: 'Pedir tiempo de respuesta comprometido y dejar registro del contacto.',
      assigneeId: morning.id,
      priority: Priority.MEDIA,
      status: TaskStatus.PENDIENTE,
      dueAt: at(1, 11),
      department: 'SISTEMAS',
      entryKey: 'pms-lento',
      origin: TaskOrigin.REGISTRO,
      createdBy: morning.id,
      checklist: [],
    },
    {
      title: 'Recambio de balastro en pasillo piso 2',
      description: 'Coordinar con Mantenimiento el recambio de la luminaria frente a la 208.',
      assigneeId: morning.id,
      priority: Priority.BAJA,
      status: TaskStatus.PENDIENTE,
      dueAt: at(-1, 18),
      department: 'MANTENIMIENTO',
      entryKey: 'luminaria',
      origin: TaskOrigin.REGISTRO,
      createdBy: night.id,
      checklist: [],
    },
    {
      title: 'Verificar almohadas hipoalergénicas en hab. 318',
      description: 'La huésped es alérgica a plumas: confirmar el set correcto antes de su regreso.',
      assigneeId: evening.id,
      priority: Priority.MEDIA,
      status: TaskStatus.PENDIENTE,
      dueAt: at(0, 16),
      department: 'HOUSEKEEPING',
      entryKey: null,
      origin: TaskOrigin.MANUAL,
      createdBy: supervisor.id,
      checklist: [],
    },
  ] as const;

  const taskIds: Record<string, string> = {};
  for (const seed of taskSeeds) {
    const entry = seed.entryKey ? entryIds[seed.entryKey] : null;
    const created = await prisma.task.create({
      data: {
        title: seed.title,
        description: seed.description,
        assigneeId: seed.assigneeId,
        priority: seed.priority,
        status: seed.status,
        dueAt: seed.dueAt,
        departmentId: dept(seed.department),
        entryId: entry?.id ?? null,
        origin: seed.origin,
        createdById: seed.createdBy,
        blockedReason: 'blockedReason' in seed ? seed.blockedReason : null,
        completedAt: seed.status === TaskStatus.COMPLETADA ? seed.dueAt : null,
        completedById: seed.status === TaskStatus.COMPLETADA ? seed.assigneeId : null,
        isDemo: true,
        checklist:
          seed.checklist.length > 0
            ? {
                create: seed.checklist.map((text, index) => ({
                  text,
                  order: index,
                  done: seed.status === TaskStatus.COMPLETADA,
                })),
              }
            : undefined,
      },
    });
    taskIds[seed.title] = created.id;

    await prisma.auditLog.create({
      data: {
        entity: 'Task',
        entityId: created.id,
        action: AuditAction.CREAR,
        summary: `Tarea #${created.seq}: ${seed.title}`,
        userId: seed.createdBy,
        after: { title: seed.title, assigneeId: seed.assigneeId, priority: seed.priority },
        createdAt: new Date(seed.dueAt.getTime() - 4 * 3600_000),
        isDemo: true,
      },
    });
  }

  // ----------------------------- Seguimientos ---------------------------
  const followUpSeeds = [
    {
      entryKey: 'aire-318',
      action: 'Se coordinó visita de Mantenimiento con la huésped para las 10:00.',
      result: 'La huésped acepta la visita y permanecerá en la habitación.',
      nextAction: 'Confirmar temperatura del equipo y registrar conformidad de la huésped.',
      scheduledAt: at(0, 12),
      ownerId: morning.id,
      createdBy: night.id,
      status: FollowUpStatus.PENDIENTE,
    },
    {
      entryKey: 'tarjeta-215',
      action: 'Se contactó al huésped por teléfono para regularizar el medio de pago.',
      result: 'No contesta. Se dejó mensaje en la habitación.',
      nextAction: 'Reintentar contacto y, si no responde, escalar a Administración.',
      scheduledAt: at(-1, 23, 30),
      ownerId: evening.id,
      createdBy: evening.id,
      status: FollowUpStatus.VENCIDO,
    },
    {
      entryKey: 'caja-diferencia',
      action: 'Se envió el detalle de la diferencia a Administración.',
      result: 'Administración acusa recibo y revisará los comprobantes.',
      nextAction: 'Obtener respuesta formal de Administración sobre el origen de la diferencia.',
      scheduledAt: at(1, 12),
      ownerId: supervisor.id,
      createdBy: evening.id,
      status: FollowUpStatus.PENDIENTE,
    },
    {
      entryKey: 'pms-lento',
      action: 'Ticket 48219 abierto con el proveedor del PMS.',
      result: 'El proveedor solicita logs del servidor de facturación.',
      nextAction: 'Enviar logs y pedir plazo comprometido de solución.',
      scheduledAt: at(1, 10),
      ownerId: morning.id,
      createdBy: morning.id,
      status: FollowUpStatus.PENDIENTE,
    },
    {
      entryKey: 'traslado-223',
      action: 'Se solicitó cotización y disponibilidad a la empresa de transporte.',
      result: 'Confirmación pendiente por parte de la empresa.',
      nextAction: 'Confirmar móvil y avisar al huésped.',
      scheduledAt: at(0, 19),
      ownerId: evening.id,
      createdBy: evening.id,
      status: FollowUpStatus.PENDIENTE,
    },
    {
      entryKey: 'desayuno-tardio',
      action: 'Se acordó con A&B reforzar la dotación del buffet desde las 08:00.',
      result: 'Acuerdo aplicado y verificado al día siguiente.',
      nextAction: null,
      scheduledAt: at(0, 9),
      ownerId: morning.id,
      createdBy: morning.id,
      status: FollowUpStatus.CUMPLIDO,
    },
  ];

  for (const seed of followUpSeeds) {
    const entry = entryIds[seed.entryKey]!;
    const created = await prisma.followUp.create({
      data: {
        entryId: entry.id,
        action: seed.action,
        result: seed.result,
        nextAction: seed.nextAction,
        scheduledAt: seed.scheduledAt,
        ownerId: seed.ownerId,
        createdById: seed.createdBy,
        status: seed.status,
        completedAt: seed.status === FollowUpStatus.CUMPLIDO ? seed.scheduledAt : null,
        isDemo: true,
      },
    });
    await prisma.auditLog.create({
      data: {
        entity: 'FollowUp',
        entityId: created.id,
        action: AuditAction.CREAR,
        summary: `Seguimiento creado: ${seed.action}`,
        userId: seed.createdBy,
        createdAt: seed.scheduledAt,
        isDemo: true,
      },
    });
  }

  // ------------------------------ Comentarios ---------------------------
  const commentSeeds = [
    { entryKey: 'aire-318', authorId: morning.id, body: 'Mantenimiento confirma visita a las 10:00. Aviso a la huésped por teléfono.' },
    { entryKey: 'aire-318', authorId: supervisor.id, body: 'Si no queda resuelto antes del mediodía, ofrecer cambio a la 320 con upgrade sin costo.' },
    { entryKey: 'tarjeta-215', authorId: supervisor.id, body: 'Prioridad máxima: no permitir nuevos cargos a la habitación hasta regularizar.' },
    { entryKey: 'caja-diferencia', authorId: supervisor.id, body: 'Revisé los vouchers del turno: falta contrastar las boletas manuales de A&B.' },
    { entryKey: 'aniversario-402', authorId: evening.id, body: 'Decoración solicitada a Housekeeping. Espumante reservado en bodega de A&B.' },
    { entryKey: 'pms-lento', authorId: admin.id, body: 'Se reinició el servicio de facturación. Si la lentitud persiste, escalar a soporte nivel 2.' },
    { entryKey: 'filtracion-bano', authorId: morning.id, body: 'Mantenimiento cambió el sifón. Se mantiene en observación 24 horas.' },
    { entryKey: 'traslado-223', authorId: evening.id, body: 'La empresa confirma disponibilidad pero pide confirmar 2 horas antes.' },
  ];
  for (const seed of commentSeeds) {
    const entry = entryIds[seed.entryKey]!;
    await prisma.comment.create({
      data: { entryId: entry.id, authorId: seed.authorId, body: seed.body, isDemo: true },
    });
  }

  // ------------------------------- Alertas ------------------------------
  await prisma.alert.create({
    data: {
      type: AlertType.SALIDA_ANTICIPADA,
      level: AlertLevel.ATENCION,
      title: 'Salida anticipada 06:00 — grupo Andes Trekking (12 pax)',
      message: 'Cuentas cerradas y desayuno para llevar coordinado. Verificar llaves devueltas.',
      status: AlertStatus.VISTA,
      dueAt: at(0, 6),
      reservationId: reservations['RES-10270']!,
      guestId: guests['Grupo Andes Trekking']!,
      createdById: night.id,
      acknowledgedById: night.id,
      acknowledgedAt: at(0, 3),
      auto: false,
      isDemo: true,
    },
  });
  await prisma.alert.create({
    data: {
      type: AlertType.TRASLADO_PENDIENTE,
      level: AlertLevel.ATENCION,
      title: 'Traslado al aeropuerto sin confirmar — hab. 223',
      message: 'Confirmar móvil para las 09:30 con la empresa de transporte.',
      status: AlertStatus.NUEVA,
      dueAt: at(0, 19),
      entryId: entryIds['traslado-223']!.id,
      reservationId: reservations['RES-10275']!,
      guestId: guests['Tomás Ferreira']!,
      createdById: evening.id,
      auto: false,
      isDemo: true,
    },
  });

  // ------------------------------ Entregas ------------------------------
  type HandoverSeed = {
    fromKey: [number, ShiftType];
    toKey: [number, ShiftType] | null;
    status: HandoverStatus;
    issuedById: string;
    issuedAt: Date;
    receivedById?: string;
    receivedAt?: Date;
    notes: string;
    receiverObservations?: string;
    items: Array<{ level: HandoverLevel; section: string; title: string; detail: string }>;
  };

  const handoverSeeds: HandoverSeed[] = [
    {
      fromKey: [-2, ShiftType.DIA],
      toKey: [-1, ShiftType.DIA],
      status: HandoverStatus.RECIBIDA,
      issuedById: morning.id,
      issuedAt: at(-1, 14, 45),
      receivedById: evening.id,
      receivedAt: at(-1, 15, 5),
      notes: 'Turno tranquilo. Pendiente la filtración de la 107 y la reposición de insumos de piscina.',
      receiverObservations: 'Recibido conforme. Reviso la 107 con Mantenimiento.',
      items: [
        {
          level: HandoverLevel.IMPORTANTE,
          section: 'Mantenimiento',
          title: 'Filtración en baño de habitación 107',
          detail: 'Paños absorbentes colocados. Mantenimiento comprometió revisión durante la tarde.',
        },
        {
          level: HandoverLevel.INFORMATIVO,
          section: 'Novedades activas',
          title: 'Ocupación proyectada 78% para la noche',
          detail: '14 llegadas y 9 salidas confirmadas.',
        },
      ],
    },
    {
      fromKey: [-1, ShiftType.DIA],
      toKey: [-1, ShiftType.NOCHE],
      status: HandoverStatus.RECIBIDA,
      issuedById: evening.id,
      issuedAt: at(-1, 22, 55),
      receivedById: night.id,
      receivedAt: at(-1, 23, 10),
      notes: 'Dos asuntos calientes: tarjeta rechazada de la 215 y diferencia de caja de $2.000.',
      receiverObservations: 'Recibido. Insistiré con la 215 durante la madrugada.',
      items: [
        {
          level: HandoverLevel.URGENTE,
          section: 'Incidencias abiertas',
          title: 'Pre-autorización rechazada en habitación 215',
          detail: 'Cargos bloqueados. Huésped no responde. Escalar a Administración si sigue sin respuesta.',
        },
        {
          level: HandoverLevel.URGENTE,
          section: 'Cobros pendientes',
          title: 'Andrés Bustamante · hab. 215 · saldo 184.500',
          detail: 'Reserva RES-10255 con garantía rechazada.',
        },
        {
          level: HandoverLevel.IMPORTANTE,
          section: 'Novedades activas',
          title: 'Diferencia de caja de $2.000 en cierre de turno tarde',
          detail: 'Informada a Administración. Revisión de comprobantes pendiente.',
        },
        {
          level: HandoverLevel.IMPORTANTE,
          section: 'Solicitudes de huéspedes',
          title: 'Traslado al aeropuerto pendiente de confirmar (hab. 223)',
          detail: 'Empresa de transporte pide confirmar con 2 horas de anticipación.',
        },
      ],
    },
    {
      fromKey: [-1, ShiftType.NOCHE],
      toKey: [0, ShiftType.DIA],
      status: HandoverStatus.RECIBIDA,
      issuedById: night.id,
      issuedAt: at(0, 6, 40),
      receivedById: morning.id,
      receivedAt: at(0, 7, 5),
      notes: 'Auditoría nocturna cerrada sin anomalías. La 318 sigue sin aire acondicionado.',
      receiverObservations: 'Recibido conforme. Priorizo la 318 con Mantenimiento.',
      items: [
        {
          level: HandoverLevel.URGENTE,
          section: 'Incidencias abiertas',
          title: 'Aire acondicionado sin enfriar en habitación 318',
          detail: 'Huésped VIP alérgica a plumas. Ventilador entregado. Comprometida visita a las 10:00.',
        },
        {
          level: HandoverLevel.URGENTE,
          section: 'Cobros pendientes',
          title: 'Andrés Bustamante · hab. 215 · saldo 184.500',
          detail: 'Sigue sin regularizar. Mensaje dejado en la habitación.',
        },
        {
          level: HandoverLevel.IMPORTANTE,
          section: 'Novedades activas',
          title: 'Cierre de auditoría nocturna sin anomalías',
          detail: 'Cuadratura correcta. Informe enviado a Administración.',
        },
        {
          level: HandoverLevel.INFORMATIVO,
          section: 'Novedades activas',
          title: 'Ruido molesto en piso 4 resuelto',
          detail: 'Seguridad intervino a las 02:05. Sin reincidencia.',
        },
      ],
    },
    {
      fromKey: [0, ShiftType.DIA],
      // Sin destino: está en la bandeja. El destino lo escribe quien reciba.
      toKey: null,
      status: HandoverStatus.ENVIADA,
      issuedById: morning.id,
      issuedAt: at(0, 14, 40),
      notes:
        'Prioridad de la tarde: llegada VIP de la Familia Moreau (402) y regularizar el pago de la 215. La 318 queda en manos de Mantenimiento con repuesto en camino.',
      items: [
        {
          level: HandoverLevel.URGENTE,
          section: 'Incidencias abiertas',
          title: 'Pre-autorización rechazada en habitación 215',
          detail: 'Crítica. Cargos bloqueados. Contactar al huésped a su regreso y registrar nuevo medio de pago.',
        },
        {
          level: HandoverLevel.URGENTE,
          section: 'Incidencias abiertas',
          title: 'Aire acondicionado sin enfriar en habitación 318',
          detail: 'Tarea bloqueada esperando repuesto de condensador (llega 11:00). Confirmar con la huésped.',
        },
        {
          level: HandoverLevel.URGENTE,
          section: 'Tareas pendientes',
          title: 'Solicitar medio de pago alternativo a huésped de hab. 215',
          detail: 'VENCIDA desde ayer 23:00. Asignada a Camila Vera.',
        },
        {
          level: HandoverLevel.IMPORTANTE,
          section: 'Solicitudes de huéspedes',
          title: 'Aniversario de bodas Familia Moreau (hab. 402)',
          detail: 'Llegan a las 15:00. Decoración, espumante y tarjeta de gerencia antes del check-in.',
        },
        {
          level: HandoverLevel.IMPORTANTE,
          section: 'Tareas pendientes',
          title: 'Confirmar traslado al aeropuerto con la empresa de transporte',
          detail: 'Vence hoy 19:00. Confirmar móvil para las 09:30 de mañana.',
        },
        {
          level: HandoverLevel.IMPORTANTE,
          section: 'Garantías pendientes',
          title: 'Helen Whitaker · hab. 318 · garantía pendiente',
          detail: 'Reserva RES-10260 sin garantía válida registrada.',
        },
        {
          level: HandoverLevel.IMPORTANTE,
          section: 'Seguimientos próximos',
          title: 'Reintentar contacto con huésped de la 215',
          detail: 'VENCIDO desde ayer 23:30. Responsable: Camila Vera.',
        },
        {
          level: HandoverLevel.INFORMATIVO,
          section: 'Novedades activas',
          title: 'PMS con lentitud intermitente al generar facturas',
          detail: 'Ticket 48219 abierto con el proveedor. Emitir documentos con margen de tiempo.',
        },
        {
          level: HandoverLevel.INFORMATIVO,
          section: 'Novedades activas',
          title: 'Reclamo por demora en desayuno buffet resuelto',
          detail: 'A&B refuerza dotación desde las 08:00.',
        },
      ],
    },
  ];

  for (const seed of handoverSeeds) {
    const created = await prisma.shiftHandover.create({
      data: {
        fromShiftId: shift(seed.fromKey[0], seed.fromKey[1]),
        toShiftId: seed.toKey ? shift(seed.toKey[0], seed.toKey[1]) : null,
        status: seed.status,
        issuedById: seed.issuedById,
        issuedAt: seed.issuedAt,
        receivedById: seed.receivedById ?? null,
        receivedAt: seed.receivedAt ?? null,
        notes: seed.notes,
        receiverObservations: seed.receiverObservations ?? null,
        isDemo: true,
        snapshot: {
          generatedAt: seed.issuedAt.toISOString(),
          counts: {
            urgente: seed.items.filter((i) => i.level === HandoverLevel.URGENTE).length,
            importante: seed.items.filter((i) => i.level === HandoverLevel.IMPORTANTE).length,
            informativo: seed.items.filter((i) => i.level === HandoverLevel.INFORMATIVO).length,
          },
          items: seed.items,
        },
        items: {
          create: seed.items.map((item, index) => ({
            level: item.level,
            section: item.section,
            title: item.title,
            detail: item.detail,
            order: index,
          })),
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        entity: 'ShiftHandover',
        entityId: created.id,
        action: AuditAction.TURNO_ENTREGAR,
        summary: `Entrega enviada (${seed.items.length} puntos)`,
        userId: seed.issuedById,
        createdAt: seed.issuedAt,
        isDemo: true,
      },
    });
    if (seed.receivedById && seed.receivedAt) {
      await prisma.auditLog.create({
        data: {
          entity: 'ShiftHandover',
          entityId: created.id,
          action: AuditAction.TURNO_RECIBIR,
          summary: 'Entrega recibida y confirmada',
          userId: seed.receivedById,
          createdAt: seed.receivedAt,
          isDemo: true,
        },
      });
    }
  }

  // Notificación de entrega disponible para el turno tarde.
  await prisma.notification.create({
    data: {
      userId: evening.id,
      type: NotificationType.ENTREGA_DISPONIBLE,
      title: 'Entrega de turno disponible',
      body: 'Diego Alarcón envió la entrega del turno mañana. Confírmala al iniciar tu turno.',
      link: '/turno',
      entity: 'ShiftHandover',
      isDemo: true,
    },
  });
  await prisma.notification.create({
    data: {
      userId: evening.id,
      type: NotificationType.TAREA_VENCIDA,
      title: 'Tarea vencida: solicitar medio de pago alternativo (hab. 215)',
      body: 'Venció ayer a las 23:00 y sigue abierta.',
      link: '/tareas',
      entity: 'Task',
      isDemo: true,
    },
  });

  console.log('✔ Datos demo: 5 usuarios, 7 turnos, 4 entregas, 14 registros, 10 tareas, 6 seguimientos');
  console.log(`  Contraseña de los usuarios demo: ${password}`);
}

async function main() {
  await seedCatalog();
  await seedDemo();
}

main()
  .catch((error) => {
    console.error('✖ Error al ejecutar la semilla', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
