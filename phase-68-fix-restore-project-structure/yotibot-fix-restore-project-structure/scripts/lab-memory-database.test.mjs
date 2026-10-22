import test from "node:test";
import assert from "node:assert/strict";
import { createLabMemoryDatabase } from "./lab-memory-database.mjs";

let firstInstance;

test("Lab memory database isolates schemas and rows per test instance", t => {
  firstInstance = createLabMemoryDatabase(t);
  firstInstance.createSchema("qa_case");
  firstInstance.createTable("qa_case", "events");
  firstInstance.insert("qa_case", "events", { id: "fixture-1", text: "synthetic" });

  const secondInstance = createLabMemoryDatabase(t);
  secondInstance.createSchema("qa_case");
  secondInstance.createTable("qa_case", "events");

  assert.deepEqual(firstInstance.selectAll("qa_case", "events"), [
    { id: "fixture-1", text: "synthetic" },
  ]);
  assert.deepEqual(secondInstance.selectAll("qa_case", "events"), []);
});

test("each Lab memory instance auto-tears down at the test boundary", t => {
  const instance = createLabMemoryDatabase(t);
  instance.createSchema("qa_cleanup");
  instance.createTable("qa_cleanup", "records");
  instance.insert("qa_cleanup", "records", { id: "temporary" });
  t.after(() => assert.equal(instance.isClosed, true));
});

test("the prior test instance was automatically cleared and is unusable", () => {
  assert.equal(firstInstance.isClosed, true);
  assert.throws(
    () => firstInstance.selectAll("qa_case", "events"),
    /already torn down/u,
  );
});
