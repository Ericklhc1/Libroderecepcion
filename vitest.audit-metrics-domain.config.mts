import { defineConfig } from 'vitest/config';
import base from './vitest.config.mts';
export default defineConfig({ ...base, test: { ...base.test, globalSetup: [], include: ['tests/operational-metrics-domain.test.ts', 'tests/management-dashboard.test.ts', 'tests/etapa2-indicators-domain.test.ts'] } });
