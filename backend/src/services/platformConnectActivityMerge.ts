/**
 * K-way merge pagination for platform Connect activity (business payouts, employee payouts, transfers).
 * Guarantees global sort order and honest totals when streams are included.
 */

export type ActivityStreamKey = "business" | "employee" | "transfer";

export type ActivitySortRow = {
  stream: ActivityStreamKey;
  rowId: string;
  sortAt: Date;
  tieId: string;
};

export function compareActivitySortRows(a: ActivitySortRow, b: ActivitySortRow): number {
  const dt = b.sortAt.getTime() - a.sortAt.getTime();
  if (dt !== 0) return dt;
  return b.tieId.localeCompare(a.tieId);
}

const DEFAULT_CHUNK = 64;

export async function paginateMergedActivityRows(args: {
  streams: ActivityStreamKey[];
  skip: number;
  take: number;
  fetchChunk: (stream: ActivityStreamKey, offset: number, limit: number) => Promise<ActivitySortRow[]>;
  countStream: (stream: ActivityStreamKey) => Promise<number>;
  chunkSize?: number;
}): Promise<{ total: number; page: ActivitySortRow[] }> {
  const skip = Math.max(args.skip, 0);
  const take = Math.max(args.take, 0);
  const CHUNK = Math.max(args.chunkSize ?? DEFAULT_CHUNK, take * 2, 8);

  const activeStreams = args.streams;
  const streamTotals = await Promise.all(activeStreams.map((s) => args.countStream(s)));
  const total = streamTotals.reduce((sum, n) => sum + n, 0);

  const buffers = new Map<ActivityStreamKey, ActivitySortRow[]>();
  const consumed = new Map<ActivityStreamKey, number>();
  const exhausted = new Map<ActivityStreamKey, boolean>();
  for (const s of activeStreams) {
    buffers.set(s, []);
    consumed.set(s, 0);
    exhausted.set(s, false);
  }

  async function ensureBuffer(stream: ActivityStreamKey): Promise<void> {
    if (exhausted.get(stream)) return;
    const buf = buffers.get(stream) ?? [];
    if (buf.length > 0) return;
    const offset = consumed.get(stream) ?? 0;
    const chunk = await args.fetchChunk(stream, offset, CHUNK);
    buffers.set(stream, chunk);
    if (chunk.length < CHUNK) exhausted.set(stream, true);
  }

  async function popBest(): Promise<ActivitySortRow | null> {
    await Promise.all(activeStreams.map((s) => ensureBuffer(s)));

    let best: ActivitySortRow | null = null;
    let bestStream: ActivityStreamKey | null = null;
    for (const stream of activeStreams) {
      const head = buffers.get(stream)?.[0];
      if (!head) continue;
      if (!best || compareActivitySortRows(head, best) < 0) {
        best = head;
        bestStream = stream;
      }
    }
    if (!best || !bestStream) return null;

    const buf = buffers.get(bestStream) ?? [];
    buf.shift();
    buffers.set(bestStream, buf);
    consumed.set(bestStream, (consumed.get(bestStream) ?? 0) + 1);
    await ensureBuffer(bestStream);
    return best;
  }

  const page: ActivitySortRow[] = [];
  const target = skip + take;
  for (let i = 0; i < target; i += 1) {
    const row = await popBest();
    if (!row) break;
    if (i >= skip) page.push(row);
  }

  return { total, page };
}
