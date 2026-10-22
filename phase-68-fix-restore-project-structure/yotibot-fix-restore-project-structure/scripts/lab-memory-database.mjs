function assertOpen(state) {
  if (state.closed) throw new Error("Lab memory database is already torn down.");
}

export function createLabMemoryDatabase(testContext) {
  if (typeof testContext?.after !== "function") {
    throw new TypeError("A Node test context is required for automatic Lab teardown.");
  }

  const state = { closed: false, schemas: new Map() };
  const database = {
    createSchema(name) {
      assertOpen(state);
      if (!name || state.schemas.has(name)) throw new Error("Lab schema name is invalid or already in use.");
      state.schemas.set(name, new Map());
    },
    createTable(schema, table) {
      assertOpen(state);
      const tables = state.schemas.get(schema);
      if (!tables || !table || tables.has(table)) throw new Error("Lab schema or table is invalid.");
      tables.set(table, []);
    },
    insert(schema, table, row) {
      assertOpen(state);
      const rows = state.schemas.get(schema)?.get(table);
      if (!rows) throw new Error("Lab table does not exist.");
      rows.push(structuredClone(row));
    },
    selectAll(schema, table) {
      assertOpen(state);
      const rows = state.schemas.get(schema)?.get(table);
      if (!rows) throw new Error("Lab table does not exist.");
      return structuredClone(rows);
    },
    dropSchema(name) {
      assertOpen(state);
      state.schemas.delete(name);
    },
    teardown() {
      state.schemas.clear();
      state.closed = true;
    },
    get isClosed() {
      return state.closed;
    },
  };

  testContext.after(() => database.teardown());
  return database;
}
