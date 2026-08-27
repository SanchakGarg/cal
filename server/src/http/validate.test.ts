import assert from "node:assert/strict";
import { test } from "node:test";
import { optInt, optQueryInt } from "./validate.ts";

// Every query-string value arrives as text, so the body reader is the wrong
// tool for them — `/v2/bookings?limit=100` used to 400 because of it.
test("query integers are read from their text form", () => {
  assert.equal(optQueryInt({ limit: "100" }, "limit"), 100);
  assert.equal(optQueryInt({ limit: 100 }, "limit"), 100);
  assert.equal(optQueryInt({ cursor: "0" }, "cursor", { min: 0 }), 0);
});

test("an absent or empty query integer reads as not supplied", () => {
  assert.equal(optQueryInt({}, "limit"), undefined);
  assert.equal(optQueryInt({ limit: "" }, "limit"), undefined);
  assert.equal(optQueryInt({ limit: null }, "limit"), undefined);
});

test("query integers are still bounded and still have to be integers", () => {
  assert.throws(() => optQueryInt({ limit: "abc" }, "limit"), /limit must be an integer/);
  assert.throws(() => optQueryInt({ limit: "1.5" }, "limit"), /limit must be an integer/);
  assert.throws(() => optQueryInt({ limit: "0" }, "limit", { min: 1 }), /at least 1/);
  assert.throws(() => optQueryInt({ limit: "251" }, "limit", { max: 250 }), /at most 250/);
});

// The body reader keeps its stricter contract: JSON has real numbers.
test("the body integer reader still refuses a numeric string", () => {
  assert.throws(() => optInt({ limit: "100" }, "limit"), /limit is required and must be a number/);
});
