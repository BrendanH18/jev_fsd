// Saved arena history in IndexedDB (lab/history.js openEvaluationHistory): the move of the
// localStorage history into it, the newest-runs and byte limits, a browser quota, and the fallback to
// localStorage when IndexedDB is missing or fails. Node has no IndexedDB, so a small fake one stands
// in: asynchronous requests, transactions that commit once idle and roll back on abort, and a quota
// checked at a write request or at commit.
import assert from "node:assert/strict";
import {
  EVALUATION_SCHEMA,
  EVALUATION_HISTORY_KEY,
  EVALUATION_DB,
  MAX_SAVED_RUNS,
  openEvaluationHistory,
  readEvaluations,
} from "../static/js/lab/history.js";

const fail = (name, message = name) => Object.assign(new Error(message), { name });
class Request {
  onsuccess = null;
  onerror = null;
  result;
  error = null;
}
class FakeIndexedDB {
  constructor({ quota = Infinity, quotaOnWrite = false, failOpen = false, throwOpen = false } = {}) {
    Object.assign(this, { quota, quotaOnWrite, failOpen, throwOpen, dbs: new Map(), failWrites: false });
  }
  open(name, version) {
    if (this.throwOpen) throw fail("SecurityError");
    const req = new Request();
    setTimeout(() => {
      if (this.failOpen) {
        req.error = fail("InvalidStateError");
        req.onerror?.();
        return;
      }
      let data = this.dbs.get(name);
      if (!data) this.dbs.set(name, (data = { version: 0, stores: new Map() }));
      req.result = new FakeDatabase(this, data);
      if (data.version < version) {
        req.onupgradeneeded?.();
        data.version = version;
      }
      req.onsuccess?.();
    });
    return req;
  }
  bytes() {
    let n = 0;
    for (const db of this.dbs.values())
      for (const s of db.stores.values()) for (const v of s.records.values()) n += JSON.stringify(v).length;
    return n;
  }
}
class FakeDatabase {
  constructor(idb, data) {
    this.idb = idb;
    this.data = data;
    this.objectStoreNames = { contains: (n) => data.stores.has(n) };
  }
  createObjectStore(name, { keyPath } = {}) {
    this.data.stores.set(name, { keyPath, records: new Map() });
  }
  transaction(names, mode = "readonly") {
    return new Transaction(this, [names].flat(), mode);
  }
  close() {}
}
class Transaction {
  constructor(db, names, mode) {
    Object.assign(this, {
      db,
      mode,
      pending: 0,
      state: "active",
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
    });
    this.snapshot = new Map(names.map((n) => [n, new Map(db.data.stores.get(n).records)]));
    this.check();
  }
  objectStore(name) {
    const store = this.db.data.stores.get(name);
    const write = (fn) => {
      if (this.mode !== "readwrite") throw fail("ReadOnlyError");
      return this.request(() => {
        const idb = this.db.idb;
        if (idb.failWrites) throw fail("UnknownError", "disk failed");
        const result = fn();
        if (idb.quotaOnWrite && idb.bytes() > idb.quota) throw fail("QuotaExceededError");
        return result;
      });
    };
    return {
      get: (key) => this.request(() => structuredClone(store.records.get(key))),
      getAll: () =>
        this.request(() =>
          [...store.records.keys()].sort((a, b) => a - b).map((k) => structuredClone(store.records.get(k))),
        ),
      put: (value, key) =>
        write(() => {
          const k = store.keyPath ? value[store.keyPath] : key;
          store.records.set(k, structuredClone(value));
          return k;
        }),
      delete: (key) =>
        write(() => {
          store.records.delete(key);
        }),
    };
  }
  request(fn) {
    if (this.state !== "active") throw fail("TransactionInactiveError");
    const req = new Request();
    this.pending++;
    setTimeout(() => {
      if (this.state !== "active") return;
      this.pending--;
      try {
        req.result = fn();
        req.onsuccess?.();
      } catch (error) {
        req.error = error;
        req.onerror?.();
        this.onerror?.({ target: req });
        this.end(error);
        return;
      }
      this.check();
    });
    return req;
  }
  check() {
    setTimeout(() => {
      if (this.state === "active" && this.pending === 0) this.commit();
    });
  }
  commit() {
    if (this.mode === "readwrite" && this.db.idb.bytes() > this.db.idb.quota) {
      this.end(fail("QuotaExceededError"));
      return;
    }
    this.state = "done";
    this.oncomplete?.();
  }
  abort() {
    if (this.state !== "active") throw fail("InvalidStateError");
    this.end(null);
  }
  end(error) {
    for (const [n, records] of this.snapshot) this.db.data.stores.get(n).records = records;
    this.state = "aborted";
    this.error = error;
    this.onerror?.();
    this.onabort?.();
  }
}

const result = {
  challenge: "door-zone",
  version: 1,
  map: "kitsilano",
  pack: 5,
  seed: 1042,
  weather: "dry",
  time: "afternoon",
  car: "compact",
  brain: "rules",
  mode: "lockstep",
  engine_version: "drive-lab-2",
  limit_s: 180,
  arrived: true,
  stopped: false,
  pass: true,
  failures: [],
  time_s: 30,
  collisions: 0,
  red_lights: 0,
  stop_signs: 0,
  failed_to_yield: 0,
  off_road_s: 0,
  hard_brakes: 1,
  latency_p50_ms: 0,
  cost_usd: 0,
  report: { model_version: 1, status: "arrived", score: 95, qualified: true, incidents: [] },
};
const at = (m, extra = {}) => ({
  schema: EVALUATION_SCHEMA,
  challenge_version: 2,
  created_at: new Date(Date.UTC(2026, 9, 3, 12, m)).toISOString(),
  status: "complete",
  results: [result],
  ...extra,
});
// (a run of every challenge with two drivers, some 1.1 million characters, mostly decision traces)
const decisions = Array.from({ length: 600 }, (_, i) => ({
  id: i + 1,
  at_s: i * 0.2,
  chosen_id: "keep_lane_target",
  motion: "drive",
  source: "rules",
  error: null,
  context_recorded: false,
  flags: [],
  state: null,
  candidates: null,
}));
const big = (m) =>
  at(m, { results: Array.from({ length: 13 }, () => ({ ...result, decisions_trace: decisions, events: [] })) });
const local = (entries = []) => {
  const values = new Map(entries);
  return {
    values,
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)),
    removeItem: (k) => values.delete(k),
  };
};
const times = (runs) => runs.map((r) => r.created_at);
const minutes = (...ms) => ms.map((m) => at(m).created_at);

let checks = 0;
async function test(label, fn) {
  await fn();
  checks++;
  console.log(`✓ ${label}`);
}

await test("without IndexedDB (Node, old browsers) history is the localStorage history with its cap", async () => {
  assert.equal(globalThis.indexedDB, undefined);
  const storage = local(),
    history = await openEvaluationHistory({ storage });
  assert.equal(history.kind, "localStorage");
  assert.equal(history.limit, 10);
  for (let m = 0; m < 12; m++) await history.save(at(m));
  assert.equal((await history.list()).length, 10);
  assert.deepEqual(times(readEvaluations(storage)), times(await history.list()));
  const runs = await history.list();
  assert.deepEqual(times(await history.remove(runs[1])), times([runs[0], ...runs.slice(2)]));
  assert.equal(readEvaluations(storage).length, 9);
  // (full-size runs, counted as UTF-16: the 9 MB cap keeps three, the newest)
  const roomy = local(),
    h = await openEvaluationHistory({ storage: roomy });
  for (let m = 1; m <= 5; m++) await h.save(big(m));
  assert.deepEqual(times(await h.list()), minutes(5, 4, 3));
});

await test("an IndexedDB that throws, fails to open or is blocked falls back to localStorage", async () => {
  for (const idb of [new FakeIndexedDB({ throwOpen: true }), new FakeIndexedDB({ failOpen: true })]) {
    const storage = local([[EVALUATION_HISTORY_KEY, JSON.stringify([at(1)])]]),
      history = await openEvaluationHistory({ indexedDB: idb, storage });
    assert.equal(history.kind, "localStorage");
    assert.deepEqual(times(await history.list()), minutes(1));
    assert.ok(storage.values.has(EVALUATION_HISTORY_KEY), "the old history stays where it was");
  }
  const blocked = {
    open() {
      const req = new Request();
      setTimeout(() => req.onblocked?.());
      return req;
    },
  };
  assert.equal((await openEvaluationHistory({ indexedDB: blocked, storage: local() })).kind, "localStorage");
  // (a page whose window.indexedDB throws, as the arena's blocked-storage browser check makes it)
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    get() {
      throw fail("SecurityError");
    },
  });
  try {
    assert.equal((await openEvaluationHistory({ storage: local() })).kind, "localStorage");
  } finally {
    delete globalThis.indexedDB;
  }
  // (and with localStorage blocked too, a save reports the error rather than losing anything quietly)
  const none = {
    getItem() {
      throw new Error("Storage blocked");
    },
    setItem() {
      throw new Error("Storage blocked");
    },
  };
  const history = await openEvaluationHistory({ indexedDB: new FakeIndexedDB({ throwOpen: true }), storage: none });
  assert.deepEqual(await history.list(), []);
  await assert.rejects(history.save(at(1)), /Storage blocked/);
});

await test("the localStorage history moves into IndexedDB once, newest first, and its key is removed", async () => {
  const idb = new FakeIndexedDB(),
    storage = local([[EVALUATION_HISTORY_KEY, JSON.stringify([at(3), at(2), { schema: "other" }, at(1)])]]);
  const history = await openEvaluationHistory({ indexedDB: idb, storage });
  assert.equal(history.kind, "indexedDB");
  assert.equal(history.limit, MAX_SAVED_RUNS);
  assert.deepEqual(times(await history.list()), minutes(3, 2, 1));
  assert.equal(storage.values.has(EVALUATION_HISTORY_KEY), false);
  assert.ok(idb.dbs.has(EVALUATION_DB));
  await history.save(at(4));
  const again = await openEvaluationHistory({ indexedDB: idb, storage });
  assert.deepEqual(times(await again.list()), minutes(4, 3, 2, 1));
  // (a move cut short before the key was removed adds nothing twice; what was saved since is kept)
  const stuck = {
    ...local([[EVALUATION_HISTORY_KEY, JSON.stringify([at(5), at(3), at(2)])]]),
    removeItem() {
      throw new Error("blocked");
    },
  };
  const retried = await openEvaluationHistory({ indexedDB: idb, storage: stuck });
  assert.deepEqual(times(await retried.list()), minutes(5, 4, 3, 2, 1));
  assert.deepEqual(
    times(await (await openEvaluationHistory({ indexedDB: idb, storage: stuck })).list()),
    minutes(5, 4, 3, 2, 1),
  );
  // (an empty or corrupt old history is just removed)
  const corrupt = local([[EVALUATION_HISTORY_KEY, "{oops"]]);
  assert.deepEqual(
    await (await openEvaluationHistory({ indexedDB: new FakeIndexedDB(), storage: corrupt })).list(),
    [],
  );
  assert.equal(corrupt.values.has(EVALUATION_HISTORY_KEY), false);
});

await test("a move that fails keeps the old history in localStorage and uses it", async () => {
  const idb = new FakeIndexedDB({ quota: 100 }),
    storage = local([[EVALUATION_HISTORY_KEY, JSON.stringify([at(2), at(1)])]]);
  const history = await openEvaluationHistory({ indexedDB: idb, storage });
  assert.equal(history.kind, "localStorage");
  assert.deepEqual(times(await history.list()), minutes(2, 1));
  assert.ok(storage.values.has(EVALUATION_HISTORY_KEY));
  assert.equal(idb.bytes(), 0, "nothing half-moved");
});

await test("migration distinguishes runs that have the same summary and keeps duplicate copies", async () => {
  const idb = new FakeIndexedDB(),
    original = at(1),
    stopped = at(1, { results: [{ ...result, time_s: 31 }] }),
    storage = { ...local([[EVALUATION_HISTORY_KEY, JSON.stringify([stopped, original, original])]]), removeItem() {} };
  const before = await openEvaluationHistory({ indexedDB: idb, storage: local() });
  await before.save(original);
  for (let attempt = 0; attempt < 2; attempt++) {
    const history = await openEvaluationHistory({ indexedDB: idb, storage });
    assert.deepEqual(
      (await history.list()).map((run) => run.results[0].time_s),
      [31, 30, 30],
    );
  }
});

await test("a fallback save made during migration is available on the next opening", async () => {
  const idb = new FakeIndexedDB(),
    start = JSON.stringify([at(1)]),
    storage = local([[EVALUATION_HISTORY_KEY, start]]);
  const read = storage.getItem;
  storage.getItem = (key) => {
    const value = read(key);
    if (value === start) storage.setItem(key, JSON.stringify([at(2), at(1)]));
    return value;
  };
  const first = await openEvaluationHistory({ indexedDB: idb, storage });
  assert.deepEqual(times(await first.list()), minutes(1));
  await first.remove((await first.list())[0]);
  const second = await openEvaluationHistory({ indexedDB: idb, storage });
  assert.deepEqual(times(await second.list()), minutes(2), "migration does not bring back a deleted run");
});

await test("migration retains the newest runs within both IndexedDB limits", async () => {
  const maxSize = new Blob([JSON.stringify(at(4))]).size;
  for (const limits of [{ maxRuns: 2 }, { maxBytes: 2 * maxSize }]) {
    const idb = new FakeIndexedDB();
    const before = await openEvaluationHistory({ indexedDB: idb, storage: local() });
    await before.save(at(1));
    await before.save(at(2));
    const storage = local([[EVALUATION_HISTORY_KEY, JSON.stringify([at(4), at(3)])]]);
    const after = await openEvaluationHistory({ indexedDB: idb, storage, ...limits });
    assert.deepEqual(times(await after.list()), minutes(4, 3));
    assert.equal(storage.getItem(EVALUATION_HISTORY_KEY), null);
  }
});

await test("migration waits for a fallback tab that has read but has not yet saved history", async () => {
  const idb = new FakeIndexedDB(),
    storage = local([[EVALUATION_HISTORY_KEY, JSON.stringify([at(1)])]]);
  const queued = Promise.withResolvers();
  let tail = Promise.resolve();
  let requests = 0;
  const locks = {
    request(name, operation) {
      assert.equal(name, EVALUATION_HISTORY_KEY);
      if (++requests === 2) queued.resolve("queued");
      const next = tail.then(operation);
      tail = next.catch(() => {});
      return next;
    },
  };
  Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
  const release = Promise.withResolvers();
  try {
    const write = locks.request(EVALUATION_HISTORY_KEY, async () => {
      const records = readEvaluations(storage);
      await release.promise;
      storage.setItem(EVALUATION_HISTORY_KEY, JSON.stringify([at(2), ...records]));
    });
    const opening = openEvaluationHistory({ indexedDB: idb, storage });
    assert.equal(await Promise.race([opening, queued.promise]), "queued");
    release.resolve();
    await write;
    const history = await opening;
    const records = await history.list();
    assert.deepEqual(times(records), minutes(2, 1));
    assert.equal(storage.getItem(EVALUATION_HISTORY_KEY), null);
    await history.remove(records[1]);
    const reopened = await openEvaluationHistory({ indexedDB: idb, storage });
    assert.deepEqual(times(await reopened.list()), minutes(2));
  } finally {
    release.resolve();
    delete navigator.locks;
  }
});

await test("saved runs survive reopening; far more than the localStorage cap fits", async () => {
  const idb = new FakeIndexedDB(),
    history = await openEvaluationHistory({ indexedDB: idb, storage: local() });
  for (let m = 1; m <= 6; m++) await history.save(big(m));
  assert.ok(idb.bytes() * 2 > 9 * 1024 * 1024, "more than the 9 MB localStorage cap holds");
  const reopened = await (await openEvaluationHistory({ indexedDB: idb, storage: local() })).list();
  assert.deepEqual(times(reopened), minutes(6, 5, 4, 3, 2, 1));
  assert.equal(reopened[0].results.length, 13);
  assert.equal(reopened[0].results[0].decisions_trace.length, 600);
  assert.equal(reopened[0].results[0].pass, true);
});

await test("the newest runs are kept; the chosen baseline is dropped only when nothing else is left", async () => {
  const history = await openEvaluationHistory({ indexedDB: new FakeIndexedDB(), storage: local(), maxRuns: 3 });
  for (let m = 1; m <= 3; m++) await history.save(at(m));
  const baseline = (await history.list())[2];
  const saved = await history.save(at(4), baseline);
  assert.deepEqual(times(saved), minutes(4, 3, 1));
  assert.ok(saved.includes(baseline), "the baseline is the same object, so the arena finds it again");
  assert.deepEqual(times(await history.save(at(5))), minutes(5, 4, 3));
  assert.deepEqual(times(await history.list()), minutes(5, 4, 3));
  const one = await openEvaluationHistory({ indexedDB: new FakeIndexedDB(), storage: local(), maxRuns: 1 });
  await one.save(at(1));
  const first = (await one.list())[0];
  assert.deepEqual(times(await one.save(at(2), first)), minutes(2));
});

await test("the byte budget drops the oldest runs; a run larger than the budget is refused and nothing is lost", async () => {
  const size = JSON.stringify(big(1)).length;
  const history = await openEvaluationHistory({
    indexedDB: new FakeIndexedDB(),
    storage: local(),
    maxBytes: Math.floor(size * 2.5),
  });
  for (let m = 1; m <= 4; m++) await history.save(big(m));
  assert.deepEqual(times(await history.list()), minutes(4, 3));
  const small = await openEvaluationHistory({ indexedDB: new FakeIndexedDB(), storage: local(), maxBytes: size / 2 });
  await small.save(at(1));
  await assert.rejects(small.save(big(2)), /too large for browser history/);
  assert.deepEqual(times(await small.list()), minutes(1));
});

await test("a browser quota drops the oldest runs until the new one fits, keeping the baseline", async () => {
  const size = JSON.stringify(big(1)).length;
  const idb = new FakeIndexedDB({ quota: Math.floor(size * 3.5) }),
    history = await openEvaluationHistory({ indexedDB: idb, storage: local() });
  for (let m = 1; m <= 3; m++) await history.save(big(m));
  const baseline = (await history.list())[2];
  assert.deepEqual(times(await history.save(big(4), baseline)), minutes(4, 3, 1));
  assert.deepEqual(times(await history.save(big(5))), minutes(5, 4, 3));
  assert.deepEqual(
    times(await (await openEvaluationHistory({ indexedDB: idb, storage: local() })).list()),
    minutes(5, 4, 3),
  );
  // (no room at all: the save fails and the drops are rolled back)
  const tiny = new FakeIndexedDB(),
    full = await openEvaluationHistory({ indexedDB: tiny, storage: local() });
  await full.save(at(1));
  await full.save(at(2));
  tiny.quota = tiny.bytes() + 10;
  await assert.rejects(full.save(big(3)), (e) => e.name === "QuotaExceededError");
  assert.deepEqual(
    times(await (await openEvaluationHistory({ indexedDB: tiny, storage: local() })).list()),
    minutes(2, 1),
  );
});

await test("a quota error raised by the record write is retried after the transaction rolls back", async () => {
  const size = JSON.stringify(at(1)).length;
  const idb = new FakeIndexedDB({ quota: 2.5 * size, quotaOnWrite: true });
  const history = await openEvaluationHistory({ indexedDB: idb, storage: local() });
  await history.save(at(1));
  await history.save(at(2));
  assert.deepEqual(times(await history.save(at(3), (await history.list()).at(-1))), minutes(3, 1));
});

await test("other write failures are reported without destroying prior history", async () => {
  const idb = new FakeIndexedDB(),
    history = await openEvaluationHistory({ indexedDB: idb, storage: local(), maxRuns: 2 });
  await history.save(at(1));
  await history.save(at(2));
  idb.failWrites = true;
  await assert.rejects(history.save(at(3)), /disk failed/);
  idb.failWrites = false;
  assert.deepEqual(
    times(await (await openEvaluationHistory({ indexedDB: idb, storage: local() })).list()),
    minutes(2, 1),
  );
  await assert.rejects(history.save({ schema: "other" }), /JSON export/);
});

await test("deleting one saved run keeps the others, after reopening too", async () => {
  const idb = new FakeIndexedDB(),
    history = await openEvaluationHistory({ indexedDB: idb, storage: local() });
  for (let m = 1; m <= 3; m++) await history.save(at(m));
  const runs = await history.list();
  assert.deepEqual(times(await history.remove(runs[1])), minutes(3, 1));
  // (an equal copy, such as a reloaded run, finds its record too)
  assert.deepEqual(times(await history.remove(structuredClone(runs[0]))), minutes(1));
  assert.deepEqual(times(await (await openEvaluationHistory({ indexedDB: idb, storage: local() })).list()), minutes(1));
});

await test("a deleted run's id is never used again, so another tab cannot delete the new run by it", async () => {
  const idb = new FakeIndexedDB(),
    a = await openEvaluationHistory({ indexedDB: idb, storage: local() }),
    b = await openEvaluationHistory({ indexedDB: idb, storage: local() });
  await a.save(at(1));
  await a.save(at(2));
  const [newest, oldest] = await b.list(); // tab b knows both
  await a.remove((await a.list())[0]); // tab a deletes the newest and saves another
  await a.save(at(3));
  assert.deepEqual(times(await b.remove(newest)), minutes(3, 1)); // tab b deletes its stale newest: nothing else goes
  assert.deepEqual(times(await b.remove(oldest)), minutes(3));
  assert.deepEqual(times(await a.list()), minutes(3));
});

await test("an IndexedDB id is never reused after deleting all runs and turning back the clock", async () => {
  const idb = new FakeIndexedDB(),
    storage = local(),
    a = await openEvaluationHistory({ indexedDB: idb, storage }),
    b = await openEvaluationHistory({ indexedDB: idb, storage });
  const clock = Date.now;
  try {
    Date.now = () => 1000;
    await a.save(at(1));
    const [stale] = await b.list();
    await a.remove((await a.list())[0]);
    Date.now = () => 999;
    const reopened = await openEvaluationHistory({ indexedDB: idb, storage });
    await reopened.save(at(2));
    await reopened.save(at(3));
    assert.deepEqual(times(await b.remove(stale)), minutes(3, 2));
  } finally {
    Date.now = clock;
  }
});

await test("a version 1 IndexedDB history still prevents stale deletions after upgrading", async () => {
  const idb = new FakeIndexedDB();
  idb.dbs.set(EVALUATION_DB, {
    version: 1,
    stores: new Map([
      ["evaluations", { records: new Map([[1, at(1)]]) }],
      [
        "evaluation-index",
        {
          keyPath: "id",
          records: new Map([[1, { id: 1, created_at: at(1).created_at, status: "complete", count: 1, bytes: 100 }]]),
        },
      ],
    ]),
  });
  const a = await openEvaluationHistory({ indexedDB: idb, storage: local() });
  const b = await openEvaluationHistory({ indexedDB: idb, storage: local() });
  const [first] = await a.list();
  const [stale] = await b.list();
  assert.equal(first.created_at, at(1).created_at);
  await a.remove(first);
  await a.save(at(2));
  assert.deepEqual(times(await b.remove(stale)), minutes(2));
});

await test("a damaged record is left out, and runs saved in another tab are picked up", async () => {
  const idb = new FakeIndexedDB(),
    a = await openEvaluationHistory({ indexedDB: idb, storage: local() }),
    b = await openEvaluationHistory({ indexedDB: idb, storage: local() });
  await a.save(at(1));
  await b.save(at(2));
  assert.deepEqual(times(await a.save(at(3))), minutes(3, 2, 1));
  const records = idb.dbs.get(EVALUATION_DB).stores.get("evaluations").records;
  records.set([...records.keys()].sort((x, y) => x - y)[1], { schema: "broken" });
  assert.deepEqual(
    times(await (await openEvaluationHistory({ indexedDB: idb, storage: local() })).list()),
    minutes(3, 1),
  );
});

console.log(`${checks} arena storage checks passed`);
