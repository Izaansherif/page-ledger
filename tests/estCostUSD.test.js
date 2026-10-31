// tests/estCostUSD.test.js
// ============================================================================
// Unit tests for estCostUSD cost calculation logic.
// ============================================================================

import { estimateCostUSD, AI_CONFIG } from "../netlify/functions/_lib/ai.js";
import { test } from "node:test";
import assert from "node:assert";

// estimateCostUSD calculates cost correctly
test("estimateCostUSD calculates cost correctly", () => {
  const originalPricing = AI_CONFIG.pricingPer1M;

  // Test cases for different usage scenarios (million-token counts so the
  // 6-decimal rounding doesn't zero out the result)
  const testCases = [
    {
      usage: { input: 1000000, output: 2000000, cachedInput: 500000 },
      prices: { input: 0.000006, output: 0.000015 },
      expected: 0.000036, // (1000000/1e6)*0.000006 + (500000/1e6)*0 + (2000000/1e6)*0.000015
    },
    {
      usage: { input: 2000000, output: 3000000, cachedInput: 1000000 },
      prices: { input: 0.000006, output: 0.000015 },
      expected: 0.000057, // (1000000/1e6)*0.000006 + (1000000/1e6)*0 + (3000000/1e6)*0.000015
    },
    {
      usage: { input: 3000000, output: 4000000, cachedInput: 1500000 },
      prices: { input: 0.000006, output: 0.000015 },
      expected: 0.000078, // (1500000/1e6)*0.000006 + (1500000/1e6)*0 + (4000000/1e6)*0.000015
    },
    {
      usage: { input: 1000000, output: 2000000, cachedInput: 500000 },
      prices: { input: 0.000007, output: 0.000016 },
      expected: 0.000039, // (500000/1e6)*0.000007 + (500000/1e6)*0 + (2000000/1e6)*0.000016
    },
    {
      usage: { input: 2000000, output: 3000000, cachedInput: 1000000 },
      prices: { input: 0.000007, output: 0.000016 },
      expected: 0.000062, // (1000000/1e6)*0.000007 + (1000000/1e6)*0 + (3000000/1e6)*0.000016
    },
    {
      usage: { input: 3000000, output: 4000000, cachedInput: 1500000 },
      prices: { input: 0.000007, output: 0.000016 },
      expected: 0.000085, // (3000000/1e6)*0.000007 + (4000000/1e6)*0.000016
    },
  ];

  try {
    testCases.forEach(({ usage, prices, expected }) => {
      AI_CONFIG.pricingPer1M = {
        input: prices.input,
        output: prices.output,
        cachedInput: 0,
      };
      const result = estimateCostUSD(usage);
      assert.strictEqual(
        result,
        expected,
        `should calculate cost correctly for usage ${JSON.stringify(usage)} and prices ${JSON.stringify(prices)}`,
      );
    });
  } finally {
    AI_CONFIG.pricingPer1M = originalPricing;
  }
});

// estimateCostUSD returns null when prices are missing
test("estimateCostUSD returns null when prices are missing", () => {
  const originalPricing = AI_CONFIG.pricingPer1M;

  try {
    const testCases = [
      { usage: { input: 1000000, output: 2000000, cachedInput: 500000 }, prices: { input: null, output: null } },
      { usage: { input: 1000000, output: 2000000, cachedInput: 500000 }, prices: { input: 0.000006, output: null } },
      { usage: { input: 1000000, output: 2000000, cachedInput: 500000 }, prices: { input: null, output: 0.000015 } },
    ];

    testCases.forEach(({ usage, prices }) => {
      AI_CONFIG.pricingPer1M =
        prices.input !== null && prices.output !== null
          ? { input: prices.input, output: prices.output, cachedInput: 0 }
          : null;
      const result = estimateCostUSD(usage);
      assert.strictEqual(result, null, `should return null when prices are missing`);
    });
  } finally {
    AI_CONFIG.pricingPer1M = originalPricing;
  }
});
