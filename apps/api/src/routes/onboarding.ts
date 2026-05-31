import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ONBOARDING_STEPS,
  completeStep,
  getRecord,
  progress,
  setDismissed,
  type OnboardingStep,
} from '../services/onboarding.js';
import { Scopes } from '../scopes.js';

// Per-user onboarding state. Three small steps that move a brand new
// account from "I just logged in" to "I'm using the API".
//
//   GET    /v1/onboarding              current record + computed progress
//   POST   /v1/onboarding/complete     body { step } mark a step done
//   POST   /v1/onboarding/dismiss      hide the welcome card on the home page
//   POST   /v1/onboarding/reset        body { dismissed? } un-dismiss + clear
//
// We deliberately keep "complete" idempotent: calling it a second time for
// the same step is a no-op so the UI does not have to track local state to
// avoid double-firing.

const StepSchema = z.object({
  step: z.enum(ONBOARDING_STEPS as readonly [OnboardingStep, ...OnboardingStep[]]),
});

export const onboardingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/onboarding', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.OnboardingRead)],
    handler: async (req) => {
      const rec = await getRecord(app.clawmind.dataDir, req.user!.id);
      return { record: rec, progress: progress(rec) };
    },
  });

  app.post('/onboarding/complete', {
    schema: { body: StepSchema },
    preHandler: [app.requireAuth, app.requireScope(Scopes.OnboardingWrite)],
    handler: async (req) => {
      const rec = await completeStep(app.clawmind.dataDir, req.user!.id, req.body.step);
      return { record: rec, progress: progress(rec) };
    },
  });

  app.post('/onboarding/dismiss', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.OnboardingWrite)],
    handler: async (req) => {
      const rec = await setDismissed(app.clawmind.dataDir, req.user!.id, true);
      return { record: rec, progress: progress(rec) };
    },
  });

  app.post('/onboarding/reset', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.OnboardingWrite)],
    handler: async (req) => {
      const rec = await setDismissed(app.clawmind.dataDir, req.user!.id, false);
      return { record: rec, progress: progress(rec) };
    },
  });
};
