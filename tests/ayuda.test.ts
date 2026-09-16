import { describe, expect, it } from 'vitest';
import {
  HELP_ACTIONS,
  HELP_TOPICS,
  searchHelp,
  tutorialSteps,
  visibleTopics,
} from '@/domain/help';
import { ROLE_PERMISSIONS, ROLE_KEYS, type PermissionKey } from '@/lib/permissions';

const RECEPCION = [...ROLE_PERMISSIONS[ROLE_KEYS.RECEPTIONIST]] as PermissionKey[];
const SUPERVISOR = [...ROLE_PERMISSIONS[ROLE_KEYS.SUPERVISOR]] as PermissionKey[];

/**
 * La central de ayuda es documentación, no un modelo que adivina.
 *
 * Estas pruebas cuidan tres cosas: que nadie vea el procedimiento de algo que
 * no puede hacer, que la búsqueda encuentre lo que alguien del mesón
 * escribiría, y que **ninguna acción ejecutable sea irreversible**.
 */
describe('central de ayuda', () => {
  it('ninguna acción ejecutable es irreversible', () => {
    /*
      Es la regla que no se puede romper. Confirmar una salida, un check-in o
      un arqueo son decisiones que firma una persona: si alguna apareciera
      acá, la ayuda podría operar el mesón por su cuenta.
    */
    const PROHIBIDAS = ['room.manage', 'key.assign', 'shift.receive', 'shift.close'];
    for (const [key, action] of Object.entries(HELP_ACTIONS)) {
      expect(PROHIBIDAS, `la acción «${key}» usa un permiso operativo`).not.toContain(
        action.permission,
      );
    }
  });

  it('cada acción de un procedimiento existe en el catálogo', () => {
    for (const topic of HELP_TOPICS) {
      if (!topic.action) continue;
      expect(HELP_ACTIONS[topic.action], `${topic.id} apunta a una acción inexistente`).toBeDefined();
    }
  });

  it('un recepcionista no ve procedimientos que no puede ejecutar', () => {
    const visibles = visibleTopics(RECEPCION).map((topic) => topic.id);

    // No emite comunicados, no crea usuarios, no programa turnos.
    expect(visibles).not.toContain('comunicado');
    expect(visibles).not.toContain('usuario-nuevo');
    expect(visibles).not.toContain('turno-largo');
    // Pero sí toma turno y registra incidencias.
    expect(visibles).toContain('tomar-turno');
    expect(visibles).toContain('incidencia');
  });

  it('un supervisor sí ve el comunicado y el reseteo de habitación', () => {
    const visibles = visibleTopics(SUPERVISOR).map((topic) => topic.id);
    expect(visibles).toContain('comunicado');
    expect(visibles).toContain('habitacion-atascada');
  });

  it('encuentra por palabras del mesón, con o sin tilde', () => {
    for (const consulta of ['caja', 'arqueo', 'dinero', 'divisa']) {
      const ids = searchHelp(consulta, SUPERVISOR).map((topic) => topic.id);
      expect(ids, `«${consulta}» no encontró la caja`).toContain('recibir-caja');
    }
    // Sin tilde y en mayúsculas.
    expect(searchHelp('GARANTIA', SUPERVISOR).map((t) => t.id)).toContain('garantia');
    expect(searchHelp('garantía', SUPERVISOR).map((t) => t.id)).toContain('garantia');
  });

  it('encuentra por el problema, no sólo por el nombre de la función', () => {
    // Alguien atascado no busca «resetear»: busca lo que le pasa.
    const ids = searchHelp('no deja confirmar', SUPERVISOR).map((topic) => topic.id);
    expect(ids.slice(0, 2)).toContain('habitacion-atascada');
  });

  it('quien está atascado y no puede resolverlo recibe a quién avisar', () => {
    /*
      Lo encontró una prueba en navegador: un recepcionista que buscaba «no
      deja confirmar» recibía «¿Cómo tomo un turno?», porque el reseteo está
      filtrado por un permiso que él no tiene. Quien está atascado necesita
      saber qué hacer, aunque no sea él quien lo resuelva.
    */
    const ids = searchHelp('no deja confirmar', RECEPCION).map((topic) => topic.id);
    expect(ids[0]).toBe('atascado-sin-permiso');

    // Y sigue sin ver el procedimiento que no puede ejecutar.
    expect(ids).not.toContain('habitacion-atascada');
  });

  it('la pregunta pesa más que una mención de paso', () => {
    const ids = searchHelp('llaves', SUPERVISOR).map((topic) => topic.id);
    // Varios procedimientos mencionan llaves; el de llaves va primero.
    expect(ids[0]).toBe('llaves-sin-asignar');
  });

  it('sin consulta muestra el índice, no una pantalla vacía', () => {
    expect(searchHelp('', RECEPCION)).toEqual(visibleTopics(RECEPCION));
    expect(searchHelp('  ', RECEPCION).length).toBeGreaterThan(0);
  });

  it('una búsqueda sin resultados devuelve vacío en vez de inventar', () => {
    expect(searchHelp('zzzqqq', SUPERVISOR)).toEqual([]);
  });

  it('el tutorial es corto y adaptado al rol', () => {
    const recepcion = tutorialSteps(RECEPCION);
    expect(recepcion.length).toBeGreaterThan(0);
    // Un recorrido de quince pasos no lo termina nadie.
    expect(recepcion.length).toBeLessThanOrEqual(6);
    // Y sólo incluye lo que esa persona puede hacer.
    for (const step of recepcion) {
      if (!step.anyOf) continue;
      expect(step.anyOf.some((p) => RECEPCION.includes(p))).toBe(true);
    }
  });

  it('todo procedimiento tiene pasos y palabras de búsqueda', () => {
    for (const topic of HELP_TOPICS) {
      expect(topic.steps.length, `${topic.id} sin pasos`).toBeGreaterThan(0);
      expect(topic.keywords.length, `${topic.id} sin palabras clave`).toBeGreaterThan(2);
      expect(topic.question.endsWith('?'), `${topic.id} no pregunta nada`).toBe(true);
    }
  });

  it('los identificadores no se repiten', () => {
    const ids = HELP_TOPICS.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
