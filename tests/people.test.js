// tests/people.test.js
// ============================================================================
// Unit tests for people.js folding logic (buildPeople).
// ============================================================================

import { buildPeople } from "../js/people.js";
import { test } from "node:test";
import assert from "node:assert";

// A minimal saved page shape: { id, taken_on, page_rows: [...] }
const page = (id, takenOn, rows) => ({ id, taken_on: takenOn, page_rows: rows });

const row = (overrides) => ({
  row_index: 0,
  raw_text: "",
  name: null,
  phone: null,
  note: null,
  amount_paid: null,
  amount_due: null,
  follow_up_text: null,
  follow_up_date: null,
  follow_up_confirmed: false,
  follow_up_done: false,
  struck_out: false,
  flags: [],
  confidence: {},
  ...overrides,
});

// buildPeople folds rows into people correctly
test("buildPeople folds rows into people correctly", () => {
  const rows = [
    row({
      name: "Anandettan",
      phone: "9447000090",
      amount_paid: null,
      amount_due: 350,
      follow_up_date: "2026-10-30",
      follow_up_confirmed: true,
      follow_up_done: false,
      struck_out: false,
      id: "row1",
    }),
    row({
      name: "Anandettan",
      phone: "9447000090",
      amount_paid: 45,
      amount_due: null,
      follow_up_date: null,
      follow_up_confirmed: false,
      follow_up_done: false,
      struck_out: false,
      id: "row2",
    }),
    row({
      name: "Meera",
      phone: null,
      amount_paid: 200,
      amount_due: 120,
      follow_up_confirmed: false,
      follow_up_done: false,
      struck_out: false,
      id: "row3",
    }),
  ];

  const result = buildPeople([page("page1", "2026-10-29", rows)]);

  assert.strictEqual(result.all.length, 2, "should fold two people");

  const anandettan = result.all.find((p) => p.name === "Anandettan");
  assert.ok(anandettan, "Anandettan should exist");
  assert.strictEqual(anandettan.due, 350, "Anandettan due should be 350");
  assert.strictEqual(anandettan.paid, 45, "Anandettan paid should be 45");
  assert.ok(anandettan.followUp, "Anandettan should have a follow-up");
  assert.strictEqual(anandettan.followUp.date, "2026-10-30", "Anandettan follow-up date should be 2026-10-30");
  assert.strictEqual(anandettan.followUp.rowId, "row1", "Anandettan follow-up rowId should be row1");
  assert.strictEqual(anandettan.followUp.pageId, "page1", "Anandettan follow-up pageId should be page1");

  const meera = result.all.find((p) => p.name === "Meera");
  assert.ok(meera, "Meera should exist");
  assert.strictEqual(meera.due, 120, "Meera due should be 120");
  assert.strictEqual(meera.paid, 200, "Meera paid should be 200");
  assert.strictEqual(meera.followUp, null, "Meera should have no follow-up");
});

// buildPeople merges duplicate customers
test("buildPeople merges duplicate customers", () => {
  const rows = [
    row({
      name: "Anandettan",
      phone: "9447000090",
      amount_paid: null,
      amount_due: 350,
      follow_up_date: "2026-10-30",
      follow_up_confirmed: true,
      follow_up_done: false,
      struck_out: false,
      id: "row1",
    }),
    row({
      name: "Anandettan",
      phone: "9447000090",
      amount_paid: 45,
      amount_due: null,
      follow_up_confirmed: false,
      follow_up_done: false,
      struck_out: false,
      id: "row2",
    }),
  ];

  const result = buildPeople([page("page1", "2026-10-29", rows)]);

  assert.strictEqual(result.all.length, 1, "should merge duplicate customers");

  const anandettan = result.all[0];
  assert.strictEqual(anandettan.due, 350, "Anandettan due should be 350");
  assert.strictEqual(anandettan.paid, 45, "Anandettan paid should be 45");
  assert.ok(anandettan.followUp, "Anandettan should have a follow-up");
  assert.strictEqual(anandettan.followUp.date, "2026-10-30", "Anandettan follow-up date should be 2026-10-30");
});

// buildPeople handles missing phone
test("buildPeople handles missing phone", () => {
  const rows = [
    row({
      name: "Anandettan",
      phone: null,
      amount_paid: null,
      amount_due: 350,
      follow_up_date: "2026-10-30",
      follow_up_confirmed: true,
      follow_up_done: false,
      struck_out: false,
      id: "row1",
    }),
  ];

  const result = buildPeople([page("page1", "2026-10-29", rows)]);

  assert.strictEqual(result.all.length, 1, "should handle missing phone");

  const anandettan = result.all[0];
  assert.strictEqual(anandettan.phone, null, "Anandettan phone should be null");
});

// buildPeople excludes struck-out rows
test("buildPeople excludes struck-out rows", () => {
  const rows = [
    row({
      name: "Anandettan",
      phone: "9447000090",
      amount_paid: null,
      amount_due: 350,
      follow_up_confirmed: false,
      follow_up_done: false,
      struck_out: true,
      id: "row1",
    }),
  ];

  const result = buildPeople([page("page1", "2026-10-29", rows)]);

  assert.strictEqual(result.all.length, 0, "should exclude struck-out rows");
});

// buildPeople handles follow-up done
test("buildPeople handles follow-up done", () => {
  const rows = [
    row({
      name: "Anandettan",
      phone: "9447000090",
      amount_paid: null,
      amount_due: 350,
      follow_up_date: "2026-10-30",
      follow_up_confirmed: true,
      follow_up_done: true,
      struck_out: false,
      id: "row1",
    }),
  ];

  const result = buildPeople([page("page1", "2026-10-29", rows)]);

  assert.strictEqual(result.all.length, 1, "should handle follow-up done");

  const anandettan = result.all[0];
  // a Done follow-up is removed from the pending list
  assert.strictEqual(anandettan.followUp, null, "follow-up should be null when done");
});
