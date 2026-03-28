import { createSearchParams } from "react-router-dom";

type SalesDetailIdentity = {
  saleId: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
  page?: number | string;
  showZeroValue?: boolean;
  showCoOrders?: boolean;
};

type SalesListIdentity = Omit<SalesDetailIdentity, "saleId">;

function buildQueryString(params: SalesListIdentity) {
  const values = Object.fromEntries(
    Object.entries({
      fromDate: params.fromDate ?? "",
      toDate: params.toDate ?? "",
      search: params.search ?? "",
      page: params.page ? String(params.page) : "",
      showZeroValue: params.showZeroValue ? "1" : "",
      showCoOrders: params.showCoOrders ? "1" : "",
    }).filter(([, value]) => value !== ""),
  );

  const query = createSearchParams(values).toString();
  return query ? `?${query}` : "";
}

export function buildSalesDetailPath(params: SalesDetailIdentity) {
  return `/operational/sales/${params.saleId}${buildQueryString(params)}`;
}

export function buildSalesListPath(params: SalesListIdentity) {
  return `/operational/sales${buildQueryString(params)}`;
}
