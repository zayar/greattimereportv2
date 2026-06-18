import { env } from "../../config/env.js";
import { getPaymentReport } from "../reports/payment-report.service.js";
import { getSalesReport } from "../reports/sales-report.service.js";
import { runCustomerRelationshipLearning } from "../reports/customer-relationship-learning.service.js";
import { getServiceBehaviorReport } from "../reports/service-behavior.service.js";
import { getTherapistPortalReport } from "../reports/therapist-portal.service.js";
import { fetchLiveAppointmentSnapshot } from "./appointment-live.service.js";
import {
  acquireAgentLearningLock,
  saveAgentLearningRun,
  type AgentLearningJobType,
} from "./learning.repository.js";

const DEFAULT_JOB_TYPES: AgentLearningJobType[] = [
  "customer_profiles",
  "finance_daily_snapshot",
  "service_practitioner_profiles",
  "appointment_daily_profile",
  "feedback_learning",
  "owner_insight_cards",
];

function previousDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function runJob(params: {
  clinicId: string;
  clinicCode: string;
  jobType: AgentLearningJobType;
  dateKey: string;
}) {
  switch (params.jobType) {
    case "customer_profiles": {
      const summary = await runCustomerRelationshipLearning({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        lookbackDays: Number(env.AGENT_LEARNING_DEFAULT_LOOKBACK_DAYS),
      });
      return { rowCount: summary.profilesSaved, sourceWatermark: summary.learnedAt };
    }
    case "finance_daily_snapshot": {
      const [sales, payments] = await Promise.all([
        getSalesReport({
          clinicCode: params.clinicCode,
          fromDate: params.dateKey,
          toDate: params.dateKey,
          search: "",
          limit: 1,
          offset: 0,
        }),
        getPaymentReport({
          clinicId: params.clinicId,
          clinicCode: params.clinicCode,
          fromDate: params.dateKey,
          toDate: params.dateKey,
          search: "",
          paymentMethod: "",
          includeZeroValues: false,
          limit: 1,
          offset: 0,
        }),
      ]);
      return {
        rowCount: sales.summary.invoiceCount + payments.methods.length,
        sourceWatermark: params.dateKey,
      };
    }
    case "service_practitioner_profiles": {
      const [service, practitioner] = await Promise.all([
        getServiceBehaviorReport({
          clinicCode: params.clinicCode,
          fromDate: previousDateKey(params.dateKey),
          toDate: params.dateKey,
          granularity: "month",
        }),
        getTherapistPortalReport({
          clinicCode: params.clinicCode,
          fromDate: previousDateKey(params.dateKey),
          toDate: params.dateKey,
          search: "",
          serviceCategory: "",
          sortBy: "treatmentsCompleted",
          sortDirection: "desc",
        }),
      ]);
      return {
        rowCount: service.topServices.length + practitioner.leaderboard.length,
        sourceWatermark: params.dateKey,
      };
    }
    case "appointment_daily_profile": {
      const snapshot = await fetchLiveAppointmentSnapshot({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        dateKey: params.dateKey,
        timezone: env.DEFAULT_TIMEZONE,
      });
      return { rowCount: snapshot.rows.length, sourceWatermark: snapshot.checkedAt };
    }
    case "feedback_learning":
    case "owner_insight_cards":
      return { rowCount: 0, sourceWatermark: params.dateKey };
    default:
      return { rowCount: 0, sourceWatermark: params.dateKey };
  }
}

export async function runAgentLearningTick(params: {
  clinicIds?: string[];
  clinicCodesById?: Record<string, string>;
  jobTypes?: AgentLearningJobType[];
  dateKey?: string;
}) {
  if (!env.AGENT_LEARNING_ENABLED) {
    return {
      enabled: false,
      results: [],
    };
  }

  const dateKey = params.dateKey ?? new Date().toISOString().slice(0, 10);
  const jobTypes = params.jobTypes?.length ? params.jobTypes : DEFAULT_JOB_TYPES;
  const clinicIds = params.clinicIds ?? Object.keys(params.clinicCodesById ?? {});
  const results: Array<{
    clinicId: string;
    jobType: AgentLearningJobType;
    status: "completed" | "skipped" | "failed";
    rowCount: number;
  }> = [];

  for (const clinicId of clinicIds) {
    const clinicCode = params.clinicCodesById?.[clinicId];

    for (const jobType of jobTypes) {
      if (!clinicCode) {
        await saveAgentLearningRun({
          clinicId,
          jobType,
          bucket: dateKey,
          status: "skipped",
          rowCount: 0,
          error: "Missing clinicCode for scheduled job.",
        });
        results.push({ clinicId, jobType, status: "skipped", rowCount: 0 });
        continue;
      }

      const acquired = await acquireAgentLearningLock({ clinicId, jobType, bucket: dateKey });
      if (!acquired) {
        results.push({ clinicId, jobType, status: "skipped", rowCount: 0 });
        continue;
      }

      await saveAgentLearningRun({ clinicId, clinicCode, jobType, bucket: dateKey, status: "started" });

      try {
        const outcome = await runJob({ clinicId, clinicCode, jobType, dateKey });
        await saveAgentLearningRun({
          clinicId,
          clinicCode,
          jobType,
          bucket: dateKey,
          status: "completed",
          rowCount: outcome.rowCount,
          sourceWatermark: outcome.sourceWatermark,
        });
        results.push({ clinicId, jobType, status: "completed", rowCount: outcome.rowCount });
      } catch (error) {
        await saveAgentLearningRun({
          clinicId,
          clinicCode,
          jobType,
          bucket: dateKey,
          status: "failed",
          rowCount: 0,
          error,
        });
        results.push({ clinicId, jobType, status: "failed", rowCount: 0 });
      }
    }
  }

  return {
    enabled: true,
    results,
  };
}
