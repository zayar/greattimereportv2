import { Router } from "express";
import { z } from "zod";
import { requireClinicAccess } from "../middleware/clinic-access.js";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { getDashboardOverview } from "../services/reports/dashboard.service.js";
import { getCustomerBehaviorReport } from "../services/reports/customer-behavior.service.js";
import { getServiceBehaviorReport } from "../services/reports/service-behavior.service.js";
import { getPaymentReport } from "../services/reports/payment-report.service.js";
import { getSalesBySellerReport } from "../services/reports/sales-by-seller.service.js";
import { getDailyTreatmentReport } from "../services/reports/daily-treatment.service.js";
import { getSalesReport } from "../services/reports/sales-report.service.js";
import { getBankingSummary } from "../services/reports/banking-summary.service.js";
import { asyncHandler } from "../utils/async-handler.js";

const router = Router();

const baseAnalyticsSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1),
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
});

router.use(verifyFirebaseToken);

router.get(
  "/dashboard",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = baseAnalyticsSchema.parse(req.query);
    const data = await getDashboardOverview(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/customer-behavior",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = baseAnalyticsSchema
      .extend({
        granularity: z.enum(["month", "quarter", "year"]).default("month"),
      })
      .parse(req.query);

    const data = await getCustomerBehaviorReport(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/service-behavior",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = baseAnalyticsSchema
      .extend({
        granularity: z.enum(["month", "quarter", "year"]).default("month"),
      })
      .parse(req.query);

    const data = await getServiceBehaviorReport(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/payment-report",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = baseAnalyticsSchema
      .extend({
        search: z.string().default(""),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(20),
      })
      .parse(req.query);

    const data = await getPaymentReport({
      clinicCode: params.clinicCode,
      fromDate: params.fromDate,
      toDate: params.toDate,
      search: params.search,
      limit: params.pageSize,
      offset: (params.page - 1) * params.pageSize,
    });

    res.json({ success: true, data });
  }),
);

router.get(
  "/sales-report",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = baseAnalyticsSchema
      .extend({
        search: z.string().default(""),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(20),
      })
      .parse(req.query);

    const data = await getSalesReport({
      clinicCode: params.clinicCode,
      fromDate: params.fromDate,
      toDate: params.toDate,
      search: params.search,
      limit: params.pageSize,
      offset: (params.page - 1) * params.pageSize,
    });

    res.json({ success: true, data });
  }),
);

router.get(
  "/daily-treatment",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = z
      .object({
        clinicId: z.string().min(1),
        clinicCode: z.string().min(1),
        date: z.string().min(1),
      })
      .parse(req.query);

    const data = await getDailyTreatmentReport({
      clinicCode: params.clinicCode,
      date: params.date,
    });

    res.json({ success: true, data });
  }),
);

router.get(
  "/banking-summary",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = baseAnalyticsSchema.parse(req.query);
    const data = await getBankingSummary(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/sales-by-seller",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = baseAnalyticsSchema.parse(req.query);
    const data = await getSalesBySellerReport(params);
    res.json({ success: true, data });
  }),
);

export default router;
