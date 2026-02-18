import { insertPositions, pruneOldPositions, type PositionRow } from "./positions-db";

// 8 overlapping 250 nm radius circles that cover CONUS with no gaps
const CONUS_TILES: Array<{ lat: number; lon: number }> = [
  { lat: 47.5, lon: -122.5 }, // Pacific Northwest
  { lat: 47.5, lon: -110.0 }, // Northern Rockies
  { lat: 47.5, lon: -97.0  }, // Northern Plains
  { lat: 34.0, lon: -117.0 }, // Southwest
  { lat: 36.0, lon: -100.0 }, // Central
  { lat: 32.0, lon: -85.0  }, // Southeast
  { lat: 42.0, lon: -74.0  }, // Northeast
  { lat: 29.0, lon: -90.0  }, // Gulf Coast
];

const RADIUS_NM = 250;
const POLL_INTERVAL_MS = 60_000;
const RETENTION_SECONDS = 24 * 3600; // 24 hours

let pollerTimer: ReturnType<typeof setInterval> | null = null;
let isPolling = false;

async function fetchTile(lat: number, lon: number): Promise<any[]> {
  const url = `https://api.adsb.lol/v2/point/${lat}/${lon}/${RADIUS_NM}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    console.warn(`[poller] Tile ${lat},${lon} returned HTTP ${res.status}`);
    return [];
  }
  const data = await res.json();
  return data.ac || [];
}

async function pollOnce() {
  if (isPolling) {
    console.warn("[poller] Previous poll still running — skipping this cycle");
    return;
  }
  isPolling = true;
  const startMs = Date.now();

  try {
    // Fetch all tiles in parallel
    const results = await Promise.allSettled(
      CONUS_TILES.map(tile => fetchTile(tile.lat, tile.lon))
    );

    // Deduplicate by icao24 — keep first occurrence (overlapping tiles may repeat aircraft)
    const seen = new Map<string, any>();
    let tileCount = 0;
    for (const result of results) {
      if (result.status === "rejected") {
        console.warn("[poller] Tile fetch failed:", result.reason);
        continue;
      }
      tileCount++;
      for (const ac of result.value) {
        if (!ac.hex || ac.lat == null || ac.lon == null) continue;
        const icao24 = (ac.hex as string).toLowerCase();
        if (!seen.has(icao24)) {
          seen.set(icao24, ac);
        }
      }
    }

    const ts = Math.floor(Date.now() / 1000);
    const positions: PositionRow[] = [];

    for (const [icao24, ac] of seen) {
      positions.push({
        icao24,
        callsign: (ac.flight?.trim() as string | undefined) || null,
        lat: ac.lat,
        lon: ac.lon,
        alt: ac.alt_baro ?? ac.alt_geom ?? null,
        speed: ac.gs ?? null,
        heading: ac.track ?? null,
        vrate: ac.baro_rate ?? ac.geom_rate ?? null,
        squawk: ac.squawk ?? null,
        on_ground: ac.gs != null && (ac.gs as number) < 5 ? 1 : 0,
        ts,
      });
    }

    if (positions.length > 0) {
      insertPositions(positions);
    }

    pruneOldPositions(RETENTION_SECONDS);

    console.log(
      `[poller] Poll complete: ${tileCount}/${CONUS_TILES.length} tiles, ` +
      `${positions.length} unique aircraft, ${Date.now() - startMs}ms`
    );
  } catch (err) {
    console.error("[poller] Unexpected error during poll:", err);
  } finally {
    isPolling = false;
  }
}

export function startGlobalPoller() {
  if (pollerTimer) return; // Already running
  console.log(
    `[poller] Starting global CONUS poller — interval=${POLL_INTERVAL_MS / 1000}s, ` +
    `retention=${RETENTION_SECONDS / 3600}h, tiles=${CONUS_TILES.length}`
  );

  // First poll immediately so the DB has data before the first user request
  pollOnce().catch(err => console.error("[poller] Initial poll error:", err));

  pollerTimer = setInterval(() => {
    pollOnce().catch(err => console.error("[poller] Poll error:", err));
  }, POLL_INTERVAL_MS);
}

export function stopGlobalPoller() {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
}
