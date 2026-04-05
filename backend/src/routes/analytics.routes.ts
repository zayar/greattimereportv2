import { Router } from "express";
import { z } from "zod";
import { requireClinicAccess } from "../middleware/clinic-access.js";
import { verifyFirebaseToken } from "../middleware/auth.js";
import { getDashboardOverview } from "../services/reports/dashboard.service.js";
import { getCustomerBehaviorReport } from "../services/reports/customer-behavior.service.js";
import { getServiceBehaviorReport } from "../services/reports/service-behavior.service.js";
import {
  getTherapistPortalCustomers,
  getTherapistPortalOverview,
  getTherapistPortalReport,
  getTherapistPortalTreatments,
} from "../services/reports/therapist-portal.service.js";
import {
  getServicePortalCustomers,
  getServicePortalList,
  getServicePortalOverview,
  getServicePortalPayments,
} from "../services/reports/service-portal.service.js";
import { getPaymentReport } from "../services/reports/payment-report.service.js";
import { getSalesBySellerReport } from "../services/reports/sales-by-seller.service.js";
import { getDailyTreatmentReport } from "../services/reports/daily-treatment.service.js";
import { getSalesReport } from "../services/reports/sales-report.service.js";
import { getBankingSummary } from "../services/reports/banking-summary.service.js";
import { getCustomersBySalespersonReport } from "../services/reports/customers-by-salesperson.service.js";
import {
  getPackagePortalDetail,
  getPackagePortalReport,
} from "../services/reports/package-portal.service.js";
import {
  getCustomerPortalBookings,
  getCustomerPortalList,
  getCustomerQuickView,
  getCustomerPortalOverview,
  getCustomerPortalPackages,
  getCustomerPortalPayments,
  getCustomerPortalUsage,
} from "../services/reports/customer-portal.service.js";
import { asyncHandler } from "../utils/async-handler.js";

const router = Router();

const baseAnalyticsSchema = z.object({
  clinicId: z.string().min(1),
  clinicCode: z.string().min(1),
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
});

const customerIdentityFields = {
  customerName: z.string().default(""),
  customerPhone: z.string().default(""),
};

const hasCustomerIdentity = (value: { customerName: string; customerPhone: string }) =>
  value.customerName.trim() !== "" || value.customerPhone.trim() !== "";

const customerDetailSchema = baseAnalyticsSchema.extend(customerIdentityFields).refine(hasCustomerIdentity, {
  message: "customerName or customerPhone is required",
});

const customerPagedDetailSchema = baseAnalyticsSchema
  .extend({
    ...customerIdentityFields,
    search: z.string().default(""),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(20),
  })
  .refine(hasCustomerIdentity, {
    message: "customerName or customerPhone is required",
  });

const customerUsageSchema = baseAnalyticsSchema
  .extend({
    ...customerIdentityFields,
    year: z.coerce.number().min(2020).max(2100).default(new Date().getFullYear()),
    serviceCategory: z.string().default(""),
  })
  .refine(hasCustomerIdentity, {
    message: "customerName or customerPhone is required",
  });

const serviceDetailSchema = baseAnalyticsSchema.extend({
  serviceName: z.string().min(1),
});

const servicePagedDetailSchema = baseAnalyticsSchema.extend({
  serviceName: z.string().min(1),
  search: z.string().default(""),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

const therapistDetailSchema = baseAnalyticsSchema.extend({
  therapistName: z.string().min(1),
});

const packagePortalSchema = baseAnalyticsSchema.extend({
  packageId: z.string().default(""),
  category: z.string().default(""),
  therapist: z.string().default(""),
  salesperson: z.string().default(""),
  status: z.string().default(""),
  inactivityBucket: z.string().default(""),
  onlyRemaining: z.coerce.boolean().default(false),
});

const therapistPagedDetailSchema = therapistDetailSchema.extend({
  search: z.string().default(""),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
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
  "/customers",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = baseAnalyticsSchema
      .extend({
        search: z.string().default(""),
        status: z.string().default(""),
        spendTier: z.string().default(""),
        therapist: z.string().default(""),
        serviceCategory: z.string().default(""),
        sortBy: z.enum(["lifetimeSpend", "lastVisitDate", "visitCount", "averageSpend"]).default("lifetimeSpend"),
        sortDirection: z.enum(["asc", "desc"]).default("desc"),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(25),
      })
      .parse(req.query);

    const data = await getCustomerPortalList({
      clinicCode: params.clinicCode,
      fromDate: params.fromDate,
      toDate: params.toDate,
      search: params.search,
      status: params.status,
      spendTier: params.spendTier,
      therapist: params.therapist,
      serviceCategory: params.serviceCategory,
      sortBy: params.sortBy,
      sortDirection: params.sortDirection,
      limit: params.pageSize,
      offset: (params.page - 1) * params.pageSize,
    });

    res.json({ success: true, data });
  }),
);

router.get(
  "/customers/detail/quick-view",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = customerDetailSchema.parse(req.query);
    const data = await getCustomerQuickView(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/customers/detail/overview",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = customerDetailSchema.parse(req.query);
    const data = await getCustomerPortalOverview(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/customers/detail/packages",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = customerDetailSchema.parse(req.query);
    const data = await getCustomerPortalPackages(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/customers/detail/bookings",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = customerPagedDetailSchema.parse(req.query);

    const data = await getCustomerPortalBookings(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/customers/detail/payments",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = customerPagedDetailSchema.parse(req.query);

    const data = await getCustomerPortalPayments(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/customers/detail/usage",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = customerUsageSchema.parse(req.query);

    const data = await getCustomerPortalUsage(params);
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
  "/packages",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = packagePortalSchema.parse(req.query);
    const data = await getPackagePortalReport({
      clinicId: params.clinicId,
      fromDate: params.fromDate,
      toDate: params.toDate,
      packageId: params.packageId,
      category: params.category,
      therapist: params.therapist,
      salesperson: params.salesperson,
      status: params.status,
      inactivityBucket: params.inactivityBucket,
      onlyRemaining: params.onlyRemaining,
      authorizationHeader: req.headers.authorization,
    });

    res.json({ success: true, data });
  }),
);

router.get(
  "/packages/detail",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = packagePortalSchema
      .extend({
        packageId: z.string().min(1),
      })
      .parse(req.query);
    const data = await getPackagePortalDetail({
      clinicId: params.clinicId,
      fromDate: params.fromDate,
      toDate: params.toDate,
      packageId: params.packageId,
      category: params.category,
      therapist: params.therapist,
      salesperson: params.salesperson,
      status: params.status,
      inactivityBucket: params.inactivityBucket,
      onlyRemaining: params.onlyRemaining,
      authorizationHeader: req.headers.authorization,
    });

    res.json({ success: true, data });
  }),
);

router.get(
  "/therapists",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = baseAnalyticsSchema
      .extend({
        search: z.string().default(""),
        serviceCategory: z.string().default(""),
        sortBy: z
          .enum([
            "treatmentsCompleted",
            "customersServed",
            "estimatedTreatmentValue",
            "repeatCustomerRate",
            "growthRate",
            "utilizationScore",
          ])
          .default("treatmentsCompleted"),
        sortDirection: z.enum(["asc", "desc"]).default("desc"),
      })
      .parse(req.query);

    const data = await getTherapistPortalReport(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/therapists/detail/overview",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = therapistDetailSchema.parse(req.query);
    const data = await getTherapistPortalOverview(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/therapists/detail/customers",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = therapistPagedDetailSchema.parse(req.query);
    const data = await getTherapistPortalCustomers(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/therapists/detail/treatments",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = therapistPagedDetailSchema.parse(req.query);
    const data = await getTherapistPortalTreatments(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/services",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = baseAnalyticsSchema
      .extend({
        search: z.string().default(""),
        serviceCategory: z.string().default(""),
        sortBy: z
          .enum([
            "totalRevenue",
            "bookingCount",
            "customerCount",
            "averageSellingPrice",
            "repeatPurchaseRate",
            "growthRate",
          ])
          .default("totalRevenue"),
        sortDirection: z.enum(["asc", "desc"]).default("desc"),
      })
      .parse(req.query);

    const data = await getServicePortalList(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/services/detail/overview",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = serviceDetailSchema.parse(req.query);
    const data = await getServicePortalOverview(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/services/detail/customers",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = servicePagedDetailSchema.parse(req.query);
    const data = await getServicePortalCustomers(params);
    res.json({ success: true, data });
  }),
);

router.get(
  "/services/detail/payments",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = servicePagedDetailSchema.parse(req.query);
    const data = await getServicePortalPayments(params);
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
        paymentMethod: z.string().default(""),
        includeZeroValues: z
          .preprocess((value) => value === true || value === "true", z.boolean())
          .default(false),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(20),
      })
      .parse(req.query);

    const data = await getPaymentReport({
      clinicCode: params.clinicCode,
      fromDate: params.fromDate,
      toDate: params.toDate,
      search: params.search,
      paymentMethod: params.paymentMethod,
      includeZeroValues: params.includeZeroValues,
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
    const params = baseAnalyticsSchema
      .extend({
        search: z.string().default(""),
        paymentMethod: z.string().default(""),
        walletTopupFilter: z.enum(["all", "hide", "only"]).default("all"),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(50),
      })
      .parse(req.query);

    const data = await getBankingSummary({
      clinicCode: params.clinicCode,
      fromDate: params.fromDate,
      toDate: params.toDate,
      search: params.search,
      paymentMethod: params.paymentMethod,
      walletTopupFilter: params.walletTopupFilter,
      limit: params.pageSize,
      offset: (params.page - 1) * params.pageSize,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  "/sales-by-seller",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = baseAnalyticsSchema
      .extend({
        sellerName: z.string().default(""),
        search: z.string().default(""),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(25),
      })
      .parse(req.query);

    const data = await getSalesBySellerReport({
      clinicCode: params.clinicCode,
      fromDate: params.fromDate,
      toDate: params.toDate,
      sellerName: params.sellerName,
      search: params.search,
      limit: params.pageSize,
      offset: (params.page - 1) * params.pageSize,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  "/customers-by-salesperson",
  requireClinicAccess("query", "clinicId"),
  asyncHandler(async (req, res) => {
    const params = baseAnalyticsSchema
      .extend({
        sellerName: z.string().default(""),
        search: z.string().default(""),
        page: z.coerce.number().min(1).default(1),
        pageSize: z.coerce.number().min(1).max(100).default(25),
      })
      .parse(req.query);

    const data = await getCustomersBySalespersonReport({
      clinicCode: params.clinicCode,
      fromDate: params.fromDate,
      toDate: params.toDate,
      sellerName: params.sellerName,
      search: params.search,
      limit: params.pageSize,
      offset: (params.page - 1) * params.pageSize,
    });

    res.json({ success: true, data });
  }),
);

export default router;
