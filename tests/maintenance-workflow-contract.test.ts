import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/compuerta.yml', 'utf8');
const name = '      - name: Mantenimiento temporal y recuperación SysAdmin';
const start = workflow.indexOf(name);
const end = workflow.indexOf('\n      - name:', start + name.length);
const step = workflow.slice(start, end < 0 ? undefined : end);

describe('validación conjunta · mantenimiento real en navegador sintético', () => {
  it('ejecuta el recorrido en un paso independiente después del build, incluso si otro grupo falla', () => {
    expect(start).toBeGreaterThan(workflow.indexOf('id: production_build'));
    expect(step).toContain("if: ${{ !cancelled() && steps.production_build.outcome == 'success' }}");
    expect(step).toContain('timeout-minutes: 3');
    expect(step).toContain('node scripts/maintenance/browser.mjs');
    expect(workflow.match(/node scripts\/maintenance\/browser\.mjs/g)).toHaveLength(1);
    expect(step).not.toContain('continue-on-error');
    expect(step).toMatch(/if ! PLAYWRIGHT_MODULE=.*scripts\/maintenance\/browser\.mjs; then/);
    expect(step).toContain('exit 1');
  });

  it('reutiliza la fixture protegida, bloquea salidas externas y termina su servidor local', () => {
    expect(step).toContain('node scripts/etapa1/guard.cjs');
    expect(step).toContain('npx tsx scripts/etapa1/fixture.mts');
    expect(step).toContain('NODE_OPTIONS="--require=$PWD/scripts/etapa1/no-external.cjs"');
    expect(step).toContain('node node_modules/next/dist/bin/next start --hostname localhost');
    expect(step).toContain('http://localhost:3000/login');
    expect(step).toContain('trap \'kill "$server_pid" 2>/dev/null || true\' EXIT');
    expect(step.indexOf('node scripts/etapa1/guard.cjs')).toBeLessThan(step.indexOf('npx tsx scripts/etapa1/fixture.mts'));
    expect(step).not.toMatch(/vercel|neon|deploy|upload-artifact|actions\/cache/i);
  });

  it('conserva checks, límite global y almacenamiento desactivado en la rama candidata', () => {
    for (const command of ['npm run typecheck', 'npm run test', 'npm run build', 'npm run lint', 'npm run db:deploy']) expect(workflow).toContain(command);
    expect(workflow).toContain('timeout-minutes: 30');
    // The existing workflow retains storage for unrelated releases; this isolated
    // branch (and its PR context) must continue to opt out of all of it.
    const candidate = 'codex/aroh-future-handoff-20261005';
    const cache = workflow.match(/^\s+cache:\s*(.+)$/m)?.[1];
    expect(cache).toContain(`github.ref != 'refs/heads/${candidate}'`);
    expect(cache).toContain(`github.head_ref != '${candidate}'`);
    expect(cache).toContain("&& 'npm' || ''");
    expect(workflow).not.toContain('uses: actions/cache@');
    const uploads = workflow.split('\n      - name:').filter(block => block.includes('uses: actions/upload-artifact@'));
    expect(uploads).toHaveLength(2);
    for (const upload of uploads) {
      if (upload.includes('github.event.pull_request.number == 249')) {
        expect(upload).toContain("if: github.event_name == 'pull_request' && github.event.pull_request.number == 249");
      } else {
        expect(upload).toContain(`github.ref != 'refs/heads/${candidate}'`);
        expect(upload).toContain(`github.head_ref != '${candidate}'`);
      }
    }
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { git: { deploymentEnabled: Record<string, boolean> } };
    expect(vercel.git.deploymentEnabled['**']).toBe(false);
    expect(vercel.git.deploymentEnabled['codex/aroh-future-handoff-20261005']).not.toBe(true);
  });
});
