/** Run `work` over `items`, at most `limit` at a time; rejects with the first failure. */
export async function pool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/** Blob transfers in flight at once (spec 5b 6.2). */
export const TRANSFERS = 4;
