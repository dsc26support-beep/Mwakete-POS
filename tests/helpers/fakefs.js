// A tiny in-memory fake of the Firestore functions the Firebase adapter uses.
function fakeFs({ failWith = {}, existing = {} } = {}) {
  const store = new Map(Object.entries(existing));
  const fail = (ref) => {
    const id = ref.split("/").pop();
    if (failWith[id])
      throw Object.assign(new Error("x"), { code: failWith[id] });
  };
  const OPS = {
    "==": (a, b) => a === b,
    ">=": (a, b) => a >= b,
  };
  return {
    store,
    doc: (_db, ...p) => p.join("/"),
    collection: (_db, ...p) => ({ col: p.join("/") }),
    where: (f, op, v) => ({ f, op, v }),
    orderBy: (f, dir) => ({ ord: f, dir }),
    limit: (n) => ({ lim: n }),
    // query(collection, ...clauses): a single where() is the common case, as before.
    query: (c, ...clauses) => ({
      ...c,
      w: clauses.find((x) => x.op),
      ord: clauses.find((x) => x.ord),
      lim: clauses.find((x) => x.lim),
    }),
    setDoc: async (ref, data) => {
      fail(ref);
      store.set(ref, data);
    },
    deleteDoc: async (ref) => {
      fail(ref);
      store.delete(ref);
    },
    getDocs: async (q) => {
      let docs = [...store.entries()]
        .filter(
          ([k, v]) =>
            k.startsWith(q.col + "/") &&
            !k.slice(q.col.length + 1).includes("/") &&
            (!q.w || OPS[q.w.op](v[q.w.f], q.w.v)),
        )
        .map(([, v]) => v);
      if (q.ord)
        docs.sort((a, b) =>
          q.ord.dir === "desc"
            ? b[q.ord.ord] - a[q.ord.ord]
            : a[q.ord.ord] - b[q.ord.ord],
        );
      if (q.lim) docs = docs.slice(0, q.lim.lim);
      return { docs: docs.map((v) => ({ data: () => v })) };
    },
  };
}
module.exports = { fakeFs };
