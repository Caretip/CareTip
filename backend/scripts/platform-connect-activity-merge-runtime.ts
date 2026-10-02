/**
 * Regression: k-way merge pagination for platform Connect activity.
 */
import assert from "node:assert/strict";
import {
  compareActivitySortRows,
  paginateMergedActivityRows,
  type ActivitySortRow,
  type ActivityStreamKey,
} from "../src/services/platformConnectActivityMerge.js";

function row(
  stream: ActivityStreamKey,
  id: string,
  iso: string,
): ActivitySortRow {
  return { stream, rowId: id, sortAt: new Date(iso), tieId: `${stream}:${id}` };
}

async function testSkewedStreams() {
  const business = Array.from({ length: 20 }, (_, i) =>
    row("business", `b${i}`, `2026-01-${String(20 - i).padStart(2, "0")}T12:00:00Z`),
  );
  const employee = [row("employee", "e1", "2026-01-15T12:00:00Z")];
  const transfer = Array.from({ length: 20 }, (_, i) =>
    row("transfer", `t${i}`, `2026-01-${String(10 - Math.min(i, 9)).padStart(2, "0")}T08:00:00Z`),
  );

  const data: Record<ActivityStreamKey, ActivitySortRow[]> = {
    business,
    employee,
    transfer,
  };

  const fetchChunk = async (stream: ActivityStreamKey, offset: number, limit: number) =>
    data[stream].slice(offset, offset + limit);
  const countStream = async (stream: ActivityStreamKey) => data[stream].length;

  const totalExpected = business.length + employee.length + transfer.length;
  const page0 = await paginateMergedActivityRows({
    streams: ["business", "employee", "transfer"],
    skip: 0,
    take: 5,
    fetchChunk,
    countStream,
    chunkSize: 3,
  });
  assert.equal(page0.total, totalExpected);
  assert.equal(page0.page.length, 5);

  const pageDeep = await paginateMergedActivityRows({
    streams: ["business", "employee", "transfer"],
    skip: 18,
    take: 5,
    fetchChunk,
    countStream,
    chunkSize: 4,
  });
  assert.equal(pageDeep.total, totalExpected);
  assert.equal(pageDeep.page.length, 5);

  const all: ActivitySortRow[] = [];
  for (let skip = 0; skip < totalExpected; skip += 7) {
    const chunk = await paginateMergedActivityRows({
      streams: ["business", "employee", "transfer"],
      skip,
      take: 7,
      fetchChunk,
      countStream,
      chunkSize: 2,
    });
    all.push(...chunk.page);
  }
  const ids = all.map((r) => `${r.stream}:${r.rowId}`);
  assert.equal(new Set(ids).size, totalExpected, "no duplicates across pages");
}

async function testSingleStream() {
  const only = [row("employee", "e1", "2026-02-01T00:00:00Z")];
  const res = await paginateMergedActivityRows({
    streams: ["employee"],
    skip: 0,
    take: 10,
    fetchChunk: async () => only,
    countStream: async () => 1,
  });
  assert.equal(res.total, 1);
  assert.equal(res.page.length, 1);
}

function testCompareTieBreak() {
  const a = row("business", "a", "2026-01-01T12:00:00Z");
  const b = row("transfer", "b", "2026-01-01T12:00:00Z");
  assert.ok(compareActivitySortRows(a, b) !== 0 || a.tieId !== b.tieId);
}

async function main() {
  testCompareTieBreak();
  await testSingleStream();
  await testSkewedStreams();
  console.log("platform-connect-activity-merge-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
