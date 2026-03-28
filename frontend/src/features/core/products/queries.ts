import { gql } from "@apollo/client";

export const GET_PRODUCTS = gql`
  query Products($where: ProductWhereInput, $orderBy: [ProductOrderByWithRelationInput!], $take: Int) {
    products(where: $where, orderBy: $orderBy, take: $take) {
      id
      name
      sort_order
      status
      description
      created_at
      clinic_id
      measurement {
        id
        name
        description
      }
      images {
        image
      }
      measurement_amount
      measurement_id
      brand_id
      brand {
        image
        name
        id
      }
    }
  }
`;

export const GET_PRODUCT_STOCK_ITEMS = gql`
  query ProductStockItems($where: ProductStockItemWhereInput, $orderBy: [ProductStockItemOrderByWithRelationInput!], $take: Int) {
    productStockItems(where: $where, orderBy: $orderBy, take: $take) {
      id
      name
      price
      sku
      sort_order
      status
      stock
      stock_control_unit
      supply_price
      tax
      service_stock
      clinic_id
      created_at
      original_price
      images {
        image
      }
      product_id
      product {
        name
        id
      }
    }
  }
`;

export function buildProductVariables(clinicId: string, searchText: string, status: string) {
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

export function buildProductStockItemVariables(clinicId: string, searchText: string, status: string) {
  const where: Record<string, unknown> = {
    clinic_id: { equals: clinicId },
    ...(status ? { status: { in: [status] } } : {}),
  };

  if (searchText.trim()) {
    where.OR = [
      { name: { contains: searchText.trim() } },
      {
        product: {
          is: {
            OR: [{ name: { contains: searchText.trim() } }],
          },
        },
      },
    ];
  }

  return {
    where,
    orderBy: [{ created_at: "desc" }],
    take: 100,
  };
}
