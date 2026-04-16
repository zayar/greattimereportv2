import assert from "node:assert/strict"
import test from "node:test"
import { createOfferCategoryDraft, createOfferDraft, excerptText, summarizeStatuses } from "../src/features/offers/offerUtils"

test("creates a clean offer category draft from source data", () => {
  const draft = createOfferCategoryDraft({
    id: "cat-1",
    name: "Nail",
    image: "https://example.com/cat.jpg",
    sort_order: 3,
    status: "ACTIVE",
    description: "Hand and nail offers",
    clinic_id: "clinic-1",
    created_at: "2026-04-16T00:00:00.000Z",
  })

  assert.equal(draft.name, "Nail")
  assert.equal(draft.sort_order, 3)
  assert.equal(draft.status, "ACTIVE")
})

test("maps offer rows into editor drafts", () => {
  const draft = createOfferDraft({
    id: "offer-1",
    name: "Valentine's Special",
    image: "https://example.com/offer.jpg",
    sort_order: 1,
    hight_light: "Save on nail art",
    expired_date: "2026-04-30T00:00:00.000Z",
    description: "A seasonal promo",
    clinic_id: "clinic-1",
    category_id: "cat-1",
    category: { id: "cat-1", name: "Nail" },
    term_and_condition: "Weekdays only",
    status: "INACTIVE",
    images: [],
    metadata: null,
    created_at: "2026-04-16T00:00:00.000Z",
  })

  assert.equal(draft.category_id, "cat-1")
  assert.equal(draft.status, "INACTIVE")
  assert.equal(draft.expired_date, "2026-04-30")
})

test("builds readable excerpts and status summaries", () => {
  assert.equal(excerptText(""), "—")
  assert.match(excerptText("a".repeat(140), 12), /^a{12}…$/)

  const summary = summarizeStatuses([{ status: "ACTIVE" }, { status: "INACTIVE" }, {}])
  assert.deepEqual(summary, { active: 1, inactive: 2 })
})
