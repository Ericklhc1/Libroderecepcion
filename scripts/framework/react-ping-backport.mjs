import { createHash, randomUUID } from 'node:crypto';
import {
  lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Temporary, exact-version backport of React PR #36134, pingSuspendedRoot only.
 * Source change: https://github.com/react/react/commit/5ba0de3b4e2bd70489db95c10491ab871814cb06
 * Merged as: https://github.com/react/react/commit/c0d218f0f3e02ed581f74096e56baa947213135d
 *
 * Next 15.5.25 aliases the App Router to these four standard compiled clients.
 * Experimental React, server renderers and top-level react-dom are untouched.
 * Remove this script, its tests and lifecycle hooks when adopting an official
 * Next release that includes this fix; do not expand the hash/version allowlist
 * to make an upgrade pass without reviewing its bundled React implementation.
 */
export const NEXT_VERSION = '15.5.25';
const COMPILED_DIR = 'node_modules/next/dist/compiled/react-dom/cjs';
const CACHE_DIR = '.next/cache/webpack';
const development = Object.freeze({
  before: '? (executionContext & RenderContext) === NoContext &&\n            prepareFreshStack(root, 0)',
  after: '? ((executionContext & RenderContext) === NoContext\n              ? prepareFreshStack(root, 0)\n              : (workInProgressRootPingedLanes |= pingedLanes))',
});
const production = Object.freeze({
  before: '? 0 === (executionContext & 2) && prepareFreshStack(root, 0)',
  after: '? (0 === (executionContext & 2)\n          ? prepareFreshStack(root, 0)\n          : (workInProgressRootPingedLanes |= pingedLanes))',
});

// SHA-256 of the entire npm-distributed file, and of exactly the change above.
export const CLIENT_VARIANTS = Object.freeze([
  {
    file: 'react-dom-client.development.js', patch: development,
    original: '14c33685b88f2e39827dc6f0515f9d44411958758aef6573686468163465f6bb',
    patched: '92031d350db1bb6d620108473c670a6cd3a6b4a1774b1a90394bab3c052a0ae3',
  },
  {
    file: 'react-dom-client.production.js', patch: production,
    original: '9bcaacd92279559075407d2fb09b19893f03f9b93ad74eb0ef42b31b66f6053e',
    patched: 'a7b94ba88136ee85fd941f43288dae4a3fb8d9571317faca9fa257fb1602adab',
  },
  {
    file: 'react-dom-profiling.development.js', patch: development,
    original: 'd0b4798776943fddff40056c9bd001e6076111b30aae3a392436722bfab24e2e',
    patched: '8c9f6efbb63fe713714b04d1510acaea9811591afe93fef516e117e2df990464',
  },
  {
    file: 'react-dom-profiling.profiling.js', patch: production,
    original: '2a2f9a79c0d5906720e6833f1d0cc605379b004279ca1b1ef37142a5fe392178',
    patched: '02d779c3eb656d570d1b85e2d7ad50470e7eadf52ffad4de13f41754e0ed3583',
  },
].map(Object.freeze));

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function inspectWritablePath(root, relative, allowMissing = false) {
  const parts = relative.split('/');
  let target = root;
  for (let index = 0; index < parts.length; index += 1) {
    target = join(target, parts[index]);
    let stat;
    try {
      stat = lstatSync(target);
    } catch (error) {
      if (allowMissing && error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${relative}`);
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw new Error(`Expected directory: ${relative}`);
    }
    if (index === parts.length - 1 && !(allowMissing ? stat.isDirectory() : stat.isFile())) {
      throw new Error(`Unexpected file type: ${relative}`);
    }
  }
}

/**
 * All versions, hashes and mutation paths are checked before the first write.
 * check: read-only; fails if any variant is unpatched.
 * apply: patch originals, accept exact patched files; clear webpack cache if changed.
 * prepare-build: apply + always clear only generated webpack cache before building.
 * Project root may be a disposable fixture; there is no implicit module resolution.
 */
export function reactPingBackport({ projectRoot, mode = 'check' } = {}) {
  if (!projectRoot || !['check', 'apply', 'prepare-build'].includes(mode)) {
    throw new Error('Expected projectRoot and mode check|apply|prepare-build');
  }
  const root = realpathSync(resolve(projectRoot));
  const installed = JSON.parse(readFileSync(join(root, 'node_modules/next/package.json'), 'utf8'));
  if (installed.name !== 'next' || installed.version !== NEXT_VERSION) {
    throw new Error(`React ping backport requires Next ${NEXT_VERSION}; review/remove it on upgrade`);
  }
  const files = CLIENT_VARIANTS.map((variant) => {
    const relative = `${COMPILED_DIR}/${variant.file}`;
    const path = join(root, relative);
    const source = readFileSync(path, 'utf8');
    const hash = sha256(source);
    if (hash !== variant.original && hash !== variant.patched) {
      throw new Error(`React ping backport source drift: ${variant.file}`);
    }
    const needsPatch = hash === variant.original;
    let output = source;
    if (needsPatch) {
      if (source.split(variant.patch.before).length !== 2) {
        throw new Error(`React ping backport expected one branch: ${variant.file}`);
      }
      output = source.replace(variant.patch.before, variant.patch.after);
      if (sha256(output) !== variant.patched) {
        throw new Error(`React ping backport result drift: ${variant.file}`);
      }
    }
    return { relative, path, output, needsPatch };
  });
  const changed = files.filter((file) => file.needsPatch);
  if (mode === 'check') {
    if (changed.length) throw new Error('React ping backport missing; run --apply before building');
    return { version: NEXT_VERSION, mode, patched: 0, verified: files.length, cacheCleared: false };
  }
  // Refuse shared/symlinked node_modules rather than silently modifying another checkout.
  for (const file of files) inspectWritablePath(root, file.relative);
  const clearCache = changed.length > 0 || mode === 'prepare-build';
  if (clearCache) inspectWritablePath(root, CACHE_DIR, true);
  // Atomic replacement per file. A filesystem failure fails the lifecycle; the next
  // invocation safely accepts a mixture of the exact original and patched hashes.
  for (const file of changed) {
    const temporary = join(dirname(file.path), `.react-ping-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, file.output, { flag: 'wx', mode: lstatSync(file.path).mode & 0o777 });
      renameSync(temporary, file.path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  if (clearCache) rmSync(join(root, CACHE_DIR), { recursive: true, force: true });
  return { version: NEXT_VERSION, mode, patched: changed.length, verified: files.length, cacheCleared: clearCache };
}

const isCLI = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCLI) {
  try {
    if (process.argv.length !== 3 || !['--apply', '--prepare-build', '--check'].includes(process.argv[2])) {
      throw new Error('Usage: node scripts/framework/react-ping-backport.mjs --apply|--prepare-build|--check');
    }
    const result = reactPingBackport({ projectRoot: process.cwd(), mode: process.argv[2].slice(2) });
    console.log(`React ping backport: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'React ping backport failed');
    process.exitCode = 1;
  }
}
