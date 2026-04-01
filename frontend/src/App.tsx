import { ApolloProvider } from "@apollo/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { apolloClient } from "./api/apollo";
import { env } from "./lib/env";
import { SessionProvider } from "./features/auth/SessionProvider";
import { ProtectedRoute } from "./features/auth/ProtectedRoute";
import { LoginPage } from "./features/auth/LoginPage";
import { AiPreferencesProvider } from "./features/ai/AiPreferencesProvider";
import { AccessProvider } from "./features/access/AccessProvider";
import { AppShell } from "./features/layout/AppShell";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { ExecutiveDashboardPage } from "./features/dashboard/ExecutiveDashboardPage";
import { AppointmentsPage } from "./features/operational/appointments/AppointmentsPage";
import { CheckInOutPage } from "./features/operational/check-in-out/CheckInOutPage";
import { SalesPage } from "./features/operational/sales/SalesPage";
import { SalesDetailPage } from "./features/operational/sales/SalesDetailPage";
import { MembersPage } from "./features/operational/members/MembersPage";
import { CustomerBehaviorPage } from "./features/analytics/customer-behavior/CustomerBehaviorPage";
import { ServiceBehaviorPage } from "./features/analytics/service-behavior/ServiceBehaviorPage";
import { PaymentReportPage } from "./features/analytics/payment-report/PaymentReportPage";
import { SalesBySellerPage } from "./features/analytics/sales-by-seller/SalesBySellerPage";
import { DailyTreatmentPage } from "./features/analytics/daily-treatment/DailyTreatmentPage";
import { BankingSummaryPage } from "./features/analytics/banking-summary/BankingSummaryPage";
import { CustomersBySalespersonPage } from "./features/analytics/customers-by-salesperson/CustomersBySalespersonPage";
import { CustomerPortalPage } from "./features/analytics/customer-portal/CustomerPortalPage";
import { CustomerDetailPage } from "./features/analytics/customer-portal/CustomerDetailPage";
import { ServicePortalPage } from "./features/analytics/service-portal/ServicePortalPage";
import { ServiceDetailPage } from "./features/analytics/service-portal/ServiceDetailPage";
import { TherapistPortalPage } from "./features/analytics/therapist-portal/TherapistPortalPage";
import { TherapistDetailPage } from "./features/analytics/therapist-portal/TherapistDetailPage";
import { ServiceListPage } from "./features/core/services/ServiceListPage";
import { ServicePackagesPage } from "./features/core/services/ServicePackagesPage";
import { ServiceCategoriesPage } from "./features/core/services/ServiceCategoriesPage";
import { ServiceRecordFormsPage } from "./features/core/services/ServiceRecordFormsPage";
import { ServiceConsentFormsPage } from "./features/core/services/ServiceConsentFormsPage";
import { ProductListPage } from "./features/core/products/ProductListPage";
import { ProductStockItemsPage } from "./features/core/products/ProductStockItemsPage";
import { InventoryHistoryPage } from "./features/core/inventory/InventoryHistoryPage";
import { InventoryReportPage } from "./features/core/inventory/InventoryReportPage";
import { StockSummaryPage } from "./features/core/inventory/StockSummaryPage";
import { SalesDocumentSettingsPage } from "./features/settings/sales-document/SalesDocumentSettingsPage";
import { TelegramSettingsPage } from "./features/settings/telegram/TelegramSettingsPage";

export default function App() {
  return (
    <GoogleOAuthProvider clientId={env.googleClientId}>
      <SessionProvider>
        <ApolloProvider client={apolloClient}>
          <AiPreferencesProvider>
            <AccessProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route
                    path="/"
                    element={
                      <ProtectedRoute>
                        <AppShell />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="dashboard" element={<DashboardPage />} />
                    <Route path="dashboard/overview" element={<ExecutiveDashboardPage />} />
                    <Route path="operational/appointments" element={<AppointmentsPage />} />
                    <Route path="operational/check-in-out" element={<CheckInOutPage />} />
                    <Route path="operational/sales" element={<SalesPage />} />
                    <Route path="operational/sales/:saleId" element={<SalesDetailPage />} />
                    <Route path="operational/members" element={<MembersPage />} />
                    <Route path="core/services/list" element={<ServiceListPage />} />
                    <Route path="core/services/packages" element={<ServicePackagesPage />} />
                    <Route path="core/services/categories" element={<ServiceCategoriesPage />} />
                    <Route path="core/services/record-forms" element={<ServiceRecordFormsPage />} />
                    <Route path="core/services/consent-forms" element={<ServiceConsentFormsPage />} />
                    <Route path="core/products/list" element={<ProductListPage />} />
                    <Route path="core/products/stock-items" element={<ProductStockItemsPage />} />
                    <Route path="core/inventory/history" element={<InventoryHistoryPage />} />
                    <Route path="core/inventory/report" element={<InventoryReportPage />} />
                    <Route path="core/inventory/stock-summary" element={<StockSummaryPage />} />
                    <Route path="analytics/sales-report" element={<Navigate to="/analytics/banking-summary" replace />} />
                    <Route path="analytics/banking-summary" element={<BankingSummaryPage />} />
                    <Route path="analytics/customer-behavior" element={<CustomerBehaviorPage />} />
                    <Route path="analytics/service-behavior" element={<ServiceBehaviorPage />} />
                    <Route path="analytics/therapists" element={<TherapistPortalPage />} />
                    <Route path="analytics/therapists/:therapistSlug" element={<TherapistDetailPage />} />
                    <Route path="analytics/services" element={<ServicePortalPage />} />
                    <Route path="analytics/services/:serviceSlug" element={<ServiceDetailPage />} />
                    <Route path="analytics/payment-report" element={<PaymentReportPage />} />
                    <Route path="analytics/daily-treatment" element={<DailyTreatmentPage />} />
                    <Route path="analytics/sales-by-seller" element={<SalesBySellerPage />} />
                    <Route path="analytics/customers-by-salesperson" element={<CustomersBySalespersonPage />} />
                    <Route path="analytics/customers" element={<CustomerPortalPage />} />
                    <Route path="analytics/customers/:customerSlug" element={<CustomerDetailPage />} />
                    <Route path="settings/sales-document" element={<SalesDocumentSettingsPage />} />
                    <Route path="settings/telegram" element={<TelegramSettingsPage />} />
                  </Route>
                </Routes>
              </BrowserRouter>
            </AccessProvider>
          </AiPreferencesProvider>
        </ApolloProvider>
      </SessionProvider>
    </GoogleOAuthProvider>
  );
}
