import base from './vitest.config.mts';
import { defineConfig } from 'vitest/config';
export default defineConfig({ ...base, test: { ...base.test, globalSetup: [] } });
