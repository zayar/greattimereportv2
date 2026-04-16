import { gql } from "@apollo/client";
import type { OfferCategoryDraft, OfferDraft } from "./offerUtils";
import { startOfCurrentMonth } from "../../utils/date";

export type OfferLoadScope = "month" | "all";

export const GET_OFFER_CATEGORIES = gql`
  query OfferCategories(
    $where: OfferCategoryWhereInput
    $orderBy: [OfferCategoryOrderByWithRelationInput!]
  ) {
    offerCategories(where: $where, orderBy: $orderBy) {
      id
      image
      name
      sort_order
      status
      description
      clinic_id
      created_at
    }
  }
`;

export const GET_OFFERS = gql`
  query Offers($where: OfferWhereInput, $orderBy: [OfferOrderByWithRelationInput!]) {
    offers(where: $where, orderBy: $orderBy) {
      id
      image
      name
      sort_order
      hight_light
      expired_date
      description
      clinic_id
      category_id
      category {
        id
        name
      }
      term_and_condition
      status
      images {
        id
        name
        image
      }
      metadata
      created_at
    }
  }
`;

export const CREATE_OFFER_CATEGORY = gql`
  mutation CreateOneOfferCategory($data: OfferCategoryCreateInput!) {
    createOneOfferCategory(data: $data) {
      id
    }
  }
`;

export const UPDATE_OFFER_CATEGORY = gql`
  mutation UpdateOneOfferCategory(
    $data: OfferCategoryUpdateInput!
    $where: OfferCategoryWhereUniqueInput!
  ) {
    updateOneOfferCategory(data: $data, where: $where) {
      id
    }
  }
`;

export const DELETE_OFFER_CATEGORY = gql`
  mutation DeleteOneOfferCategory($where: OfferCategoryWhereUniqueInput!) {
    deleteOneOfferCategory(where: $where) {
      id
    }
  }
`;

export const CREATE_OFFER = gql`
  mutation CreateOneOffer($data: OfferCreateInput!) {
    createOneOffer(data: $data) {
      id
    }
  }
`;

export const UPDATE_OFFER = gql`
  mutation UpdateOneOffer($data: OfferUpdateInput!, $where: OfferWhereUniqueInput!) {
    updateOneOffer(data: $data, where: $where) {
      id
    }
  }
`;

export const DELETE_OFFER = gql`
  mutation DeleteOneOffer($where: OfferWhereUniqueInput!) {
    deleteOneOffer(where: $where) {
      id
    }
  }
`;

export function buildOfferCategoriesVariables(clinicId: string) {
  return {
    where: {
      clinic_id: {
        equals: clinicId,
      },
    },
    orderBy: [{ sort_order: "asc" }, { created_at: "desc" }],
  };
}

export function buildOffersVariables(clinicId: string, scope: OfferLoadScope = "month") {
  const where: Record<string, unknown> = {
    clinic_id: {
      equals: clinicId,
    },
  };

  if (scope === "month") {
    where.created_at = {
      gte: new Date(`${startOfCurrentMonth()}T00:00:00.000Z`).toISOString(),
    };
  }

  return {
    where,
    orderBy: [{ created_at: "desc" }, { sort_order: "asc" }],
  };
}

export function buildCreateOfferCategoryVariables(clinicId: string, draft: OfferCategoryDraft) {
  return {
    data: {
      name: draft.name,
      image: draft.image || null,
      description: draft.description || null,
      sort_order: draft.sort_order,
      status: draft.status,
      clinic: {
        connect: {
          id: clinicId,
        },
      },
    },
  };
}

export function buildUpdateOfferCategoryVariables(categoryId: string, draft: OfferCategoryDraft) {
  return {
    where: {
      id: categoryId,
    },
    data: {
      name: { set: draft.name },
      image: { set: draft.image || null },
      description: { set: draft.description || null },
      sort_order: { set: draft.sort_order },
      status: { set: draft.status },
    },
  };
}

export function buildDeleteOfferCategoryVariables(categoryId: string) {
  return {
    where: {
      id: categoryId,
    },
  };
}

export function buildCreateOfferVariables(clinicId: string, draft: OfferDraft) {
  return {
    data: {
      name: draft.name,
      image: draft.image || null,
      hight_light: draft.hight_light || null,
      expired_date: draft.expired_date || null,
      description: draft.description || null,
      term_and_condition: draft.term_and_condition || null,
      sort_order: draft.sort_order,
      status: draft.status,
      clinic: {
        connect: {
          id: clinicId,
        },
      },
      ...(draft.category_id
        ? {
            category: {
              connect: {
                id: draft.category_id,
              },
            },
          }
        : {}),
    },
  };
}

export function buildUpdateOfferVariables(offerId: string, draft: OfferDraft) {
  return {
    where: {
      id: offerId,
    },
    data: {
      name: { set: draft.name },
      image: { set: draft.image || null },
      hight_light: { set: draft.hight_light || null },
      expired_date: { set: draft.expired_date || null },
      description: { set: draft.description || null },
      term_and_condition: { set: draft.term_and_condition || null },
      sort_order: { set: draft.sort_order },
      status: { set: draft.status },
      category: draft.category_id
        ? {
            connect: {
              id: draft.category_id,
            },
          }
        : {
            disconnect: true,
          },
    },
  };
}

export function buildDeleteOfferVariables(offerId: string) {
  return {
    where: {
      id: offerId,
    },
  };
}
