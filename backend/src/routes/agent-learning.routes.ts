import { Router } from "express";
import { env } from "../config/env.js";
import { agentLearningRunAllSchema, agentLearningTickSchema } from "../services/agent-hub/schemas.js";
import { runAgentLearningForSchedules, runAgentLearningTick } from "../services/agent-hub/learning-worker.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../utils/http-error.js";

const router = Router();

function requireSchedulerSecret(headerValue: unknown) {
  if (!env.AGENT_LEARNING_SCHEDULER_SECRET) {
    throw new HttpError(503, "Agent learning scheduler secret is not configured.");
  }

  if (typeof headerValue !== "string" || headerValue !== env.AGENT_LEARNING_SCHEDULER_SECRET) {
    throw new HttpError(401, "Invalid agent learning scheduler secret.");
  }
}

export function isAgentLearningSchedulerSecretValid(headerValue: unknown) {
  return Boolean(
    env.AGENT_LEARNING_SCHEDULER_SECRET &&
      typeof headerValue === "string" &&
      headerValue === env.AGENT_LEARNING_SCHEDULER_SECRET,
  );
}

router.post(
  "/agent-learning/tick",
  asyncHandler(async (req, res) => {
    requireSchedulerSecret(req.header("x-agent-learning-scheduler-secret"));
    const params = agentLearningTickSchema.parse(req.body ?? {});
    const data = await runAgentLearningTick({
      clinicIds: params.clinicIds,
      clinicCodesById: params.clinicCodesById,
      jobTypes: params.jobTypes,
      dateKey: params.date,
      now: params.runAt ? new Date(params.runAt) : undefined,
      timezone: params.timezone,
      dryRun: params.dryRun,
      operationalIntervalMinutes: params.operationalIntervalMinutes,
    });

    res.json({ success: true, data });
  }),
);

router.post(
  "/agent-learning/run-all",
  asyncHandler(async (req, res) => {
    requireSchedulerSecret(req.header("x-agent-learning-scheduler-secret"));
    const params = agentLearningRunAllSchema.parse(req.body ?? {});
    const data = await runAgentLearningForSchedules({
      clinicIds: params.clinicIds,
      jobTypes: params.jobTypes,
      dryRun: params.dryRun,
    });

    res.json({ success: true, data });
  }),
);

export default router;
