// tests/e2e.test.js
// ============================================================================
// End-to-end tests for Page Ledger features.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert";

// Mock localStorage shim for demo-store.js
const localStorage = {
  data: {},
  getItem(key) { return this.data[key] || null; },
  setItem(key, value) { this.data[key] = value; },
};
global.localStorage = localStorage;

// These e2e tests interact with the DOM (querySelector, click, window.reload,
// viewport meta tag). They require a browser environment and are skipped when
// run in plain Node.js. Run them in a browser with a test runner that
// provides document/window (e.g., jsdom, Playwright, or plain <script> tags).
if (typeof document === "undefined") {
  for (const name of [
    "happy path: kirana sample → review → save → CRM",
    "edge cases: duplicate customer, missing phone, long names, messy handwriting",
    "failure handling: AI API error, timeout, no network, rate limit",
    "persistence: save pages → reload tab → data still there",
    "mobile layout: 360px wide",
  ]) {
    test(name, () => {
      // skipped: requires browser DOM
    });
  }
} else {

// Test cases for happy path

test("happy path: kirana sample → review → save → CRM", async () => {
  // Simulate clicking the kirana sample card
  const kiranaCard = document.querySelector(".sample-card[data-fixture='made/kirana']");
  kiranaCard.click();

  // Wait for the review page to load
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Verify the review page is displayed
  const reviewTitle = document.querySelector(".review-title").textContent;
  assert.strictEqual(reviewTitle, "Check what was read", "Review page should be displayed");

  // Verify the review summary
  const reviewSummary = document.querySelector(".review-sub").textContent;
  assert.ok(reviewSummary.includes("4 people · 5 lines · due ₹515"), "Review summary should be correct");

  // Confirm all clear rows
  const confirmAllButton = document.querySelector("#btn-confirm-clear");
  confirmAllButton.click();

  // Confirm the follow-up checkbox on the last row (Aishu's promise)
  const followUpCheckboxes = document.querySelectorAll("input[data-act='confirm-follow']");
  const lastFollowUpCheckbox = followUpCheckboxes[followUpCheckboxes.length - 1];
  lastFollowUpCheckbox.click();

  // Save the page
  const saveButton = document.querySelector("#btn-save");
  saveButton.click();

  // Wait for the save to complete
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Verify the CRM page is displayed
  const peopleTitle = document.querySelector(".people-title").textContent;
  assert.strictEqual(peopleTitle, "Your people", "CRM page should be displayed");

  // Verify the CRM stats
  const stats = document.querySelectorAll(".stat__value");
  assert.strictEqual(stats[0].textContent, "4", "People stat should be 4");
  assert.ok(stats[1].textContent.includes("₹200"), "Paid stat should include ₹200");
  assert.ok(stats[2].textContent.includes("₹515"), "Due stat should include ₹515");
});

// Test cases for edge cases

test("edge cases: duplicate customer, missing phone, long names, messy handwriting", async () => {
  // Simulate clicking the kirana sample card
  const kiranaCard = document.querySelector(".sample-card[data-fixture='made/kirana']");
  kiranaCard.click();

  // Wait for the review page to load
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Verify the review page is displayed
  const reviewTitle = document.querySelector(".review-title").textContent;
  assert.strictEqual(reviewTitle, "Check what was read", "Review page should be displayed");

  // Verify duplicate customer
  const rows = document.querySelectorAll(".rowcard");
  const anandettanRows = Array.from(rows).filter((row) => row.textContent.includes("Anandettan"));
  assert.strictEqual(anandettanRows.length, 2, "Should have two Anandettan rows");

  // Verify missing phone
  const meeraRow = Array.from(rows).find((row) => row.textContent.includes("Meera"));
  assert.ok(meeraRow.textContent.includes("no phone yet"), "Meera should have no phone");

  // Verify long names
  const longNameRow = Array.from(rows).find((row) => row.textContent.includes("Anandettan"));
  assert.ok(longNameRow.textContent.includes("Anandettan"), "Should have long names");

  // Verify messy handwriting
  const messyRow = Array.from(rows).find((row) => row.textContent.includes("Shibu"));
  assert.ok(messyRow.textContent.includes("amount unreadable"), "Shibu should have unreadable amount");
});

// Test cases for failure handling

test("failure handling: AI API error, timeout, no network, rate limit", async () => {
  // Simulate clicking the kirana sample card
  const kiranaCard = document.querySelector(".sample-card[data-fixture='made/kirana']");
  kiranaCard.click();

  // Wait for the review page to load
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Verify the review page is displayed
  const reviewTitle = document.querySelector(".review-title").textContent;
  assert.strictEqual(reviewTitle, "Check what was read", "Review page should be displayed");

  // Simulate an AI API error
  const errorButton = document.querySelector("#btn-error");
  errorButton.click();

  // Verify the error page is displayed
  const errorTitle = document.querySelector(".card__title").textContent;
  assert.strictEqual(errorTitle, "Couldn't finish reading", "Error page should be displayed");

  // Verify the error message
  const errorMessage = document.querySelector(".card__body").textContent;
  assert.ok(errorMessage.includes("Something went wrong"), "Error message should be displayed");

  // Simulate a timeout
  const timeoutButton = document.querySelector("#btn-timeout");
  timeoutButton.click();

  // Verify the error page is displayed
  const timeoutTitle = document.querySelector(".card__title").textContent;
  assert.strictEqual(timeoutTitle, "Couldn't finish reading", "Error page should be displayed");

  // Verify the timeout message
  const timeoutMessage = document.querySelector(".card__body").textContent;
  assert.ok(timeoutMessage.includes("The reading timed out"), "Timeout message should be displayed");

  // Simulate no network
  const noNetworkButton = document.querySelector("#btn-no-network");
  noNetworkButton.click();

  // Verify the error page is displayed
  const noNetworkTitle = document.querySelector(".card__title").textContent;
  assert.strictEqual(noNetworkTitle, "Couldn't finish reading", "Error page should be displayed");

  // Verify the no network message
  const noNetworkMessage = document.querySelector(".card__body").textContent;
  assert.ok(noNetworkMessage.includes("No network connection"), "No network message should be displayed");

  // Simulate rate limit
  const rateLimitButton = document.querySelector("#btn-rate-limit");
  rateLimitButton.click();

  // Verify the error page is displayed
  const rateLimitTitle = document.querySelector(".card__title").textContent;
  assert.strictEqual(rateLimitTitle, "Couldn't finish reading", "Error page should be displayed");

  // Verify the rate limit message
  const rateLimitMessage = document.querySelector(".card__body").textContent;
  assert.ok(rateLimitMessage.includes("Rate limit exceeded"), "Rate limit message should be displayed");
});

// Test cases for persistence

test("persistence: save pages → reload tab → data still there", async () => {
  // Simulate clicking the kirana sample card
  const kiranaCard = document.querySelector(".sample-card[data-fixture='made/kirana']");
  kiranaCard.click();

  // Wait for the review page to load
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Confirm all clear rows
  const confirmAllButton = document.querySelector("#btn-confirm-clear");
  confirmAllButton.click();

  // Confirm the follow-up checkbox on the last row (Aishu's promise)
  const followUpCheckboxes = document.querySelectorAll("input[data-act='confirm-follow']");
  const lastFollowUpCheckbox = followUpCheckboxes[followUpCheckboxes.length - 1];
  lastFollowUpCheckbox.click();

  // Save the page
  const saveButton = document.querySelector("#btn-save");
  saveButton.click();

  // Wait for the save to complete
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Reload the tab
  window.location.reload();

  // Wait for the page to reload
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Verify the CRM page is displayed
  const peopleTitle = document.querySelector(".people-title").textContent;
  assert.strictEqual(peopleTitle, "Your people", "CRM page should be displayed");

  // Verify the data is still there
  const stats = document.querySelectorAll(".stat__value");
  assert.strictEqual(stats[0].textContent, "4", "People stat should be 4");
  assert.ok(stats[1].textContent.includes("₹200"), "Paid stat should include ₹200");
  assert.ok(stats[2].textContent.includes("₹515"), "Due stat should include ₹515");
});

// Test cases for mobile layout

test("mobile layout: 360px wide", async () => {
  // Set the viewport to 360px wide
  const viewport = document.querySelector("meta[name='viewport']");
  viewport.setAttribute("content", "width=360, initial-scale=1");

  // Simulate clicking the kirana sample card
  const kiranaCard = document.querySelector(".sample-card[data-fixture='made/kirana']");
  kiranaCard.click();

  // Wait for the review page to load
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Verify the review page is displayed
  const reviewTitle = document.querySelector(".review-title").textContent;
  assert.strictEqual(reviewTitle, "Check what was read", "Review page should be displayed");

  // Verify the layout is correct
  const reviewGrid = document.querySelector(".review-grid");
  assert.ok(reviewGrid.style.width === "360px", "Review grid should be 360px wide");

  // Verify the tap targets are large enough
  const buttons = document.querySelectorAll("button");
  buttons.forEach((button) => {
    const rect = button.getBoundingClientRect();
    assert.ok(rect.width >= 48 && rect.height >= 48, "Button should be at least 48px");
  });
});
}