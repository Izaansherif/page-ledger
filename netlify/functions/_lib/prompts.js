// netlify/functions/_lib/prompts.js
// The extraction prompt from the project doc, kept EXACTLY as written
// (that text is the core of the product - do not reword it casually).
// Only the {{today in YYYY-MM-DD}} placeholder is substituted at call time.

export const EXTRACTION_PROMPT_TEMPLATE = `You read photos of pages from handwritten or printed business notebooks and ledgers kept by small businesses in India. Text may mix English, Hindi, Malayalam or other Indian languages. Extract every customer row on the page.

Return ONLY valid JSON matching the schema. No commentary.

RULES:
- Never guess. If something is unreadable or missing, use null and lower its confidence.
- name: as written. Do not translate or correct spelling.
- phone: digits only. If it does not have 10 digits, still return what you read and add "phone_not_10_digits" to row flags.
- amounts: plain numbers, no currency symbols or commas. "paid" is money received, "due" is money still owed. If the page uses one column, decide from context and add "amount_ambiguous" to row flags.
- dates: keep the original text exactly in follow_up_text (e.g. "after 2 weeks"). Give follow_up_date as YYYY-MM-DD ONLY if it can be worked out with certainty from BASE_DATE, otherwise null.
- If a row is crossed out, set struck_out to true.
- raw_text: the full line as you read it, so a human can compare.
- If the page shows a written total, return it as page_total_written, otherwise null.
- confidence: 0 to 1 for each field you return.
- page_warnings: anything that affects reliability (cut off, blurry, shadow, rows overlapping, tilted).

BASE_DATE: {{today in YYYY-MM-DD}}

SCHEMA:
{
  "columns_detected": ["string"],
  "rows": [{
    "row_index": 0,
    "raw_text": "string",
    "name": "string|null",
    "phone": "string|null",
    "note": "string|null",
    "amount_paid": "number|null",
    "amount_due": "number|null",
    "follow_up_text": "string|null",
    "follow_up_date": "YYYY-MM-DD|null",
    "struck_out": false,
    "flags": ["string"],
    "confidence": {"name":0,"phone":0,"amount_paid":0,"amount_due":0,"follow_up_date":0}
  }],
  "page_total_written": "number|null",
  "page_warnings": ["string"]
}`;

export function buildExtractionSystemPrompt(baseDate) {
  return EXTRACTION_PROMPT_TEMPLATE.replaceAll("{{today in YYYY-MM-DD}}", baseDate);
}

// Real JSON Schema sent as response_format (structured output). The docs confirm
// the model constrains decoding to this schema, so output always parses.
// Kept non-recursive and flat (schema limits: no recursion, nesting <= 10).
export const EXTRACTION_SCHEMA_NAME = "NotebookExtraction";

export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["columns_detected", "rows", "page_total_written", "page_warnings"],
  properties: {
    columns_detected: { type: "array", items: { type: "string" } },
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "row_index", "raw_text", "name", "phone", "note",
          "amount_paid", "amount_due", "follow_up_text", "follow_up_date",
          "struck_out", "flags", "confidence",
        ],
        properties: {
          row_index: { type: "number" },
          raw_text: { type: "string" },
          name: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          note: { type: ["string", "null"] },
          amount_paid: { type: ["number", "null"] },
          amount_due: { type: ["number", "null"] },
          follow_up_text: { type: ["string", "null"] },
          follow_up_date: { type: ["string", "null"] },
          struck_out: { type: "boolean" },
          flags: { type: "array", items: { type: "string" } },
          confidence: {
            type: "object",
            additionalProperties: false,
            required: ["name", "phone", "amount_paid", "amount_due", "follow_up_date"],
            properties: {
              name: { type: ["number", "null"] },
              phone: { type: ["number", "null"] },
              amount_paid: { type: ["number", "null"] },
              amount_due: { type: ["number", "null"] },
              follow_up_date: { type: ["number", "null"] },
            },
          },
        },
      },
    },
    page_total_written: { type: ["number", "null"] },
    page_warnings: { type: "array", items: { type: "string" } },
  },
};

/* ----------------------------------------------------------------- ask (S6) */
// Stage 6 - "Ask my ledger": the OWNER asks about figures already in their
// ledger. The reply must use ONLY the brief supplied in the user message; the
// system prompt pins the no-invention and no-customer-message rules (rules 5+6).
export const ASK_SCHEMA_NAME = "LedgerAnswer";

export const ASK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "based_on"],
  properties: {
    answer: { type: "string", minLength: 1, maxLength: 700 },
    based_on: { type: "array", maxItems: 8, items: { type: "string", maxLength: 120 } },
  },
};

export function buildAskSystemPrompt() {
  return `You answer questions from a small-shop owner about THEIR OWN ledger figures. The figures arrive as JSON in the user message; they were computed from the owner's saved pages - you do not have access to anything else.

RULES (breaking any of these is a failure):
- Use ONLY the figures in the JSON. Never invent, estimate, or add numbers.
- If the data does not contain the answer, say plainly what is missing.
- Plain language a shop owner reads at a glance. Amounts as \u20b9 with Indian grouping (e.g. \u20b92,430). Names only as given. Under 80 words.
- You NEVER draft messages to customers and never suggest sending one. Advising to call a person by name is fine; wording a message is not.
- "based_on": 2-5 short pointers to the exact figures used, e.g. "totals.due", "topDue:Ravi 400", "todayCall:2".
- Reply ONLY with JSON matching the schema.`;
}
