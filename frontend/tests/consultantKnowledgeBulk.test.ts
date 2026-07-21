import assert from "node:assert/strict";
import test from "node:test";

import {
  runBoundedTasks,
  selectUnpublishedConsultantServices,
} from "../src/features/ai/consultant-knowledge/bulkKnowledge";
import type { ConsultantServiceKnowledgeRow } from "../src/types/domain";

function serviceRow(serviceId: string, publishedVersion: number | null): ConsultantServiceKnowledgeRow {
  return {
    serviceId,
    serviceName: `Service ${serviceId}`,
    description: null,
    status: "ACTIVE",
    price: "100000",
    originalPrice: "100000",
    durationMinutes: 30,
    sortOrder: 1,
    updatedAt: null,
    knowledgeStatus: publishedVersion === null ? "missing" : "published",
    knowledgeVersion: publishedVersion,
    publishedVersion,
    hasUnpublishedChanges: false,
    knowledgeUpdatedAt: null,
  };
}

test("bulk Consultant rollout selects only services without a published version", () => {
  const rows = [serviceRow("missing", null), serviceRow("published-v1", 1), serviceRow("published-v3", 3)];

  assert.deepEqual(
    selectUnpublishedConsultantServices(rows).map((row) => row.serviceId),
    ["missing"],
  );
});

test("bounded task runner caps concurrency and continues after a service failure", async () => {
  const items = [1, 2, 3, 4, 5];
  let active = 0;
  let maximumActive = 0;
  const started: number[] = [];
  const settled: Array<{ item: number; failed: boolean }> = [];

  const results = await runBoundedTasks(items, 2, async (item) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (item === 2) {
      throw new Error("service failed");
    }
    return item * 10;
  }, {
    onStart: (item) => started.push(item),
    onSettled: (item, error) => settled.push({ item, failed: error !== null }),
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(started, items);
  assert.equal(settled.length, items.length);
  assert.equal(results[1].status, "rejected");
  assert.deepEqual(
    results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
    [10, 30, 40, 50],
  );
});

test("bounded task runner rejects invalid concurrency", async () => {
  await assert.rejects(() => runBoundedTasks([1], 0, async (item) => item), /positive integer/);
});
