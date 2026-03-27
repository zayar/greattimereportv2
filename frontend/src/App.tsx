import { ApolloProvider } from "@apollo/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { apolloClient } from "./api/apollo";
import { env } from "./lib/env";
import { SessionProvider } from "./features/auth/SessionProvider";
import { ProtectedRoute } from "./features/auth/ProtectedRoute";
import { LoginPage } from "./features/auth/LoginPage";
import { AccessProvider } from "./features/access/AccessProvider";
import { AppShell } from "./features/layout/AppShell";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { AppointmentsPage } from "./features/operational/appointments/AppointmentsPage";
import { SalesPage } from "./features/operational/sales/SalesPage";
import { MembersPage } from "./features/operational/members/MembersPage";
import { CustomerBehaviorPage } from "./features/analytics/customer-behavior/CustomerBehaviorPage";
import { ServiceBehaviorPage } from "./features/analytics/service-behavior/ServiceBehaviorPage";
import { PaymentReportPage } from "./features/analytics/payment-report/PaymentReportPage";
import { SalesBySellerPage } from "./features/analytics/sales-by-seller/SalesBySellerPage";
import { DailyTreatmentPage } from "./features/analytics/daily-treatment/DailyTreatmentPage";
import { BankingSummaryPage } from "./features/analytics/banking-summary/BankingSummaryPage";
import { CustomersBySalespersonPage } from "./features/analytics/customers-by-salesperson/CustomersBySalespersonPage";

export default function App() {
  return (
    <GoogleOAuthProvider clientId={env.googleClientId}>
      <SessionProvider>
        <ApolloProvider client={apolloClient}>
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
                  <Route path="operational/appointments" element={<AppointmentsPage />} />
                  <Route path="operational/sales" element={<SalesPage />} />
                  <Route path="operational/members" element={<MembersPage />} />
                  <Route path="analytics/sales-report" element={<Navigate to="/analytics/banking-summary" replace />} />
                  <Route path="analytics/banking-summary" element={<BankingSummaryPage />} />
                  <Route path="analytics/customer-behavior" element={<CustomerBehaviorPage />} />
                  <Route path="analytics/service-behavior" element={<ServiceBehaviorPage />} />
                  <Route path="analytics/payment-report" element={<PaymentReportPage />} />
                  <Route path="analytics/daily-treatment" element={<DailyTreatmentPage />} />
                  <Route path="analytics/sales-by-seller" element={<SalesBySellerPage />} />
                  <Route path="analytics/customers-by-salesperson" element={<CustomersBySalespersonPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </AccessProvider>
        </ApolloProvider>
      </SessionProvider>
    </GoogleOAuthProvider>
  );
}
