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

// ── OpenSky proxy with in-process cache ──────────────────────────────
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

  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}&extended=1`;
  const headers: Record<string, string> = {};

  const user = process.env.OPENSKY_USER;
  const pass = process.env.OPENSKY_PASS;
  if (user && pass) {
    headers["Authorization"] = "Basic " + btoa(`${user}:${pass}`);
  }

  try {
    const res = await fetch(url, { headers });

    if (res.status === 429) {
      return c.json({ error: "Rate limited" }, 429);
    }
    if (!res.ok) {
      return c.json({ error: `OpenSky error: ${res.status}` }, res.status as any);
    }

    const data = await res.json();
    proxyCache.set(cacheKey, { data, expires: Date.now() + PROXY_CACHE_TTL });
    return c.json(data);
  } catch (e) {
    return c.json({ error: "Failed to reach OpenSky" }, 502);
  }
});

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
