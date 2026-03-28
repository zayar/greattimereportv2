import { gql } from "@apollo/client";

export const GET_TOTAL_PRODUCT_STOCK_ITEMS_COUNT = gql`
  query ProductStockItemCount($where: ProductStockItemWhereInput) {
    aggregateProductStockItem(where: $where) {
      _count {
        id
      }
    }
  }
`;

export const GET_TOTAL_STOCK_HISTORY_COUNT = gql`
  query StockHistoryCount($where: StockHistoryWhereInput) {
    aggregateStockHistory(where: $where) {
      _count {
        id
      }
    }
  }
`;

export const GET_STOCK_HISTORIES = gql`
  query StockHistories(
    $where: StockHistoryWhereInput
    $orderBy: [StockHistoryOrderByWithRelationInput!]
    $take: Float
    $skip: Float
  ) {
    stockHistories(where: $where, orderBy: $orderBy, take: $take, skip: $skip) {
      id
      qty
      closing_qty
      stock_date
      transaction_type
      description
      ref_id
      ref_type
      ref_detail_id
      stock_id
      created_at
      stock {
        id
        name
        product {
          id
          name
        }
      }
    }
  }
`;

export const GENERATE_INVENTORY_REPORT = gql`
  query GenerateInventoryReport($where: ProductStockItemWhereInput!, $take: Int!, $skip: Int!, $toDate: DateTime!) {
    generateInventoryReport(where: $where, take: $take, skip: $skip, toDate: $toDate) {
      id
      name
      current_qty
      received_qty
      sale_qty
      adjustment_in_qty
      adjustment_out_qty
    }
  }
`;

export const GENERATE_STOCK_SUMMARY = gql`
  query GenerateStockSummaryReport(
    $where: ProductStockItemWhereInput!
    $take: Int!
    $skip: Int!
    $fromDate: DateTime!
    $toDate: DateTime!
  ) {
    generateStockSummaryReport(where: $where, take: $take, skip: $skip, fromDate: $fromDate, toDate: $toDate) {
      id
      name
      opening_qty
      in_qty
      out_qty
      closing_qty
    }
  }
`;

export function buildStockHistoryVariables(params: {
  clinicId: string;
  fromDate: string;
  toDate: string;
  take: number;
  skip: number;
  searchText: string;
  refType: string;
}) {
  const where: Record<string, unknown> = {
    clinic_id: { equals: params.clinicId },
    stock_date: {
      gte: params.fromDate,
      lte: params.toDate,
    },
  };

  if (params.refType) {
    where.ref_type = { in: [params.refType] };
  }

  if (params.searchText.trim()) {
    where.OR = [
      {
        stock: {
          is: {
            name: {
              contains: params.searchText.trim(),
            },
          },
        },
      },
    ];
  }

  return {
    where,
    orderBy: [{ stock_date: "desc" }, { cumulative_seq: "desc" }],
    take: params.take,
    skip: params.skip,
  };
}

export function buildInventoryReportVariables(params: {
  clinicId: string;
  take: number;
  skip: number;
  searchText: string;
  toDate: Date;
}) {
  const where: Record<string, unknown> = {
    clinic_id: { equals: params.clinicId },
  };

  if (params.searchText.trim()) {
    where.OR = [{ name: { contains: params.searchText.trim() } }];
  }

  return {
    where,
    take: params.take,
    skip: params.skip,
    toDate: params.toDate,
  };
}

export function buildStockSummaryVariables(params: {
  clinicId: string;
  take: number;
  skip: number;
  searchText: string;
  fromDate: Date;
  toDate: Date;
}) {
  const where: Record<string, unknown> = {
    clinic_id: { equals: params.clinicId },
  };

  if (params.searchText.trim()) {
    where.OR = [{ name: { contains: params.searchText.trim() } }];
  }

  return {
    where,
    take: params.take,
    skip: params.skip,
    fromDate: params.fromDate,
    toDate: params.toDate,
  };
}
