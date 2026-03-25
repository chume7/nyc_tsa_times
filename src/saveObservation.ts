import { createClient } from "@supabase/supabase-js";
import type { WaitObservation } from "./types.js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

export async function saveObservation(observation: WaitObservation): Promise<void> {
  const { error } = await supabase.from("wait_time_observations").insert({
    airport_code: observation.airportCode,
    terminal_name: observation.terminalName,
    checkpoint_name: observation.checkpointName,
    source_tier: observation.sourceTier,
    source_url: observation.sourceUrl,
    observed_at: observation.observedAt,
    general_wait_min: observation.observedWaits.general,
    precheck_wait_min: observation.observedWaits.precheck,
    clear_wait_min: observation.observedWaits.clear,
    clear_precheck_wait_min: observation.observedWaits.clear_precheck,
    status: observation.status,
    notes: observation.notes ?? null,
    raw_payload: observation.rawPayload ?? null,
  });

  if (error) throw error;
}