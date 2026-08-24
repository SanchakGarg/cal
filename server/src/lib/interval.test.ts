import assert from "node:assert/strict";
import { test } from "node:test";
import { contains, intersect, intersectAll, normalize, subtract, union } from "./interval.ts";

test("normalize merges touching and overlapping intervals", () => {
  assert.deepEqual(
    normalize([
      { start: 10, end: 20 },
      { start: 20, end: 30 },
      { start: 5, end: 8 },
      { start: 25, end: 40 },
      { start: 50, end: 50 },
    ]),
    [
      { start: 5, end: 8 },
      { start: 10, end: 40 },
    ]
  );
});

test("subtract splits, trims and drops intervals", () => {
  assert.deepEqual(
    subtract([{ start: 0, end: 100 }], [{ start: 30, end: 40 }]),
    [
      { start: 0, end: 30 },
      { start: 40, end: 100 },
    ]
  );
  assert.deepEqual(subtract([{ start: 0, end: 100 }], [{ start: 0, end: 100 }]), []);
  assert.deepEqual(subtract([{ start: 0, end: 100 }], [{ start: 90, end: 200 }]), [
    { start: 0, end: 90 },
  ]);
});

test("intersect keeps only shared time", () => {
  assert.deepEqual(
    intersect(
      [
        { start: 0, end: 50 },
        { start: 60, end: 100 },
      ],
      [{ start: 40, end: 70 }]
    ),
    [
      { start: 40, end: 50 },
      { start: 60, end: 70 },
    ]
  );
  assert.deepEqual(intersectAll([[{ start: 0, end: 100 }], [{ start: 10, end: 90 }], [{ start: 50, end: 200 }]]), [
    { start: 50, end: 90 },
  ]);
});

test("union flattens groups", () => {
  assert.deepEqual(union([[{ start: 0, end: 10 }], [{ start: 5, end: 20 }]]), [{ start: 0, end: 20 }]);
});

test("contains requires full coverage by one interval", () => {
  assert.equal(contains([{ start: 0, end: 30 }], { start: 10, end: 20 }), true);
  assert.equal(
    contains(
      [
        { start: 0, end: 15 },
        { start: 15, end: 30 },
      ],
      { start: 10, end: 20 }
    ),
    true
  );
  assert.equal(contains([{ start: 0, end: 15 }], { start: 10, end: 20 }), false);
});
