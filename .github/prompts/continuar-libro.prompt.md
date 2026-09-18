---
mode: agent
description: Retoma el Libro Operativo desde el último relevo compartido y continúa con ejecución, pruebas y trazabilidad.
---

Retoma el desarrollo del Libro Operativo de Recepción.

Primero lee:
- `.github/copilot-instructions.md`
- `AGENTS.md`
- `PROJECT_CONTEXT.md`
- `docs/AGENT_HANDOFF.md`

Después:
1. comprueba rama y estado de Git;
2. verifica que desarrollo no apunta a Neon Production;
3. resume en máximo cinco líneas dónde quedó el trabajo;
4. continúa desde `Siguiente acción` del handoff, salvo que el estado real del repo la vuelva obsoleta;
5. ejecuta las pruebas necesarias;
6. actualiza `docs/AGENT_HANDOFF.md` antes de terminar.

No reconstruyas módulos que ya funcionan. No declares terminado algo no verificado.
