export type AirportCode = "JFK" | "EWR" | "LGA";
export type SourceTier = "official" | "secondary" | "modeled";
export type CollectorStatus = "ok" | "unavailable" | "suspended" | "error";

export type LaneWaits = {
  general: number | null;
  precheck: number | null;
  clear: number | null;
  clear_precheck: number | null;
};

export type WaitObservation = {
  airportCode: AirportCode;
  terminalName: string;
  checkpointName: string;
  sourceTier: SourceTier;
  sourceUrl: string;
  observedAt: string;
  observedWaits: LaneWaits;
  status: CollectorStatus;
  rawPayload?: unknown;
  notes?: string;
};

export type CollectorRunResult = {
  airportCode: AirportCode;
  startedAt: string;
  finishedAt: string;
  status: "ok" | "partial" | "error";
  observations: WaitObservation[];
  errorMessage?: string;
};

export interface AirportAdapter {
  airportCode: AirportCode;
  fetchWaits(): Promise<WaitObservation[]>;
}