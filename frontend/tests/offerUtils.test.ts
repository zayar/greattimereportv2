import assert from "node:assert/strict"
import test from "node:test"
import {
  createOfferCategoryDraft,
  createOfferDraft,
  excerptText,
  getOfferCampaignDate,
  getOfferCampaignDateLabel,
  sortOffersByCampaign,
  summarizeStatuses,
} from "../src/features/offers/offerUtils"

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

test("sorts offers by newest campaign first", () => {
  const rows = sortOffersByCampaign([
    {
      id: "offer-older",
      name: "Older",
      image: null,
      sort_order: 1,
      hight_light: null,
      expired_date: null,
      description: null,
      clinic_id: "clinic-1",
      category_id: null,
      category: null,
      term_and_condition: null,
      status: "ACTIVE",
      images: [],
      metadata: null,
      created_at: "2026-04-01T00:00:00.000Z",
      updated_at: "2026-04-01T00:00:00.000Z",
    },
    {
      id: "offer-updated",
      name: "Updated",
      image: null,
      sort_order: 4,
      hight_light: null,
      expired_date: null,
      description: null,
      clinic_id: "clinic-1",
      category_id: null,
      category: null,
      term_and_condition: null,
      status: "ACTIVE",
      images: [],
      metadata: null,
      created_at: "2025-04-10T00:00:00.000Z",
      updated_at: "2026-04-05T00:00:00.000Z",
    },
    {
      id: "offer-campaign-sort-2",
      name: "Campaign Sort 2",
      image: null,
      sort_order: 2,
      hight_light: null,
      expired_date: "2026-04-10T00:00:00.000Z",
      description: null,
      clinic_id: "clinic-1",
      category_id: null,
      category: null,
      term_and_condition: null,
      status: "ACTIVE",
      images: [],
      metadata: null,
      created_at: "2025-04-15T00:00:00.000Z",
      updated_at: "2026-04-09T00:00:00.000Z",
    },
    {
      id: "offer-campaign-sort-1",
      name: "Campaign Sort 1",
      image: null,
      sort_order: 1,
      hight_light: null,
      expired_date: "2026-04-10T00:00:00.000Z",
      description: null,
      clinic_id: "clinic-1",
      category_id: null,
      category: null,
      term_and_condition: null,
      status: "ACTIVE",
      images: [],
      metadata: null,
      created_at: "2025-04-15T00:00:00.000Z",
      updated_at: "2026-04-09T00:00:00.000Z",
    },
  ])

  assert.deepEqual(
    rows.map((row) => row.id),
    ["offer-campaign-sort-1", "offer-campaign-sort-2", "offer-updated", "offer-older"],
  )
})

test("derives the visible campaign date from expiry, updated, then created timestamps", () => {
  const expiryDriven = {
    id: "offer-1",
    name: "Expiry",
    image: null,
    sort_order: 1,
    hight_light: null,
    expired_date: "2026-04-10T00:00:00.000Z",
    description: null,
    clinic_id: "clinic-1",
    category_id: null,
    category: null,
    term_and_condition: null,
    status: "ACTIVE",
    images: [],
    metadata: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2026-04-09T00:00:00.000Z",
  }

  const updatedDriven = {
    ...expiryDriven,
    id: "offer-2",
    expired_date: null,
  }

  const createdDriven = {
    ...updatedDriven,
    id: "offer-3",
    updated_at: null,
  }

  assert.equal(getOfferCampaignDate(expiryDriven), "2026-04-10T00:00:00.000Z")
  assert.equal(getOfferCampaignDateLabel(expiryDriven), "Campaign")
  assert.equal(getOfferCampaignDate(updatedDriven), "2026-04-09T00:00:00.000Z")
  assert.equal(getOfferCampaignDateLabel(updatedDriven), "Updated")
  assert.equal(getOfferCampaignDate(createdDriven), "2025-01-01T00:00:00.000Z")
  assert.equal(getOfferCampaignDateLabel(createdDriven), "Created")
})
