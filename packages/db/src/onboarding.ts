import { ONBOARDING_STEPS, type OnboardingStep } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { UuidSchema } from "./json";

const StepSchema = z.enum(ONBOARDING_STEPS);

/** Current onboarding step of the company; throws when the company is missing or not visible. */
export async function getOnboardingStep(db: DbClient, companyId: string): Promise<OnboardingStep> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db.from("companies").select("onboarding_step").eq("id", id).maybeSingle();
  if (error) throw dbError("Could not load onboarding step", error);
  if (!data) throw new DbError(`Company ${id} not found`);
  return StepSchema.parse(data.onboarding_step);
}

/** Moves the company to `step`; throws when no visible row was updated. */
export async function setOnboardingStep(db: DbClient, companyId: string, step: OnboardingStep): Promise<void> {
  const id = UuidSchema.parse(companyId);
  const next = StepSchema.parse(step);
  const { data, error } = await db.from("companies").update({ onboarding_step: next }).eq("id", id).select("id");
  if (error) throw dbError("Could not set onboarding step", error);
  if (!data || data.length === 0) throw new DbError(`Company ${id} not found`);
}
