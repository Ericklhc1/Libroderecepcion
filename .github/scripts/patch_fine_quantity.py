#!/usr/bin/env python3
from pathlib import Path

schema = Path("prisma/schema.prisma")
t = schema.read_text(encoding="utf-8")
marker = (
    "  /// Tipo de mancha identificada: «Maquillaje lápiz de ojos negro».\n"
    "  stainType      String?\n"
)
addition = (
    marker
    + "  /// Cantidad de unidades afectadas por la misma multa. Aditivo: default 1.\n"
    + "  quantity       Int                   @default(1)\n"
)
fine_start = t.find("model Fine {")
if fine_start < 0:
    raise SystemExit("model Fine not found")
fine_end = t.find("\nmodel ", fine_start + 1)
fine_block = t[fine_start:fine_end if fine_end > 0 else None]
if "quantity       Int                   @default(1)" not in fine_block:
    if marker not in fine_block:
        raise SystemExit("stainType marker not found in Fine")
    t = t[:fine_start] + fine_block.replace(marker, addition, 1) + (t[fine_end:] if fine_end > 0 else "")
    schema.write_text(t, encoding="utf-8")
    print("schema patched")
else:
    print("schema already has quantity")

page = Path("src/app/(app)/habitaciones/[numero]/page.tsx")
p = page.read_text(encoding="utf-8")
needle = "                            stainType: fine.stainType,\n"
insert = needle + "                            quantity: fine.quantity,\n"
if "quantity: fine.quantity" not in p:
    if needle not in p:
        raise SystemExit("page needle not found")
    page.write_text(p.replace(needle, insert, 1), encoding="utf-8")
    print("page patched")
else:
    print("page already has quantity")
