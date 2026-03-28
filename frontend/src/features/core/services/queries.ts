import { gql } from "@apollo/client";

export const GET_SERVICES = gql`
  query Services($where: ServiceWhereInput, $orderBy: [ServiceOrderByWithRelationInput!], $take: Int) {
    services(where: $where, orderBy: $orderBy, take: $take) {
      id
      image
      clinic_id
      name
      original_price
      price
      description
      status
      created_at
      sort_order
      tax
      duration
      interval_day
      max_duration_count
    }
  }
`;

export const GET_SERVICE_PACKAGES = gql`
  query ServicePackages($where: ServicePackageWhereInput, $orderBy: [ServicePackageOrderByWithRelationInput!], $take: Int) {
    servicePackages(where: $where, orderBy: $orderBy, take: $take) {
      id
      image
      name
      price
      original_price
      status
      sort_order
      tax
      description
      clinic_id
      expiry_day
      created_at
      isLock
    }
  }
`;

export const GET_SERVICE_TYPE_CATEGORIES = gql`
  query ServiceTypeCategories($where: ServiceTypeCategoryWhereInput, $orderBy: [ServiceTypeCategoryOrderByWithRelationInput!]) {
    serviceTypeCategories(where: $where, orderBy: $orderBy) {
      id
      is_private
      name
      image
      status
      created_at
      description
      order
      sale_channel
    }
  }
`;

export const GET_SERVICE_FORM_TYPES = gql`
  query ServiceFormTypes($where: ServiceFormTypeWhereInput, $orderBy: [ServiceFormTypeOrderByWithRelationInput!]) {
    serviceFormTypes(where: $where, orderBy: $orderBy) {
      id
      name
      legal_desc
      form_type
      description
      status
      consent_image
      consent_sign_align
      terms {
        id
        term
        status
        type
      }
    }
  }
`;

export function buildServiceVariables(clinicId: string, searchText: string, status: string) {
  const where: Record<string, unknown> = {
    clinic_id: { equals: clinicId },
    status: {
      notIn: ["CANCEL"],
      ...(status ? { in: [status] } : {}),
    },
  };

  if (searchText.trim()) {
    where.OR = [{ name: { contains: searchText.trim() } }];
  }

  return {
    where,
    orderBy: [{ created_at: "desc" }],
    take: 150,
  };
}

export function buildServicePackageVariables(clinicId: string, searchText: string, status: string) {
  const where: Record<string, unknown> = {
    clinic_id: { equals: clinicId },
    ...(status ? { status: { in: [status] } } : {}),
  };

  if (searchText.trim()) {
    where.OR = [{ name: { contains: searchText.trim() } }];
  }

  return {
    where,
    orderBy: [{ created_at: "desc" }],
    take: 150,
  };
}

export function buildServiceTypeCategoryVariables(clinicId: string) {
  return {
    where: { clinic_id: { equals: clinicId } },
    orderBy: [{ updated_at: "desc" }],
  };
}

export function buildServiceFormVariables(
  clinicId: string,
  formTypes: Array<"CONSENT" | "RECORD">,
  statuses: Array<"ACTIVE" | "INACTIVE"> = ["ACTIVE", "INACTIVE"],
) {
  return {
    where: {
      clinic_id: { equals: clinicId },
      form_type: { in: formTypes },
      status: { in: statuses },
    },
    orderBy: [{ updated_at: "desc" }],
  };
}
