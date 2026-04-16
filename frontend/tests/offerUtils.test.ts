import assert from "node:assert/strict"
import test from "node:test"
import {
  createOfferCategoryDraft,
  createOfferDraft,
  excerptText,
  filterOffers,
  getOfferSortOrderOptions,
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

test("sorts offers by created date newest first and keeps sort order inside a batch", () => {
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
    },
    {
      id: "offer-mid-sort-2",
      name: "Mid Sort 2",
      image: null,
      sort_order: 2,
      hight_light: null,
      expired_date: "2027-01-01T00:00:00.000Z",
      description: null,
      clinic_id: "clinic-1",
      category_id: null,
      category: null,
      term_and_condition: null,
      status: "ACTIVE",
      images: [],
      metadata: null,
      created_at: "2026-04-10T00:00:00.000Z",
    },
    {
      id: "offer-latest-sort-2",
      name: "Latest Sort 2",
      image: null,
      sort_order: 2,
      hight_light: null,
      expired_date: "2025-04-10T00:00:00.000Z",
      description: null,
      clinic_id: "clinic-1",
      category_id: null,
      category: null,
      term_and_condition: null,
      status: "ACTIVE",
      images: [],
      metadata: null,
      created_at: "2026-04-15T00:00:00.000Z",
    },
    {
      id: "offer-latest-sort-1",
      name: "Latest Sort 1",
      image: null,
      sort_order: 1,
      hight_light: null,
      expired_date: "2025-01-01T00:00:00.000Z",
      description: null,
      clinic_id: "clinic-1",
      category_id: null,
      category: null,
      term_and_condition: null,
      status: "ACTIVE",
      images: [],
      metadata: null,
      created_at: "2026-04-15T00:00:00.000Z",
    },
  ])

  assert.deepEqual(
    rows.map((row) => row.id),
    ["offer-latest-sort-1", "offer-latest-sort-2", "offer-mid-sort-2", "offer-older"],
  )
})

test("can sort offers by created date oldest first when requested", () => {
  const rows = sortOffersByCampaign(
    [
      {
        id: "offer-newer",
        name: "Newer",
        image: null,
        sort_order: 2,
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
        created_at: "2026-04-15T00:00:00.000Z",
      },
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
      },
    ],
    "asc",
  )

  assert.deepEqual(rows.map((row) => row.id), ["offer-older", "offer-newer"])
})

test("filters offers by status, category, search text, and sort order", () => {
  const rows = filterOffers(
    [
      {
        id: "offer-1",
        name: "Thingyan Sale",
        image: null,
        sort_order: 3,
        hight_light: "Water festival special",
        expired_date: null,
        description: "April campaign",
        clinic_id: "clinic-1",
        category_id: "cat-1",
        category: { id: "cat-1", name: "Promo" },
        term_and_condition: null,
        status: "ACTIVE",
        images: [],
        metadata: null,
        created_at: "2026-04-12T00:00:00.000Z",
      },
      {
        id: "offer-2",
        name: "Last Chance",
        image: null,
        sort_order: 1,
        hight_light: "Final days",
        expired_date: null,
        description: "March campaign",
        clinic_id: "clinic-1",
        category_id: "cat-2",
        category: { id: "cat-2", name: "Archive" },
        term_and_condition: null,
        status: "INACTIVE",
        images: [],
        metadata: null,
        created_at: "2026-03-30T00:00:00.000Z",
      },
    ],
    {
      status: "ACTIVE",
      categoryId: "cat-1",
      search: "water",
      sortOrder: "3",
    },
  )

  assert.deepEqual(rows.map((row) => row.id), ["offer-1"])
})

test("builds unique sort order options in ascending order", () => {
  const options = getOfferSortOrderOptions([
    {
      id: "offer-1",
      name: "A",
      image: null,
      sort_order: 3,
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
    },
    {
      id: "offer-2",
      name: "B",
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
      created_at: "2026-04-02T00:00:00.000Z",
    },
    {
      id: "offer-3",
      name: "C",
      image: null,
      sort_order: 3,
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
      created_at: "2026-04-03T00:00:00.000Z",
    },
  ])

  assert.deepEqual(options, ["1", "3"])
})
