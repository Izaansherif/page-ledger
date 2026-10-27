// netlify/functions/_lib/validate.js
// Runtime validation of the extraction result (project rule 4 + 5).
// Structured output already constrains the model, but we never trust an AI
// response without our own check. Returns { ok: true } or { ok: false, errors }.

const NULLABLE_STRING_FIELDS = ["name", "phone", "note", "follow_up_text", "follow_up_date"];
const NULLABLE_NUMBER_FIELDS = ["amount_paid", "amount_due"];
const CONFIDENCE_FIELDS = ["name", "phone", "amount_paid", "amount_due", "follow_up_date"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateExtraction(value) {
  const errors = [];
  const fail = (p, msg) => errors.push(`${p}: ${msg}`);
  const isNull = (v) => v === null;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: ["response must be a JSON object"] };
  }

  if (!Array.isArray(value.columns_detected)) fail("columns_detected", "must be an array");

  if (!Array.isArray(value.rows)) {
    fail("rows", "must be an array");
  } else if (value.rows.length === 0) {
    fail("rows", "must contain at least one row (owner will delete rows they do not want)");
  } else {
    value.rows.forEach((row, i) => {
      const p = `rows[${i}]`;
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        fail(p, "must be an object");
        return;
      }
      if (!Number.isInteger(row.row_index) || row.row_index < 0) fail(`${p}.row_index`, "must be a non-negative integer");
      if (typeof row.raw_text !== "string") fail(`${p}.raw_text`, "must be a string (the human compares against it)");
      for (const f of NULLABLE_STRING_FIELDS) {
        if (!(isNull(row[f]) || typeof row[f] === "string")) fail(`${p}.${f}`, "must be a string or null");
      }
      if (!isNull(row.follow_up_date) && typeof row.follow_up_date === "string" && !DATE_RE.test(row.follow_up_date)) {
        fail(`${p}.follow_up_date`, `must be YYYY-MM-DD or null (got "${row.follow_up_date}")`);
      }
      if (isNull(row.amount_paid) || typeof row.amount_paid === "number") {
        if (typeof row.amount_paid === "number" && row.amount_paid < 0) fail(`${p}.amount_paid`, "must be >= 0");
      } else fail(`${p}.amount_paid`, "must be a number or null");
      if (isNull(row.amount_due) || typeof row.amount_due === "number") {
        if (typeof row.amount_due === "number" && row.amount_due < 0) fail(`${p}.amount_due`, "must be >= 0");
      } else fail(`${p}.amount_due`, "must be a number or null");
      if (typeof row.struck_out !== "boolean") fail(`${p}.struck_out`, "must be a boolean");
      if (!Array.isArray(row.flags) || row.flags.some((f) => typeof f !== "string")) {
        fail(`${p}.flags`, "must be an array of strings");
      }
      const conf = row.confidence;
      if (typeof conf !== "object" || conf === null || Array.isArray(conf)) {
        fail(`${p}.confidence`, "must be an object");
      } else {
        for (const f of CONFIDENCE_FIELDS) {
          const c = conf[f];
          if (isNull(c) || typeof c === "number") {
            if (typeof c === "number" && (c < 0 || c > 1)) fail(`${p}.confidence.${f}`, "must be between 0 and 1");
          } else fail(`${p}.confidence.${f}`, "must be a number or null");
        }
      }
      // optional bbox [x, y, w, h] in 0-1000 page coordinates (UI tap-to-locate).
      // Absent or null is fine (fall back gracefully); present must be sane.
      const bbox = row.bbox;
      if (bbox !== undefined && bbox !== null) {
        if (
          !Array.isArray(bbox) ||
          bbox.length !== 4 ||
          bbox.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1000)
        ) {
          fail(`${p}.bbox`, "must be null or four numbers in 0-1000 [x, y, w, h]");
        }
      }
    });
  }

  if (!(isNull(value.page_total_written) || typeof value.page_total_written === "number")) {
    fail("page_total_written", "must be a number or null");
  }
  if (!Array.isArray(value.page_warnings) || value.page_warnings.some((w) => typeof w !== "string")) {
    fail("page_warnings", "must be an array of strings");
  }

  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}
