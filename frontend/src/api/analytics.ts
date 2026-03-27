import { apiClient } from "./http";
import type {
  BankingSummaryResponse,
  CustomerPortalBookingsResponse,
  CustomerPortalListResponse,
  CustomerPortalOverviewResponse,
  CustomerPortalPackagesResponse,
  CustomerPortalPaymentsResponse,
  CustomerPortalUsageResponse,
  CustomersBySalespersonResponse,
  CustomerBehaviorResponse,
  DashboardResponse,
  DailyTreatmentResponse,
  PaymentReportResponse,
  SalesReportResponse,
  SalesBySellerResponse,
  ServiceBehaviorResponse,
} from "../types/domain";

type BaseParams = {
  clinicId: string;
  clinicCode: string;
  fromDate: string;
  toDate: string;
};

export async function fetchDashboardOverview(params: BaseParams) {
  const response = await apiClient.get<{ success: true; data: DashboardResponse }>("/analytics/dashboard", {
    params,
  });
  return response.data.data;
}

export async function fetchCustomerBehavior(
  params: BaseParams & { granularity: "month" | "quarter" | "year" },
) {
  const response = await apiClient.get<{ success: true; data: CustomerBehaviorResponse }>(
    "/analytics/customer-behavior",
    { params },
  );
  return response.data.data;
}

export async function fetchCustomerPortalList(
  params: BaseParams & {
    search: string;
    status: string;
    spendTier: string;
    therapist: string;
    serviceCategory: string;
    sortBy: "lifetimeSpend" | "lastVisitDate" | "visitCount" | "averageSpend";
    sortDirection: "asc" | "desc";
    page: number;
    pageSize: number;
  },
) {
  const response = await apiClient.get<{ success: true; data: CustomerPortalListResponse }>(
    "/analytics/customers",
    { params },
  );
  return response.data.data;
}

export async function fetchCustomerPortalOverview(
  params: BaseParams & {
    customerName: string;
    customerPhone: string;
  },
) {
  const response = await apiClient.get<{ success: true; data: CustomerPortalOverviewResponse }>(
    "/analytics/customers/detail/overview",
    { params },
  );
  return response.data.data;
}

export async function fetchCustomerPortalPackages(
  params: BaseParams & {
    customerName: string;
    customerPhone: string;
  },
) {
  const response = await apiClient.get<{ success: true; data: CustomerPortalPackagesResponse }>(
    "/analytics/customers/detail/packages",
    { params },
  );
  return response.data.data;
}

export async function fetchCustomerPortalBookings(
  params: BaseParams & {
    customerName: string;
    customerPhone: string;
    search: string;
    page: number;
    pageSize: number;
  },
) {
  const response = await apiClient.get<{ success: true; data: CustomerPortalBookingsResponse }>(
    "/analytics/customers/detail/bookings",
    { params },
  );
  return response.data.data;
}

export async function fetchCustomerPortalPayments(
  params: BaseParams & {
    customerName: string;
    customerPhone: string;
    search: string;
    page: number;
    pageSize: number;
  },
) {
  const response = await apiClient.get<{ success: true; data: CustomerPortalPaymentsResponse }>(
    "/analytics/customers/detail/payments",
    { params },
  );
  return response.data.data;
}

export async function fetchCustomerPortalUsage(
  params: BaseParams & {
    customerName: string;
    customerPhone: string;
    year: number;
    serviceCategory: string;
  },
) {
  const response = await apiClient.get<{ success: true; data: CustomerPortalUsageResponse }>(
    "/analytics/customers/detail/usage",
    { params },
  );
  return response.data.data;
}

export async function fetchServiceBehavior(
  params: BaseParams & { granularity: "month" | "quarter" | "year" },
) {
  const response = await apiClient.get<{ success: true; data: ServiceBehaviorResponse }>(
    "/analytics/service-behavior",
    { params },
  );
  return response.data.data;
}

export async function fetchPaymentReport(
  params: BaseParams & {
    search: string;
    paymentMethod: string;
    includeZeroValues: boolean;
    page: number;
    pageSize: number;
  },
) {
  const response = await apiClient.get<{ success: true; data: PaymentReportResponse }>(
    "/analytics/payment-report",
    { params },
  );
  return response.data.data;
}

export async function fetchSalesReport(
  params: BaseParams & { search: string; page: number; pageSize: number },
) {
  const response = await apiClient.get<{ success: true; data: SalesReportResponse }>(
    "/analytics/sales-report",
    { params },
  );
  return response.data.data;
}

export async function fetchSalesBySeller(
  params: BaseParams & {
    sellerName: string;
    search: string;
    page: number;
    pageSize: number;
  },
) {
  const response = await apiClient.get<{ success: true; data: SalesBySellerResponse }>(
    "/analytics/sales-by-seller",
    { params },
  );
  return response.data.data;
}

export async function fetchBankingSummary(params: BaseParams) {
  const response = await apiClient.get<{ success: true; data: BankingSummaryResponse }>(
    "/analytics/banking-summary",
    { params },
  );
  return response.data.data;
}

export async function fetchBankingDetails(
  params: BaseParams & {
    search: string;
    paymentMethod: string;
    walletTopupFilter: "all" | "hide" | "only";
    page: number;
    pageSize: number;
  },
) {
  const response = await apiClient.get<{ success: true; data: BankingSummaryResponse }>(
    "/analytics/banking-summary",
    { params },
  );
  return response.data.data;
}

export async function fetchCustomersBySalesperson(
  params: BaseParams & {
    sellerName: string;
    search: string;
    page: number;
    pageSize: number;
  },
) {
  const response = await apiClient.get<{ success: true; data: CustomersBySalespersonResponse }>(
    "/analytics/customers-by-salesperson",
    { params },
  );
  return response.data.data;
}

export async function fetchDailyTreatment(params: {
  clinicId: string;
  clinicCode: string;
  date: string;
}) {
  const response = await apiClient.get<{ success: true; data: DailyTreatmentResponse }>(
    "/analytics/daily-treatment",
    { params },
  );
  return response.data.data;
}
