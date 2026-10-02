"""Inventory every exported Server Action; never infer executable coverage from a module name."""
import json, re
from pathlib import Path
catalog = {a['name']: a for a in json.loads(Path('scripts/etapa2/catalog.json').read_text())}
rows=[]
for path in sorted(Path('src/server/actions').glob('*.ts')):
    text=path.read_text()
    matches=list(re.finditer(r'export async function (\w+)\(',text))
    for i,m in enumerate(matches):
        name=m[1]; body=text[m.end():matches[i+1].start() if i+1<len(matches) else len(text)]
        permissions=sorted(set(re.findall(r"requirePermission(?:OrOwner)?\('([^']+)'",body)))
        a=catalog.get(name)
        inputs=', '.join(a['fields']) if a else 'Ver esquema/formulario nativo; adaptador pendiente'
        state='Conectado; acreditación individual pendiente' if a else 'Pendiente de adaptador (no disponible por el catálogo nuevo)'
        if path.stem in ['pms','reservations','room-stays','guests']:state='Fuera del alcance de producto solicitado; no ampliar'
        rows.append(f"| `{name}` | `{path}` | {', '.join(permissions) or 'Control contextual del servicio nativo'} | {inputs} | {state} |")
preamble='''# Matriz completa de Server Actions · Etapa 2

Inventario reproducible: `python scripts/etapa2/matrix.py`. Incluye las acciones nativas detectadas y el catálogo conectado; **conexión no equivale a acreditación**. No se declara cobertura general. Consultas existentes de Fronti conservan sus lectores y permisos; el inventario de endpoints GET, exportaciones, archivos binarios y acciones de perfil requiere revisión adicional.

## Controles comunes a los adaptadores conectados

- Identidad: sesión autenticada en servidor y permisos renovados para cada paso. El modelo no suministra rol ni identidad ejecutora.
- Entrada: acción/campos admitidos + validación del formulario original. Los campos de destinatario son objetivos, nunca la identidad ejecutora.
- Confirmación: propuesta IA muestra efecto/campos y requiere autorización privada; `/ejecutar [...]` es autorización exacta del usuario. Se preservan controles y aprobaciones nativos. Declarar un hecho físico no equivale a realizarlo; nunca se aporta otra identidad.
- Efecto/servicio: se invoca la Server Action indicada, que conserva el servicio original. No hay escrituras arbitrarias elegidas por el modelo.
- Reintento: plan/posición persistidos, reclamación atómica y huella de mensaje; éxito no se repite. Resultado incierto detiene los pasos pendientes para intervención. No hay transacción global entre distintas Server Actions.
- Reversibilidad: no existe deshacer genérico. Cancelar afecta pasos pendientes; corregir una acción completada exige su procedimiento nativo y conserva auditoría.
- Pruebas comunes: `etapa2-domain.test.ts` (contrato/identidad/límites); `etapa2-execution.test.ts` (PostgreSQL, permisos/revocación, privacidad del plan, concurrencia, cancelación y ejecución parcial). Estos casos **no acreditan todos los procedimientos individuales**.
- Cambios posteriores: revisión de tareas, novedades, llaves, garantías, usuarios/permisos y configuración; HK/Coordinación/Equipo retienen versiones nativas. Falta acreditar atomicidad y cobertura de revisión de todos los procedimientos antes de publicación.

## Inventario

| Acción | Adaptador/servicio de entrada existente | Permiso explícito en la acción | Datos del adaptador (obligatoriedad en esquema nativo) | Cobertura |
|---|---|---|---|---|
'''
Path('docs/etapa2/MATRIZ_ACCIONES.md').write_text(preamble+'\n'.join(rows)+'\n')
print(f'{len(rows)} acciones inventariadas; {len(catalog)} adaptadores conectados')
