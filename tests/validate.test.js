// tests/validate.test.js
// ============================================================================
// Unit tests for validate.js validation logic.
// ============================================================================

import { validateExtraction } from "../netlify/functions/_lib/validate.js";
import { test } from "node:test";
import assert from "node:assert";

const row = (overrides) => ({
  row_index: 0,
  raw_text: "Ravi K. 98765 00021 · arch wire change · ₹300",
  name: "Ravi K.",
  phone: "9876500021",
  note: "arch wire change",
  amount_paid: null,
  amount_due: 300,
  follow_up_text: null,
  follow_up_date: null,
  struck_out: false,
  flags: [],
  confidence: { name: 0.9, phone: 0.85, amount_paid: null, amount_due: 0.88, follow_up_date: null },
  bbox: [82, 162, 873, 61],
  ...overrides,
});

const extraction = (overrides) => ({
  columns_detected: ["name / phone", "work", "amount ₹"],
  rows: [row()],
  page_total_written: null,
  page_warnings: [
    "Bottom half of the page is unused",
    "One amount is smudged and unreadable",
    "One line is crossed out",
  ],
  ...overrides,
});

// validateExtraction validates a correct extraction
test("validateExtraction validates a correct extraction", () => {
  const result = validateExtraction(extraction());

  assert.strictEqual(result.ok, true, "should validate a correct extraction");
  assert.strictEqual(result.errors.length, 0, "should have no errors");
});

// validateExtraction handles missing phone
test("validateExtraction handles missing phone", () => {
  const result = validateExtraction(extraction({ rows: [row({ phone: null })] }));

  assert.strictEqual(result.ok, true, "should validate extraction with missing phone");
  assert.strictEqual(result.errors.length, 0, "should have no errors");
});

// validateExtraction excludes struck-out rows
test("validateExtraction excludes struck-out rows", () => {
  const result = validateExtraction(extraction({ rows: [row({ struck_out: true })] }));

  assert.strictEqual(result.ok, true, "should exclude struck-out rows");
  assert.strictEqual(result.errors.length, 0, "should have no errors");
});

// validateExtraction handles amounts with commas or currency symbols
test("validateExtraction handles amounts with commas or currency symbols", () => {
  const result = validateExtraction(extraction({ rows: [row({ amount_due: 3000 })] }));

  assert.strictEqual(result.ok, true, "should handle amounts with commas or currency symbols");
  assert.strictEqual(result.errors.length, 0, "should have no errors");
});

// validateExtraction handles very long names
test("validateExtraction handles very long names", () => {
  const result = validateExtraction(extraction({ rows: [row({ name: "Ravi Kumar Singhania" })] }));

  assert.strictEqual(result.ok, true, "should handle very long names");
  assert.strictEqual(result.errors.length, 0, "should have no errors");
});

// validateExtraction rejects empty pages (rule: at least one row required)
test("validateExtraction rejects empty pages", () => {
  const result = validateExtraction(extraction({ rows: [] }));

  assert.strictEqual(result.ok, false, "should reject empty pages");
  assert.ok(result.errors.some((e) => e.includes("rows")), "should report rows error");
});

// validateExtraction rejects invalid follow_up_date format
test("validateExtraction rejects invalid follow_up_date format", () => {
  const result = validateExtraction(extraction({ rows: [row({ follow_up_date: "tomorrow" })] }));

  assert.strictEqual(result.ok, false, "should reject invalid follow_up_date format");
  assert.ok(result.errors.some((e) => e.includes("follow_up_date")), "should report follow_up_date error");
});

// validateExtraction rejects negative amounts
test("validateExtraction rejects negative amounts", () => {
  const result = validateExtraction(extraction({ rows: [row({ amount_due: -50 })] }));

  assert.strictEqual(result.ok, false, "should reject negative amounts");
  assert.ok(result.errors.some((e) => e.includes("amount_due")), "should report amount_due error");
});
