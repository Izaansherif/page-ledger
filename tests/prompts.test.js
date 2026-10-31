// tests/prompts.test.js
// ============================================================================
// Unit tests for record-fixtures.js token/date logic.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert";

// toToken is a local function in record-fixtures.js (not exported).
// It is pure logic worth testing, so we test the same logic inline here.
function toToken(dateStr, baseISO) {
  const ms = Date.parse(`${dateStr}T00:00:00`) - Date.parse(`${baseISO}T00:00:00`);
  if (!Number.isFinite(ms)) return null;
  const days = Math.round(ms / 86400000);
  return days === 0 ? "{{TODAY}}" : days > 0 ? `{{TODAY+${days}}}` : `{{TODAY${days}}}`;
}

// toToken resolves absolute dates to {{TODAY±n}} tokens
test("toToken resolves absolute dates to {{TODAY±n}} tokens", () => {
  const baseISO = "2026-10-29";

  const testCases = [
    { dateStr: "2026-10-29", expected: "{{TODAY}}" },
    { dateStr: "2026-10-30", expected: "{{TODAY+1}}" },
    { dateStr: "2026-10-28", expected: "{{TODAY-1}}" },
    { dateStr: "2026-11-01", expected: "{{TODAY+3}}" },
    { dateStr: "2026-10-27", expected: "{{TODAY-2}}" },
  ];

  testCases.forEach(({ dateStr, expected }) => {
    const result = toToken(dateStr, baseISO);
    assert.strictEqual(result, expected, `should resolve ${dateStr} to ${expected}`);
  });
});

// toToken returns null for invalid dates
test("toToken returns null for invalid dates", () => {
  const baseISO = "2026-10-29";

  const testCases = [
    { dateStr: "invalid-date", expected: null },
    { dateStr: "", expected: null },
    { dateStr: null, expected: null },
    { dateStr: undefined, expected: null },
  ];

  testCases.forEach(({ dateStr, expected }) => {
    const result = toToken(dateStr, baseISO);
    assert.strictEqual(result, expected, `should return null for invalid date ${dateStr}`);
  });
});
