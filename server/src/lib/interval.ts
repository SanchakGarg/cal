// Interval algebra on epoch milliseconds. Intervals are half-open: [start, end).

export interface Interval {
  start: number;
  end: number;
}

export function normalize(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

export function subtract(from: Interval[], remove: Interval[]): Interval[] {
  const blocks = normalize(remove);
  let result = normalize(from);
  for (const block of blocks) {
    const next: Interval[] = [];
    for (const interval of result) {
      if (block.end <= interval.start || block.start >= interval.end) {
        next.push(interval);
        continue;
      }
      if (block.start > interval.start) next.push({ start: interval.start, end: block.start });
      if (block.end < interval.end) next.push({ start: block.end, end: interval.end });
    }
    result = next;
  }
  return result;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const left = normalize(a);
  const right = normalize(b);
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i].start, right[j].start);
    const end = Math.min(left[i].end, right[j].end);
    if (end > start) result.push({ start, end });
    if (left[i].end < right[j].end) i += 1;
    else j += 1;
  }
  return result;
}

export function intersectAll(groups: Interval[][]): Interval[] {
  if (groups.length === 0) return [];
  return groups.reduce((acc, group) => intersect(acc, group));
}

export function union(groups: Interval[][]): Interval[] {
  return normalize(groups.flat());
}

export function clamp(intervals: Interval[], window: Interval): Interval[] {
  return intersect(intervals, [window]);
}

export function contains(intervals: Interval[], candidate: Interval): boolean {
  return normalize(intervals).some(
    (interval) => interval.start <= candidate.start && interval.end >= candidate.end
  );
}

export function overlaps(intervals: Interval[], candidate: Interval): boolean {
  return intervals.some(
    (interval) => interval.start < candidate.end && interval.end > candidate.start
  );
}
