import assert from "node:assert/strict"
import test from "node:test"
import { buildSalesOrderWhere } from "../src/features/operational/sales/salesFilters"

test("builds sales date boundaries using the local day range", () => {
  const where = buildSalesOrderWhere({
    clinicId: "clinic-1",
    fromDate: "2026-04-08",
    toDate: "2026-04-09",
    search: "",
    showZeroValue: true,
    showCoOrders: true,
  }) as {
    clinic_id: { equals: string }
    created_at: { gte: string; lte: string }
    AND?: unknown[]
  }

  assert.deepEqual(where.clinic_id, { equals: "clinic-1" })
  assert.equal(where.created_at.gte, new Date(2026, 3, 8, 0, 0, 0, 0).toISOString())
  assert.equal(where.created_at.lte, new Date(2026, 3, 9, 23, 59, 59, 999).toISOString())
  assert.equal(where.AND, undefined)
})

test("keeps the sales cleanup filters and search clauses intact", () => {
  const where = buildSalesOrderWhere({
    clinicId: "clinic-1",
    fromDate: "2026-04-08",
    toDate: "2026-04-09",
    search: "admin",
    showZeroValue: false,
    showCoOrders: false,
  }) as {
    AND?: Array<Record<string, unknown>>
  }

  assert.equal(where.AND?.length, 3)
  assert.deepEqual(where.AND?.[0], {
    net_total: {
      not: {
        equals: "0",
      },
    },
  })
  assert.deepEqual(where.AND?.[1], {
    order_id: {
      not: {
        startsWith: "CO-",
      },
    },
  })
})
