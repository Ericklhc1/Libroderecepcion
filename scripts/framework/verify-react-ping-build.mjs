import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const FIX = '5ba0de3b4e2bd70489db95c10491ab871814cb06';
const K = ts.SyntaxKind;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const unwrap = (node) => ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
const identifier = (node, name) => ts.isIdentifier(unwrap(node)) && unwrap(node).text === name;
const numeric = (node, value) => ts.isNumericLiteral(unwrap(node)) && Number(unwrap(node).text) === value;
const isFunction = (node) => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);

function descendants(node) {
  const result = [];
  function visit(child) {
    if (child !== node && isFunction(child)) return;
    result.push(child);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return result;
}

function rootProperty(node, root, property) {
  node = unwrap(node);
  return ts.isPropertyAccessExpression(node) && identifier(node.expression, root) && node.name.text === property;
}

/**
 * Find the renderer by effects on its root, never by minified variable names.
 * The constructor also mentions these properties but cannot match this update.
 */
function isPingFunction(fn) {
  if (fn.parameters.length !== 3 || !fn.parameters.every((parameter) => ts.isIdentifier(parameter.name))) return false;
  const [root, , lanes] = fn.parameters.map((parameter) => parameter.name.text);
  const nodes = descendants(fn);
  return nodes.some((node) => rootProperty(node, root, 'pingCache')) && nodes.some((node) => {
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== K.BarEqualsToken || !rootProperty(node.left, root, 'pingedLanes')) return false;
    const right = unwrap(node.right);
    return ts.isBinaryExpression(right) && right.operatorToken.kind === K.AmpersandToken && (
      rootProperty(right.left, root, 'suspendedLanes') && identifier(right.right, lanes)
      || rootProperty(right.right, root, 'suspendedLanes') && identifier(right.left, lanes)
    );
  });
}

function verifyPingFunction(fn, sourceFile) {
  const [root, , lanes] = fn.parameters.map((parameter) => parameter.name.text);
  const nodes = descendants(fn);
  const restartCalls = nodes.filter((node) => ts.isCallExpression(node)
    && ts.isIdentifier(node.expression) && node.arguments.length === 2
    && identifier(node.arguments[0], root) && numeric(node.arguments[1], 0));
  const recordings = nodes.filter((node) => ts.isBinaryExpression(node)
    && node.operatorToken.kind === K.BarEqualsToken && ts.isIdentifier(unwrap(node.left))
    && identifier(node.right, lanes));
  const contexts = nodes.filter((node) => ts.isBinaryExpression(node) && node.operatorToken.kind === K.AmpersandToken)
    .flatMap((node) => numeric(node.left, 2) && ts.isIdentifier(unwrap(node.right)) ? [unwrap(node.right).text]
      : numeric(node.right, 2) && ts.isIdentifier(unwrap(node.left)) ? [unwrap(node.left).text] : []);
  const accumulators = new Set(recordings.map((node) => unwrap(node.left).text));
  if (restartCalls.length !== 1 || accumulators.size !== 1 || new Set(contexts).size !== 1) {
    throw new Error('Unrecognized renderer restart branch; review compiled React before accepting');
  }
  const restart = restartCalls[0];
  const accumulator = [...accumulators][0];
  const context = contexts[0];
  // SWC can fuse the two ternaries into (restartWanted && !rendering) ?
  // prepareFreshStack(...) : recordPing. Find the smallest complete choice.
  const branch = nodes.filter((node) => ts.isConditionalExpression(node))
    .filter((node) => node.pos <= restart.pos && node.end >= restart.end
      && recordings.some((recording) => node.pos <= recording.pos && node.end >= recording.end))
    .sort((left, right) => left.end - left.pos - (right.end - right.pos))[0];
  if (!branch) throw new Error('Missing compiled renderer restart choice');

  const atoms = new Map();
  const protectedNames = new Set([root, lanes, context, accumulator, restart.expression.text]);
  const primitives = new Map([
    [K.AmpersandToken, (a, b) => a & b],
    [K.EqualsEqualsToken, (a, b) => a === b],
    [K.EqualsEqualsEqualsToken, (a, b) => a === b],
    [K.ExclamationEqualsToken, (a, b) => a !== b],
    [K.ExclamationEqualsEqualsToken, (a, b) => a !== b],
  ]);
  function primitive(node) {
    node = unwrap(node);
    if (ts.isNumericLiteral(node)) return () => Number(node.text);
    if (identifier(node, context)) return (state) => state.context;
    if (ts.isBinaryExpression(node) && primitives.has(node.operatorToken.kind)) {
      const left = primitive(node.left), right = primitive(node.right);
      if (left && right) return (state) => primitives.get(node.operatorToken.kind)(left(state), right(state));
    }
    return null;
  }
  function compile(node) {
    node = unwrap(node);
    const value = primitive(node);
    if (value) return value;
    if (node.kind === K.TrueKeyword) return () => true;
    if (node.kind === K.FalseKeyword) return () => false;
    if (ts.isPrefixUnaryExpression(node) && node.operator === K.ExclamationToken) {
      const operand = compile(node.operand);
      return (state) => !operand(state);
    }
    if (ts.isConditionalExpression(node)) {
      const condition = compile(node.condition), yes = compile(node.whenTrue), no = compile(node.whenFalse);
      return (state) => condition(state) ? yes(state) : no(state);
    }
    if (ts.isBinaryExpression(node)) {
      if ([K.AmpersandAmpersandToken, K.BarBarToken, K.CommaToken].includes(node.operatorToken.kind)) {
        const left = compile(node.left), right = compile(node.right);
        if (node.operatorToken.kind === K.AmpersandAmpersandToken) return (state) => left(state) && right(state);
        if (node.operatorToken.kind === K.BarBarToken) return (state) => left(state) || right(state);
        return (state) => { left(state); return right(state); };
      }
      if (recordings.includes(node)) return (state) => { state.records += 1; return state.accumulator |= state.lanes; };
    }
    if (node === restart) return (state) => { state.restarts += 1; };
    // Other restart predicates are independent Boolean atoms. Explore every
    // combination, including impossible ones: no bundle code is executed.
    const parts = descendants(node);
    if (parts.some((part) => ts.isIdentifier(part) && protectedNames.has(part.text)
      || ts.isBinaryExpression(part) && part.operatorToken.kind >= K.FirstAssignment && part.operatorToken.kind <= K.LastAssignment
      || ts.isPostfixUnaryExpression(part)
      || ts.isPrefixUnaryExpression(part) && [K.PlusPlusToken, K.MinusMinusToken].includes(part.operator))) {
      throw new Error('Unrecognized side effect or execution-context predicate in renderer branch');
    }
    if (!ts.isBinaryExpression(node) && !ts.isIdentifier(node)) throw new Error('Unrecognized renderer predicate');
    const key = node.getText(sourceFile);
    if (!atoms.has(key)) atoms.set(key, atoms.size);
    const index = atoms.get(key);
    return (state) => Boolean(state.conditions & 2 ** index);
  }
  const evaluate = compile(branch);
  if (atoms.size > 8) throw new Error('Unexpected renderer predicate count');
  let cases = 0, sawRestart = false;
  for (let conditions = 0; conditions < 2 ** atoms.size; conditions += 1) {
    for (const executionContext of [0, 2, 4, 6]) {
      const state = { conditions, context: executionContext, records: 0, restarts: 0, accumulator: 8, lanes: 32 };
      evaluate(state);
      const rendering = Boolean(executionContext & 2);
      if (state.records + state.restarts !== 1 || rendering && (state.records !== 1 || state.restarts !== 0)
        || state.accumulator !== (state.records ? 40 : 8)) {
        throw new Error('Compiled React loses or mishandles a ping during the synchronous-render restart branch');
      }
      sawRestart ||= state.restarts === 1;
      cases += 1;
    }
  }
  if (!sawRestart) throw new Error('Compiled React never prepares a fresh stack outside render');
  return { status: 'verified', cases };
}

export function inspectReactPingChunk(source) {
  if (!['pingCache', 'pingedLanes', 'suspendedLanes'].every((property) => source.includes(property))) return [];
  const sourceFile = ts.createSourceFile('client.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (sourceFile.parseDiagnostics.length) throw new Error('Cannot parse client chunk containing React root properties');
  const results = [];
  function visit(node) {
    if (isFunction(node) && isPingFunction(node)) {
      try { results.push(verifyPingFunction(node, sourceFile)); }
      catch (error) { results.push({ status: 'failed', reason: error.message }); }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return results;
}

/** Read built client assets only. No source text, source maps or app data in the report. */
export function verifyReactPingBuild({ chunksDir = resolve('.next/static/chunks') } = {}) {
  const root = resolve(chunksDir), files = [];
  function walk(directory) {
    if (!lstatSync(directory).isDirectory()) throw new Error('Expected a real client chunks directory');
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Refusing a symlink in built client chunks');
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
    }
  }
  walk(root);
  const chunks = [];
  for (const path of files) {
    const bytes = readFileSync(path);
    const renderers = inspectReactPingChunk(bytes.toString('utf8'));
    if (renderers.length) chunks.push({ file: relative(root, path).split('\\').join('/'), bytes: bytes.length, sha256: hash(bytes), renderers });
  }
  const renderers = chunks.flatMap((chunk) => chunk.renderers);
  return {
    fix: FIX,
    status: renderers.length && renderers.every((renderer) => renderer.status === 'verified') ? 'verified' : 'failed',
    scannedChunks: files.length,
    rendererCount: renderers.length,
    ...(renderers.length ? {} : { reason: 'No compiled React ping renderer found in client chunks' }),
    chunks,
  };
}

/** Verify only public renderer assets from the fixed, already-running CI server. */
export async function verifyServedReactPingBuild(report, fetchImpl = fetch) {
  if (report.status !== 'verified') return report;
  const chunks = [];
  for (const chunk of report.chunks) {
    let served;
    try {
      const segments = chunk.file.split('/');
      if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))
        || !chunk.file.endsWith('.js')) throw new Error('Invalid public client chunk path');
      const maximumBytes = 20 * 1024 * 1024;
      if (chunk.bytes > maximumBytes) throw new Error('Client renderer exceeds the 20 MiB verification limit');
      const url = `http://localhost:3000/_next/static/chunks/${segments.map(encodeURIComponent).join('/')}`;
      const response = await fetchImpl(url, {
        redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { accept: 'application/javascript' }, signal: AbortSignal.timeout(10_000),
      });
      if (response.status !== 200 || !response.body) throw new Error(`Client renderer HTTP status ${response.status}`);
      const digest = createHash('sha256'), reader = response.body.getReader();
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > Math.min(chunk.bytes, maximumBytes)) throw new Error('Served renderer exceeds expected size');
          digest.update(part.value);
        }
      } finally {
        await reader.cancel();
      }
      const sha256 = digest.digest('hex');
      if (bytes !== chunk.bytes || sha256 !== chunk.sha256) throw new Error('Served renderer differs from verified build');
      served = { status: 'verified', httpStatus: response.status, bytes, sha256 };
    } catch (error) {
      served = { status: 'failed', reason: error.message };
    }
    chunks.push({ ...chunk, served });
  }
  return { ...report, status: chunks.every((chunk) => chunk.served.status === 'verified') ? 'verified' : 'failed', chunks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3 || process.argv.length === 3 && process.argv[2] !== '--served') {
      throw new Error('Usage: node scripts/framework/verify-react-ping-build.mjs [--served]');
    }
    let result = verifyReactPingBuild();
    if (process.argv[2] === '--served') result = await verifyServedReactPingBuild(result);
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'verified') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ fix: FIX, status: 'failed', reason: error.message }));
    process.exitCode = 1;
  }
}
