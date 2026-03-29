import type { getCustomerPortalOverview } from "../services/reports/customer-portal.service.js";
import type { getDashboardOverview } from "../services/reports/dashboard.service.js";
import type { getServicePortalOverview } from "../services/reports/service-portal.service.js";

export type DashboardResponse = Awaited<ReturnType<typeof getDashboardOverview>>;
export type CustomerPortalOverviewResponse = Awaited<ReturnType<typeof getCustomerPortalOverview>>;
export type ServicePortalOverviewResponse = Awaited<ReturnType<typeof getServicePortalOverview>>;
