import type { OfferCategoryRow, OfferRow } from "../../types/domain";

export type OfferCategoryDraft = {
  name: string;
  image: string;
  description: string;
  sort_order: number;
  status: "ACTIVE" | "INACTIVE";
};

export type OfferDraft = {
  name: string;
  image: string;
  category_id: string;
  status: "ACTIVE" | "INACTIVE";
  sort_order: number;
  expired_date: string;
  hight_light: string;
  description: string;
  term_and_condition: string;
};

export function createOfferCategoryDraft(category?: OfferCategoryRow | null): OfferCategoryDraft {
  return {
    name: category?.name ?? "",
    image: category?.image ?? "",
    description: category?.description ?? "",
    sort_order: Number(category?.sort_order ?? 1),
    status: category?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
  };
}

export function createOfferDraft(offer?: OfferRow | null): OfferDraft {
  return {
    name: offer?.name ?? "",
    image: offer?.image ?? "",
    category_id: offer?.category?.id ?? offer?.category_id ?? "",
    status: offer?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    sort_order: Number(offer?.sort_order ?? 1),
    expired_date: offer?.expired_date ? String(offer.expired_date).slice(0, 10) : "",
    hight_light: offer?.hight_light ?? "",
    description: offer?.description ?? "",
    term_and_condition: offer?.term_and_condition ?? "",
  };
}

export function excerptText(value: string | null | undefined, limit = 120) {
  const trimmed = (value ?? "").trim();

  if (!trimmed) {
    return "—";
  }

  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

export function summarizeStatuses<T extends { status?: string | null }>(rows: T[]) {
  return rows.reduce(
    (summary, row) => {
      if ((row.status ?? "").toUpperCase() === "ACTIVE") {
        summary.active += 1;
      } else {
        summary.inactive += 1;
      }

      return summary;
    },
    { active: 0, inactive: 0 },
  );
}
