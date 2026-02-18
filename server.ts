import { serveStatic } from "hono/bun";
import type { ViteDevServer } from "vite";
import { createServer as createViteServer } from "vite";
import config from "./zosite.json";
import { Hono } from "hono";

// AI agents: read README.md for navigation and contribution guidance.
type Mode = "development" | "production";
const app = new Hono();

const mode: Mode =
  process.env.NODE_ENV === "production" ? "production" : "development";

/**
 * Add any API routes here.
 */

import { upsertSightings, getHistory, getStats, getAllHistory } from "./backend-lib/sightings-db";

// ── Plane API proxy with in-process cache ──────────────────────────────
const proxyCache = new Map<string, { data: any; expires: number }>();
const PROXY_CACHE_TTL = 30_000; // 30 seconds

app.get("/api/planes", async (c) => {
  const lamin = c.req.query("lamin");
  const lamax = c.req.query("lamax");
  const lomin = c.req.query("lomin");
  const lomax = c.req.query("lomax");

  if (!lamin || !lamax || !lomin || !lomax) {
    return c.json({ error: "lamin/lamax/lomin/lomax required" }, 400);
  }

  const cacheKey = `${lamin},${lamax},${lomin},${lomax}`;
  const cached = proxyCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return c.json(cached.data);
  }

  // Calculate center point and radius from bounding box
  const lat = (parseFloat(lamin) + parseFloat(lamax)) / 2;
  const lon = (parseFloat(lomin) + parseFloat(lomax)) / 2;
  // Approximate radius in nautical miles (~1 degree = 60 nm)
  const radius = Math.max(
    parseFloat(lamax) - parseFloat(lamin),
    parseFloat(lomax) - parseFloat(lomin)
  ) * 30; // half the box diagonal approx

  const url = `https://api.adsb.lol/v2/point/${lat}/${lon}/${Math.min(Math.round(radius), 250)}`;

  try {
    const res = await fetch(url);

    if (!res.ok) {
      return c.json({ error: `API error: ${res.status}` }, res.status as any);
    }

    const data = await res.json();
    
    // Transform adsb.lol format to OpenSky format for backward compatibility
    const states = (data.ac || []).map((ac: any) => [
      ac.hex,                    // 0: icao24
      ac.flight?.trim() || null, // 1: callsign
      getCountryFromHex(ac.hex), // 2: origin_country (derived from hex)
      null,                      // 3: time_position
      null,                      // 4: last_contact
      ac.lon,                    // 5: longitude
      ac.lat,                    // 6: latitude
      ac.alt_baro,               // 7: baro_altitude
      ac.alt_baro === 0 || ac.gs < 5, // 8: on_ground (heuristic)
      ac.gs,                     // 9: velocity
      ac.track,                  // 10: true_track
      ac.baro_rate ?? ac.geom_rate, // 11: vertical_rate
      null,                      // 12: sensors
      ac.alt_geom,               // 13: geo_altitude
      ac.squawk,                 // 14: squawk
      ac.spi,                    // 15: spi
      null,                      // 16: position_source
      ac.category,               // 17: category
    ]);

    const result = { states };
    proxyCache.set(cacheKey, { data: result, expires: Date.now() + PROXY_CACHE_TTL });
    return c.json(result);
  } catch (e) {
    return c.json({ error: "Failed to reach aircraft API" }, 502);
  }
});

// Helper to derive country from ICAO24 hex code
function getCountryFromHex(hex: string): string {
  if (!hex) return "Unknown";
  const prefix = hex.slice(0, 2).toUpperCase();
  const countryMap: Record<string, string> = {
    "A0": "United States", "A1": "United States", "A2": "United States", "A3": "United States", "A4": "United States", "A5": "United States", "A6": "United States", "A7": "United States", "A8": "United States", "A9": "United States", "AA": "United States", "AB": "United States", "AC": "United States", "AD": "United States", "AE": "United States", "AF": "United States",
    "C0": "Canada", "C1": "Canada", "C2": "Canada", "C3": "Canada", "C4": "Canada", "C5": "Canada", "C6": "Canada", "C7": "Canada", "C8": "Canada", "C9": "Canada", "CA": "Canada", "CB": "Canada", "CC": "Canada", "CD": "Canada", "CE": "Canada", "CF": "Canada",
    "E0": "Argentina", "E1": "Argentina", "E2": "Argentina", "E3": "Argentina",
    "E4": "Brazil", "E5": "Brazil", "E6": "Brazil", "E7": "Brazil",
    "E8": "Mexico",
    "E9": "Venezuela",
    "EA": "Ecuador", "EB": "Ecuador",
    "EC": "Colombia", "ED": "Colombia",
    "EE": "Peru", "EF": "Peru",
    "F0": "Germany", "F1": "Germany", "F2": "Germany", "F3": "Germany",
    "40": "United Kingdom", "41": "United Kingdom", "42": "United Kingdom", "43": "United Kingdom",
    "44": "United Kingdom", "45": "United Kingdom", "46": "United Kingdom", "47": "United Kingdom",
    "48": "United Kingdom", "49": "United Kingdom", "4A": "United Kingdom", "4B": "United Kingdom",
    "4C": "United Kingdom", "4D": "United Kingdom", "4E": "United Kingdom", "4F": "United Kingdom",
    "50": "Belgium", "51": "Belgium",
    "52": "France", "53": "France", "54": "France", "55": "France", "56": "France", "57": "France",
    "58": "Spain", "59": "Spain", "5A": "Spain", "5B": "Spain", "5C": "Spain", "5D": "Spain", "5E": "Spain", "5F": "Spain",
    "3C": "France", "3D": "France",
    "3E": "Germany", "3F": "Germany",
    "3B": "France",
    "3A": "Italy",
    "39": "Italy",
    "38": "Switzerland",
    "4B": "Switzerland",
    "45": "Denmark",
    "46": "Sweden",
    "47": "Norway",
    "48": "Finland",
    "48": "Poland",
    "7C": "Australia",
    "7D": "Australia",
    "7E": "Australia",
    "7F": "Australia",
    "80": "China", "81": "China", "82": "China", "83": "China", "84": "China", "85": "China", "86": "China", "87": "China",
    "88": "Taiwan",
    "89": "Japan", "8A": "Japan", "8B": "Japan", "8C": "Japan", "8D": "Japan", "8E": "Japan", "8F": "Japan",
    "90": "India", "91": "India", "92": "India", "93": "India", "94": "India", "95": "India", "96": "India", "97": "India",
    "76": "Malaysia", "77": "Malaysia",
    "78": "China",
    "A0": "South Africa",
  };
  return countryMap[prefix] || "Unknown";
}

// ── CSV export ───────────────────────────────────────────────────────
app.get("/api/history/csv", (c) => {
  const rows = getAllHistory();
  const header = "icao24,callsign,origin_country,first_seen,last_seen,min_alt,max_alt,max_speed,lat,lon";
  const csvRows = rows.map((r) => {
    const cs = (r.callsign || "").replace(/"/g, '""');
    const oc = (r.origin_country || "").replace(/"/g, '""');
    return [
      r.icao24,
      `"${cs}"`,
      `"${oc}"`,
      r.first_seen,
      r.last_seen,
      r.min_alt ?? "",
      r.max_alt ?? "",
      r.max_speed ?? "",
      r.lat ?? "",
      r.lon ?? "",
    ].join(",");
  });
  const csv = header + "\n" + csvRows.join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="sightings.csv"',
    },
  });
});

app.post("/api/sightings", async (c) => {
  try {
    const body = await c.req.json();
    if (!body.planes || !Array.isArray(body.planes)) {
      return c.json({ error: "planes array required" }, 400);
    }
    upsertSightings(body.planes);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: "Failed to log sightings" }, 500);
  }
});

app.get("/api/history", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 200);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const history = getHistory(limit, offset);
  return c.json({ history });
});

app.get("/api/stats", (c) => {
  const stats = getStats();
  return c.json(stats);
});

if (mode === "production") {
  configureProduction(app);
} else {
  await configureDevelopment(app);
}

/**
 * Determine port based on mode. In production, use the published_port if available.
 * In development, always use the local_port.
 * Ports are managed by the system and injected via the PORT environment variable.
 */
const port = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : mode === "production"
    ? (config.publish?.published_port ?? config.local_port)
    : config.local_port;

export default { fetch: app.fetch, port, idleTimeout: 255 };

/**
 * Configure routing for production builds.
 *
 * - Streams prebuilt assets from `dist`.
 * - Static files from `public/` are copied to `dist/` by Vite and served at root paths.
 * - Falls back to `index.html` for any other GET so the SPA router can resolve the request.
 */
function configureProduction(app: Hono) {
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 302));
  app.use(async (c, next) => {
    if (c.req.method !== "GET") return next();

    const path = c.req.path;
    if (path.startsWith("/api/") || path.startsWith("/assets/")) return next();

    const file = Bun.file(`./dist${path}`);
    if (await file.exists()) {
      const stat = await file.stat();
      if (stat && !stat.isDirectory()) {
        return new Response(file);
      }
    }

    return serveStatic({ path: "./dist/index.html" })(c, next);
  });
}

/**
 * Configure routing for development builds.
 *
 * - Boots Vite in middleware mode for transforms.
 * - Static files from `public/` are served at root paths (matching Vite convention).
 * - Mirrors production routing semantics so SPA routes behave consistently.
 */
async function configureDevelopment(app: Hono): Promise<ViteDevServer> {
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
  });

  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    if (c.req.path === "/favicon.ico") return c.redirect("/favicon.svg", 302);

    const url = c.req.path;
    try {
      if (url === "/" || url === "/index.html") {
        let template = await Bun.file("./index.html").text();
        template = await vite.transformIndexHtml(url, template);
        return c.html(template, {
          headers: { "Cache-Control": "no-store, must-revalidate" },
        });
      }

      const publicFile = Bun.file(`./public${url}`);
      if (await publicFile.exists()) {
        const stat = await publicFile.stat();
        if (stat && !stat.isDirectory()) {
          return new Response(publicFile, {
            headers: { "Cache-Control": "no-store, must-revalidate" },
          });
        }
      }

      let result;
      try {
        result = await vite.transformRequest(url);
      } catch {
        result = null;
      }

      if (result) {
        return new Response(result.code, {
          headers: {
            "Content-Type": "application/javascript",
            "Cache-Control": "no-store, must-revalidate",
          },
        });
      }

      let template = await Bun.file("./index.html").text();
      template = await vite.transformIndexHtml("/", template);
      return c.html(template, {
        headers: { "Cache-Control": "no-store, must-revalidate" },
      });
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      console.error(error);
      return c.text("Internal Server Error", 500);
    }
  });

  return vite;
}
