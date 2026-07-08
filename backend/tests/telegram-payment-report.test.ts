import assert from "node:assert/strict";
import test from "node:test";
import type { ApicoreOrderWithPaymentsRow } from "../src/services/apicore.service.ts";

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql";
process.env.GT_GROWTH_AI_FEATURE_STORE_ENABLED ??= "false";

const { fetchApicoreOrdersWithPayments } = await import("../src/services/apicore.service.ts");
const { __test: paymentReportTest } = await import("../src/services/telegram/payment-report.service.ts");
const { buildUtcDayRangeForDateKeyInTimeZone } = await import("../src/services/telegram/time.ts");

const dayRange = buildUtcDayRangeForDateKeyInTimeZone("2026-07-02", "Asia/Yangon");

function buildOrder(overrides: Partial<ApicoreOrderWithPaymentsRow> = {}): ApicoreOrderWithPaymentsRow {
  return {
    id: "order-1",
    order_id: "SO-100001",
    created_at: "2026-07-02T07:30:00.000Z",
    status: "ACTIVE",
    net_total: 100_000,
    total: 100_000,
    balance: 0,
    credit_balance: 0,
    payment_method: "CASH",
    payment_status: "PAID",
    member: {
      name: "Default Customer",
      clinic_members: [{ name: "Default Customer", clinic_id: "clinic-1" }],
    },
    user: { name: "admin@gtnskin" },
    seller: { display_name: "admin@gtnskin" },
    payments: [
      {
        payment_amount: 100_000,
        payment_method: "CASH",
        payment_note: null,
        payment_date: "2026-07-02T07:30:00.000Z",
      },
    ],
    ...overrides,
  };
}

function buildSnapshot(orders: ApicoreOrderWithPaymentsRow[]) {
  return paymentReportTest.buildPaymentSnapshot({
    rows: orders,
    timezone: "Asia/Yangon",
    startIso: dayRange.startIso,
    endIso: dayRange.endIso,
  });
}

test("Telegram payment report includes both SO and CO paid payments for the same day", () => {
  const snapshot = buildSnapshot([
    buildOrder({
      id: "so-order",
      order_id: "SO-045721",
      net_total: 2_640_500,
      total: 2_640_500,
      member: {
        name: "May July Aung",
        clinic_members: [{ name: "May July Aung", clinic_id: "clinic-nskin" }],
      },
      payments: [
        {
          payment_amount: 2_640_500,
          payment_method: "KBZ",
          payment_note: "SO payment",
          payment_date: "2026-07-02T07:33:00.000Z",
        },
      ],
    }),
    buildOrder({
      id: "co-order",
      order_id: "CO-869696",
      net_total: 120_000,
      total: 120_000,
      member: {
        name: "Zin Mar Htun",
        clinic_members: [{ name: "Zin Mar Htun", clinic_id: "clinic-nskin" }],
      },
      payments: [
        {
          payment_amount: 120_000,
          payment_method: "CASH",
          payment_note: "Better Barrier Facial",
          payment_date: "2026-07-02T04:00:00.000Z",
        },
      ],
    }),
  ]);

  assert.equal(snapshot.totalPaymentAmount, 2_760_500);
  assert.equal(snapshot.paymentCount, 2);
  assert.equal(snapshot.paidInvoiceCount, 2);
  assert.deepEqual(
    snapshot.paymentMethods.map((method) => [method.paymentMethod, method.amount, method.count]),
    [
      ["KBZ", 2_640_500, 1],
      ["CASH", 120_000, 1],
    ],
  );
  assert.deepEqual(
    snapshot.payments.map((payment) => payment.invoiceNumber).sort(),
    ["CO-869696", "SO-045721"],
  );
});

test("Telegram payment report does not double count duplicate order/item rows for the same payment", () => {
  const duplicatePayment = {
    payment_amount: 120_000,
    payment_method: "CASH",
    payment_note: "Better Barrier Facial",
    payment_date: "2026-07-02T04:00:00.000Z",
  };
  const firstRow = buildOrder({
    id: "co-row-1",
    order_id: "CO-869696",
    net_total: 120_000,
    total: 120_000,
    payments: [duplicatePayment],
  });
  const secondRow = buildOrder({
    ...firstRow,
    id: "co-row-2",
    payments: [{ ...duplicatePayment }],
  });

  const snapshot = buildSnapshot([firstRow, secondRow]);

  assert.equal(snapshot.totalPaymentAmount, 120_000);
  assert.equal(snapshot.paymentCount, 1);
  assert.equal(snapshot.paidInvoiceCount, 1);
  assert.deepEqual(snapshot.paymentMethods, [{ paymentMethod: "CASH", count: 1, amount: 120_000 }]);
});

test("Telegram payment report counts multiple real payment rows on one invoice", () => {
  const snapshot = buildSnapshot([
    buildOrder({
      id: "partial-order",
      order_id: "SO-200001",
      net_total: 300_000,
      total: 300_000,
      payment_status: "PARTIAL_PAID",
      payments: [
        {
          payment_amount: 100_000,
          payment_method: "CASH",
          payment_note: "deposit",
          payment_date: "2026-07-02T03:00:00.000Z",
        },
        {
          payment_amount: 200_000,
          payment_method: "KBZ",
          payment_note: "balance",
          payment_date: "2026-07-02T08:00:00.000Z",
        },
      ],
    }),
  ]);

  assert.equal(snapshot.totalPaymentAmount, 300_000);
  assert.equal(snapshot.paymentCount, 2);
  assert.equal(snapshot.paidInvoiceCount, 1);
  assert.deepEqual(
    snapshot.paymentMethods.map((method) => [method.paymentMethod, method.amount, method.count]),
    [
      ["KBZ", 200_000, 1],
      ["CASH", 100_000, 1],
    ],
  );
});

test("Telegram payment report ignores zero amount and PASS payment rows without using fallback", () => {
  const snapshot = buildSnapshot([
    buildOrder({
      id: "zero-order",
      order_id: "SO-300001",
      net_total: 500_000,
      total: 500_000,
      payment_method: "CASH",
      payment_status: "PAID",
      payments: [
        {
          payment_amount: 0,
          payment_method: "CASH",
          payment_note: "zero row",
          payment_date: "2026-07-02T03:00:00.000Z",
        },
        {
          payment_amount: 500_000,
          payment_method: "PASS",
          payment_note: "package pass",
          payment_date: "2026-07-02T04:00:00.000Z",
        },
      ],
    }),
  ]);

  assert.equal(snapshot.totalPaymentAmount, 0);
  assert.equal(snapshot.paymentCount, 0);
  assert.equal(snapshot.paidInvoiceCount, 0);
});

test("Apicore Telegram payment query does not exclude CO order ids", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, any> | null = null;

  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body ?? "{}"));

    return new Response(
      JSON.stringify({
        data: {
          orders: [],
          aggregateOrder: {
            _count: {
              id: 0,
            },
          },
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    await fetchApicoreOrdersWithPayments({
      clinicId: "clinic-nskin",
      startDate: dayRange.startIso,
      endDate: dayRange.endIso,
      authorizationHeader: "Bearer test-token",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestBody?.variables?.where?.order_id, undefined);
  assert.deepEqual(requestBody?.variables?.where?.clinic_id, { equals: "clinic-nskin" });
  assert.deepEqual(requestBody?.variables?.where?.status, { equals: "ACTIVE" });
  assert.deepEqual(requestBody?.variables?.where?.payments, {
    some: {
      payment_date: {
        gte: dayRange.startIso,
        lte: dayRange.endIso,
      },
    },
  });
});
