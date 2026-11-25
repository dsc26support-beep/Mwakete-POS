// A tiny in-memory fake of the Firestore functions the Firebase adapter uses.
function fakeFs({ failWith = {}, existing = {} } = {}) {
  const store = new Map(Object.entries(existing));
  const fail = (ref) => {
    const id = ref.split("/").pop();
    if (failWith[id])
      throw Object.assign(new Error("x"), { code: failWith[id] });
  };
  return {
    store,
    doc: (_db, ...p) => p.join("/"),
    collection: (_db, ...p) => ({ col: p.join("/") }),
    where: (f, op, v) => ({ f, op, v }),
    query: (c, w) => ({ ...c, w }),
    setDoc: async (ref, data) => {
      fail(ref);
      store.set(ref, data);
    },
    deleteDoc: async (ref) => {
      fail(ref);
      store.delete(ref);
    },
    getDocs: async (q) => ({
      docs: [...store.entries()]
        .filter(
          ([k, v]) =>
            k.startsWith(q.col + "/") &&
            !k.slice(q.col.length + 1).includes("/") &&
            (!q.w || v[q.w.f] === q.w.v),
        )
        .map(([, v]) => ({ data: () => v })),
    }),
  };
}
module.exports = { fakeFs };
