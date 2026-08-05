import test from "node:test";
import assert from "node:assert/strict";
import { findMissingActiveKeys } from "../src/reconcile.mjs";

test("marks exactly the booking missing from a complete snapshot", () => {
  const active = Array.from({ length: 8 }, (_, index) => ({ external_key: `booking-${index + 1}` }));
  const seen = new Set(active.slice(0, 7).map((row) => row.external_key));
  assert.deepEqual(findMissingActiveKeys(active, seen), ["booking-8"]);
});

test("keeps every active booking seen in a complete snapshot", () => {
  const active = [{ external_key: "booking-1" }, { external_key: "booking-2" }];
  assert.deepEqual(findMissingActiveKeys(active, new Set(["booking-1", "booking-2"])), []);
});
