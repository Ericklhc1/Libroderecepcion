/* Doble de pruebas del almacén `db`, según el contrato 0.2.49:
   rutas de segmentos pares (documento) / impares (colección), escrituras
   última-gana, suscripciones que emiten al registrarse y en cada cambio,
   y `acquire` como arriendo cooperativo. Sólo para verificar la aplicación
   en local; en producción lo provee el visor de claude.ai. */
(function () {
  const PERSIST = 'db-shim-store';
  const store = new Map();          // ruta -> cuerpo
  try {
    const raw = localStorage.getItem(PERSIST);
    if (raw) Object.entries(JSON.parse(raw)).forEach(([k, v]) => store.set(k, v));
  } catch (_) { /* sin persistencia */ }
  const persist = () => { try { localStorage.setItem(PERSIST, JSON.stringify(Object.fromEntries(store))); } catch (_) {} };
  const docSubs = new Map();        // ruta -> Set(cb)
  const colSubs = new Map();        // ruta -> Set({cb, filters})
  const leases = new Map();
  window.__dbStore = store;

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const meta = { fromCache: false, hasPendingWrites: false };
  const parentOf = (path) => path.split('/').slice(0, -1).join('/');

  function snapOf(path) {
    const body = store.get(path);
    return { id: path.split('/').pop(), exists: body !== undefined, data: () => (body === undefined ? undefined : clone(body)), metadata: meta };
  }

  function notify(path) {
    persist();
    (docSubs.get(path) || new Set()).forEach((cb) => cb(snapOf(path)));
    const col = parentOf(path);
    (colSubs.get(col) || new Set()).forEach((entry) => entry.cb(querySnap(col, entry.q)));
  }

  function docsIn(col) {
    const out = [];
    store.forEach(function (_body, path) {
      if (parentOf(path) === col) out.push(snapOf(path));
    });
    return out;
  }

  function querySnap(col, q) {
    let docs = docsIn(col);
    (q.filters || []).forEach(function (f) {
      docs = docs.filter(function (d) {
        const v = (d.data() || {})[f.field];
        if (f.op === '==') return v === f.value;
        if (f.op === '!=') return v !== f.value;
        if (f.op === '>') return v > f.value;
        if (f.op === '>=') return v >= f.value;
        if (f.op === '<') return v < f.value;
        if (f.op === '<=') return v <= f.value;
        if (f.op === 'in') return (f.value || []).indexOf(v) >= 0;
        return true;
      });
    });
    if (q.order) {
      docs.sort(function (a, b) {
        const va = (a.data() || {})[q.order.field];
        const vb = (b.data() || {})[q.order.field];
        const cmp = va === vb ? 0 : va > vb ? 1 : -1;
        return q.order.dir === 'desc' ? -cmp : cmp;
      });
    } else {
      docs.sort((a, b) => a.id.localeCompare(b.id));
    }
    if (q.max) docs = docs.slice(0, q.max);
    return { docs: docs, size: docs.length, empty: docs.length === 0, docChanges: () => docs.map((d, i) => ({ type: 'added', doc: d, oldIndex: -1, newIndex: i })), metadata: meta };
  }

  function assertParity(path, wantEven) {
    const segments = path.split('/');
    if (segments.some((s) => !s)) throw new TypeError('ruta inválida: ' + path);
    const even = segments.length % 2 === 0;
    if (even !== wantEven) throw new TypeError('paridad incorrecta (' + segments.length + ' segmentos): ' + path);
  }

  function makeQuery(col, q) {
    return {
      where: (field, op, value) => makeQuery(col, Object.assign({}, q, { filters: (q.filters || []).concat([{ field, op, value }]) })),
      orderBy: (field, dir) => makeQuery(col, Object.assign({}, q, { order: { field, dir: dir || 'asc' } })),
      limit: (n) => makeQuery(col, Object.assign({}, q, { max: n })),
      get: async () => querySnap(col, q),
      onSnapshot: function (next) {
        const entry = { cb: next, q: q };
        if (!colSubs.has(col)) colSubs.set(col, new Set());
        colSubs.get(col).add(entry);
        setTimeout(() => next(querySnap(col, q)), 0);
        return () => colSubs.get(col).delete(entry);
      }
    };
  }

  function makeDoc(path) {
    return {
      id: path.split('/').pop(),
      path: path,
      get: async () => snapOf(path),
      set: async function (data) { store.set(path, clone(data)); notify(path); },
      update: async function (data) {
        if (!store.has(path)) { const e = new Error('no existe'); e.code = 'invalid_argument'; throw e; }
        store.set(path, Object.assign({}, store.get(path), clone(data)));
        notify(path);
      },
      delete: async function () { store.delete(path); notify(path); },
      acquire: async function (options) {
        const now = Date.now();
        const held = leases.get(path);
        if (held && held.until > now && held.holder !== options.holder) {
          return { acquired: false, expiresAt: new Date(held.until).toISOString() };
        }
        const ttl = Math.min(600000, Math.max(1000, options.ttlMs || 30000));
        leases.set(path, { holder: options.holder, until: now + ttl });
        return { acquired: true, holder: options.holder, expiresAt: new Date(now + ttl).toISOString() };
      },
      onSnapshot: function (next) {
        if (!docSubs.has(path)) docSubs.set(path, new Set());
        docSubs.get(path).add(next);
        setTimeout(() => next(snapOf(path)), 0);
        return () => docSubs.get(path).delete(next);
      },
      collection: (sub) => makeCollection(path + '/' + sub)
    };
  }

  function makeCollection(col) {
    const q = makeQuery(col, {});
    return Object.assign({}, q, {
      path: col,
      doc: (id) => makeDoc(col + '/' + (id || 'auto' + Math.random().toString(36).slice(2, 9))),
      add: async function (data) { const ref = this.doc(); await ref.set(data); return ref; }
    });
  }

  const db = {
    doc: function (path) { assertParity(path, true); return makeDoc(path); },
    collection: function (path) { assertParity(path, false); return makeCollection(path); }
  };

  window.claude = {
    use: async function (name) {
      await new Promise((r) => setTimeout(r, 30));
      return name === 'db' ? db : null;
    }
  };
})();
