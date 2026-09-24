import { describe, expect, it } from 'vitest';
import { canUseFronti } from '@/server/ai/fronti-access';

describe('Fronti rollout por usuario', () => {
  it('mantiene Fronti siempre activo para Administrador de sistema', () => {
    expect(
      canUseFronti(
        { isSystemAdmin: true, frontiAccessEnabled: false },
        false,
      ),
    ).toBe(true);
  });

  it('exige habilitación global y personal para usuarios normales', () => {
    expect(
      canUseFronti(
        { isSystemAdmin: false, frontiAccessEnabled: true },
        true,
      ),
    ).toBe(true);

    expect(
      canUseFronti(
        { isSystemAdmin: false, frontiAccessEnabled: false },
        true,
      ),
    ).toBe(false);

    expect(
      canUseFronti(
        { isSystemAdmin: false, frontiAccessEnabled: true },
        false,
      ),
    ).toBe(false);
  });
});
