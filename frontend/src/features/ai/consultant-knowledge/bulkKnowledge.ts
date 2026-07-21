import type { ConsultantServiceKnowledgeRow } from "../../../types/domain";

export interface BoundedTaskHooks<T> {
  onStart?: (item: T) => void;
  onSettled?: (item: T, error: unknown | null) => void;
}

export type BoundedTaskResult<T, R> =
  | { item: T; status: "fulfilled"; value: R }
  | { item: T; status: "rejected"; error: unknown };

export function selectUnpublishedConsultantServices(rows: ConsultantServiceKnowledgeRow[]) {
  return rows.filter((row) => row.publishedVersion === null);
}

export async function runBoundedTasks<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
  hooks: BoundedTaskHooks<T> = {},
): Promise<Array<BoundedTaskResult<T, R>>> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer.");
  }

  const results: Array<BoundedTaskResult<T, R>> = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      hooks.onStart?.(item);

      try {
        const value = await task(item);
        results[index] = { item, status: "fulfilled", value };
        hooks.onSettled?.(item, null);
      } catch (error) {
        results[index] = { item, status: "rejected", error };
        hooks.onSettled?.(item, error);
      }
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
