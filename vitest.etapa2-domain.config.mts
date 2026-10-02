import { defineConfig } from 'vitest/config';
import base from './vitest.config.mts';
export default defineConfig({...base,test:{...base.test,globalSetup:[],include:['tests/cron-auth.test.ts','tests/etapa2-navigation.test.ts','tests/etapa2-domain.test.ts','tests/fronti-*.test.ts'],exclude:['tests/fronti-proactive.test.ts','tests/fronti-findings.test.ts','tests/fronti-v2-read-tools.test.ts','tests/fronti-page-context-tool.test.ts']}});
