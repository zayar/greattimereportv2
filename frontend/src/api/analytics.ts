import { apiClient } from "./http";
import type {
  BankingSummaryResponse,
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
  params: BaseParams & { search: string; page: number; pageSize: number },
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

export async function fetchSalesBySeller(params: BaseParams) {
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
