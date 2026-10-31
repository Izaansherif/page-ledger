// tests/demo-store.test.js
// ============================================================================
// Unit tests for demo-store.js money allocation logic.
// ============================================================================

import {
  savePage,
  setFollowUpDone,
  recordPayment,
  listRecentPages,
  getSession,
} from "../js/demo-store.js";
import { test } from "node:test";
import assert from "node:assert";

// Mock localStorage shim for demo-store.js
const localStorage = {
  data: {},
  getItem(key) { return this.data[key] || null; },
  setItem(key, value) { this.data[key] = value; },
};
global.localStorage = localStorage;

const pageRow = (overrides) => ({
  id: "row-" + Math.random().toString(36).slice(2, 10),
  rowIndex: 0,
  rawText: "",
  name: null,
  phone: null,
  note: null,
  amountPaid: null,
  amountDue: null,
  followUpText: null,
  followUpDate: null,
  followUpConfirmed: false,
  followUpDone: false,
  struckOut: false,
  flags: [],
  confidence: {},
  ...overrides,
});

async function ensureDemoStore() {
  getSession(); // demo-store auto-creates a device owner session
}

// savePage generates its own ids, so we read the page back from the store
// to get the actual page and row ids.
async function saveAndGetPage(rows) {
  const result = await savePage({ takenOn: "2026-10-29", rows });
  const pages = await listRecentPages();
  const page = pages.find((p) => p.id === result.pageId);
  return { pageId: page.id, page };
}

test("setFollowUpDone marks a follow-up as done", async () => {
  await ensureDemoStore();
  const { pageId, page } = await saveAndGetPage([
    pageRow({
      name: "Ravi K.",
      phone: "9876500021",
      amountDue: 300,
      followUpDate: "2026-10-30",
      followUpConfirmed: true,
      followUpDone: false,
    }),
  ]);
  const rowId = page.page_rows[0].id;

  await setFollowUpDone(pageId, rowId, true);

  const pages = await listRecentPages();
  const savedPage = pages.find((p) => p.id === pageId);
  const row = savedPage.page_rows.find((r) => r.id === rowId);

  assert.strictEqual(row.follow_up_done, true, "should mark follow-up as done");
});

test("recordPayment allocates payments oldest-first", async () => {
  await ensureDemoStore();
  const { pageId, page } = await saveAndGetPage([
    pageRow({
      name: "Anandettan",
      phone: "9447000090",
      amountDue: 45,
      followUpConfirmed: false,
      followUpDone: false,
    }),
    pageRow({
      name: "Anandettan",
      phone: null,
      amountDue: 350,
      followUpDate: "2026-10-30",
      followUpConfirmed: true,
      followUpDone: false,
    }),
  ]);
  const rowId1 = page.page_rows[0].id;
  const rowId2 = page.page_rows[1].id;

  await recordPayment([
    { pageId, rowId: rowId1, amountPaid: 45, followUpDone: false },
    { pageId, rowId: rowId2, amountPaid: 350, followUpDone: true },
  ]);

  const pages = await listRecentPages();
  const savedPage = pages.find((p) => p.id === pageId);
  const row1 = savedPage.page_rows.find((r) => r.id === rowId1);
  const row2 = savedPage.page_rows.find((r) => r.id === rowId2);

  assert.strictEqual(row1.amount_paid, 45, "should allocate ₹45 to the first row");
  assert.strictEqual(row2.amount_paid, 350, "should allocate ₹350 to the second row");
  assert.strictEqual(row1.amount_due, null, "should set amount_due to null for the first row");
  assert.strictEqual(row2.amount_due, null, "should set amount_due to null for the second row");
  assert.strictEqual(row2.follow_up_done, true, "should mark the follow-up as done for the second row");
});

test("recordPayment handles partial payments", async () => {
  await ensureDemoStore();
  const { pageId, page } = await saveAndGetPage([
    pageRow({
      name: "Anandettan",
      phone: "9447000090",
      amountDue: 45,
      followUpConfirmed: false,
      followUpDone: false,
    }),
    pageRow({
      name: "Anandettan",
      phone: null,
      amountDue: 350,
      followUpDate: "2026-10-30",
      followUpConfirmed: true,
      followUpDone: false,
    }),
  ]);
  const rowId1 = page.page_rows[0].id;
  const rowId2 = page.page_rows[1].id;

  await recordPayment([
    { pageId, rowId: rowId1, amountPaid: 45, followUpDone: false },
    { pageId, rowId: rowId2, amountPaid: 55, followUpDone: false },
  ]);

  const pages = await listRecentPages();
  const savedPage = pages.find((p) => p.id === pageId);
  const row1 = savedPage.page_rows.find((r) => r.id === rowId1);
  const row2 = savedPage.page_rows.find((r) => r.id === rowId2);

  assert.strictEqual(row1.amount_paid, 45, "should allocate ₹45 to the first row");
  assert.strictEqual(row2.amount_paid, 55, "should allocate ₹55 to the second row");
  assert.strictEqual(row1.amount_due, null, "should set amount_due to null for the first row");
  assert.strictEqual(row2.amount_due, 295, "should set amount_due to 295 for the second row");
  assert.strictEqual(row2.follow_up_done, false, "should not mark the follow-up as done for the second row");
});

test("recordPayment handles full settlement closes follow-up", async () => {
  await ensureDemoStore();
  const { pageId, page } = await saveAndGetPage([
    pageRow({
      name: "Anandettan",
      phone: "9447000090",
      amountDue: 45,
      followUpConfirmed: false,
      followUpDone: false,
    }),
    pageRow({
      name: "Anandettan",
      phone: null,
      amountDue: 350,
      followUpDate: "2026-10-30",
      followUpConfirmed: true,
      followUpDone: false,
    }),
  ]);
  const rowId1 = page.page_rows[0].id;
  const rowId2 = page.page_rows[1].id;

  await recordPayment([
    { pageId, rowId: rowId1, amountPaid: 45, followUpDone: false },
    { pageId, rowId: rowId2, amountPaid: 350, followUpDone: true },
  ]);

  const pages = await listRecentPages();
  const savedPage = pages.find((p) => p.id === pageId);
  const row1 = savedPage.page_rows.find((r) => r.id === rowId1);
  const row2 = savedPage.page_rows.find((r) => r.id === rowId2);

  assert.strictEqual(row1.amount_paid, 45, "should allocate ₹45 to the first row");
  assert.strictEqual(row2.amount_paid, 350, "should allocate ₹350 to the second row");
  assert.strictEqual(row1.amount_due, null, "should set amount_due to null for the first row");
  assert.strictEqual(row2.amount_due, null, "should set amount_due to null for the second row");
  assert.strictEqual(row2.follow_up_done, true, "should mark the follow-up as done for the second row");
});
