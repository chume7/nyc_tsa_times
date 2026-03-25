import "dotenv/config";

import { saveObservation } from "./src/saveObservation.js";
import fetch, { Headers } from "node-fetch";

import type {
  WaitObservation,
  AirportAdapter,
  CollectorRunResult,
} from "./src/types.js";

/* ------------------ Utilities ------------------ */

function nowIso() {
  return new Date().toISOString();
}

async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      ...(headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  return json as T;
}

/* ------------------ LGA + EWR Parser ------------------ */

type LgaQueueRecord = {
  terminal: string;
  checkPoint: string;
  queueType: "Reg" | "TSAPre";
  timeInMinutes: number;
  isWaitTimeAvailable: boolean;
  queueOpen: boolean;
  updateTime: string;
};

function parseLgaRecords(
  records: LgaQueueRecord[],
  sourceUrl: string,
  airportCode: "LGA" | "EWR"
): WaitObservation[] {
  const grouped = new Map<string, Partial<WaitObservation>>();

  for (const r of records) {
    const key = `${r.terminal}-${r.checkPoint}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        airportCode,
        terminalName: r.terminal,
        checkpointName: r.checkPoint,
        sourceTier: "official",
        sourceUrl,
        observedAt: new Date(r.updateTime).toISOString(),
        observedWaits: {
          general: null,
          precheck: null,
          clear: null,
          clear_precheck: null,
        },
        status: "ok",
      });
    }

    const entry = grouped.get(key)!;

    if (r.queueType === "Reg") {
      entry.observedWaits!.general = r.timeInMinutes;
    }

    if (r.queueType === "TSAPre") {
      entry.observedWaits!.precheck = r.timeInMinutes;
    }
  }

  return Array.from(grouped.values()) as WaitObservation[];
}

/* ------------------ JFK Parser ------------------ */

type JfkRecord = {
  title: string;
  terminal: string;
  gate: string;
  checkPoint: string;
  queueType: "Reg" | "TSAPre";
  isOpen: boolean;
  waitTime: number;
  isWaitTimeAvailable: boolean;
  status: string;
  lastUpdated: string;
};


async function fetchJfkWaits(): Promise<WaitObservation[]> {
  const url = "https://api.jfkairport.com/graphql";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/graphql-response+json,application/json;q=0.9",
      "Content-Type": "application/json",
      Referer: "https://www.jfkairport.com/",
    },
    body: JSON.stringify({
      operationName: "GetSecurityWaitTimes",
      variables: {
        airportCode: "JFK",
      },
      extensions: {
        clientLibrary: {
          name: "@apollo/client",
          version: "4.0.4",
        },
      },
      query: `
        query GetSecurityWaitTimes($airportCode: String!, $terminal: String) {
          securityWaitTimes(airportCode: $airportCode, terminal: $terminal) {
            title
            terminal
            gate
            checkPoint
            queueType
            isOpen
            waitTime
            isWaitTimeAvailable
            status
            lastUpdated
            __typename
          }
        }
      `,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`JFK request failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as {
    data?: {
      securityWaitTimes?: JfkRecord[];
    };
    errors?: unknown;
  };

  if (!json.data?.securityWaitTimes) {
    throw new Error(`JFK response missing data.securityWaitTimes: ${JSON.stringify(json)}`);
  }

  const records = json.data.securityWaitTimes;

  const grouped = new Map<string, Partial<WaitObservation>>();

  for (const r of records) {
    const terminalName = `T${r.terminal}`;
    const checkpointName = r.checkPoint;

    const key = `${terminalName}-${checkpointName}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        airportCode: "JFK",
        terminalName,
        checkpointName,
        sourceTier: "official",
        sourceUrl: url,
        observedAt: new Date().toISOString(),
        observedWaits: {
          general: null,
          precheck: null,
          clear: null,
          clear_precheck: null,
        },
        status: "ok",
      });
    }

    const entry = grouped.get(key)!;

    if (r.queueType === "Reg") {
      entry.observedWaits!.general = r.waitTime;
    }

    if (r.queueType === "TSAPre") {
      entry.observedWaits!.precheck = r.waitTime;
    }
  }

  return Array.from(grouped.values()) as WaitObservation[];
}

/* ------------------ Adapters ------------------ */

const LGA_URL =
  "https://avi-prod-mpp-webapp-api.azurewebsites.net/api/v1/SecurityWaitTimesPoints/LGA";

const lgaAdapter: AirportAdapter = {
    airportCode: "LGA",
    async fetchWaits() {
      console.log("Fetching LGA...");
      const data = await fetchJson<LgaQueueRecord[]>(LGA_URL, {
        Referer: "https://www.laguardiaairport.com/",
      });
      return parseLgaRecords(data, LGA_URL, "LGA");
    },
  };
  

const EWR_URL =
  "https://avi-prod-mpp-webapp-api.azurewebsites.net/api/v1/SecurityWaitTimesPoints/EWR";

const ewrAdapter: AirportAdapter = {
    airportCode: "EWR",
    async fetchWaits() {
      console.log("Fetching EWR...");
      const data = await fetchJson<LgaQueueRecord[]>(EWR_URL, {
        Referer: "https://www.newarkairport.com/",
      });
      return parseLgaRecords(data, EWR_URL, "EWR");
    },
  };

const jfkAdapter: AirportAdapter = {
  airportCode: "JFK",
  async fetchWaits() {
    console.log("Fetching JFK...");
    return fetchJfkWaits();
  },
};

const adapters: AirportAdapter[] = [lgaAdapter, ewrAdapter, jfkAdapter];

/* ------------------ Runner ------------------ */

async function runHourlyCollection(): Promise<CollectorRunResult[]> {
  console.log("Starting collection...");

  const results: CollectorRunResult[] = [];

  for (const adapter of adapters) {
    const startedAt = nowIso();

    try {
      const observations = await adapter.fetchWaits();

      console.log(
        `${adapter.airportCode}: ${observations.length} observations`
      );

      for (const obs of observations) {
        console.log(
          `Saving ${obs.airportCode} ${obs.terminalName} ${obs.checkpointName}`
        );
        await saveObservation(obs);
      }

      results.push({
        airportCode: adapter.airportCode,
        startedAt,
        finishedAt: nowIso(),
        status: "ok",
        observations,
      });
    } catch (error: any) {
      console.error(`Error for ${adapter.airportCode}:`, error);

      results.push({
        airportCode: adapter.airportCode,
        startedAt,
        finishedAt: nowIso(),
        status: "error",
        observations: [],
        errorMessage: error.message,
      });
    }
  }

  return results;
}

async function main() {
  console.log("Collector starting...");
  await runHourlyCollection();
  console.log("Collector finished.");
}

/* 🔥 ALWAYS RUN */
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});