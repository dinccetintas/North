import { cache } from "react";
import { getEntitlement, getProfile, listCompanies, type CompanySummary, type ProfileRecord } from "@north/db";
import type { Entitlement } from "@north/core/billing/entitlements";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in owner's plan, profile and companies under RLS, deduplicated
 * per request so the app header, `/companies`, `/new` and the settings pages
 * share one query each. Server only.
 */
export const ownerEntitlement = cache(async (userId: string): Promise<Entitlement | null> => getEntitlement(await createClient(), userId));

export const ownerProfile = cache(async (userId: string): Promise<ProfileRecord | null> => getProfile(await createClient(), userId));

export const ownerCompanies = cache(async (): Promise<readonly CompanySummary[]> => listCompanies(await createClient()));
