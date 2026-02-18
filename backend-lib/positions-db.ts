import { Database } from "bun:sqlite";

const db = new Database("positions.db");

// WAL mode for better concurrent read/write performance
db.run("PRAGMA journal_mode=WAL");
db.run("PRAGMA synchronous=NORMAL");

db.run(`
  CREATE TABLE IF NOT EXISTS positions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    icao24    TEXT NOT NULL,
    callsign  TEXT,
    lat       REAL NOT NULL,
    lon       REAL NOT NULL,
    alt       REAL,
    speed     REAL,
    heading   REAL,
    vrate     REAL,
    squawk    TEXT,
    on_ground INTEGER,
    ts        INTEGER NOT NULL
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_positions_icao24 ON positions(icao24)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_positions_ts     ON positions(ts)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_positions_bbox   ON positions(lat, lon, ts)`);

export interface PositionRow {
  icao24: string;
  callsign: string | null;
  lat: number;
  lon: number;
  alt: number | null;
  speed: number | null;
  heading: number | null;
  vrate: number | null;
  squawk: string | null;
  on_ground: number | null;
  ts: number;
}

const insertStmt = db.prepare(`
  INSERT INTO positions (icao24, callsign, lat, lon, alt, speed, heading, vrate, squawk, on_ground, ts)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function insertPositions(positions: PositionRow[]) {
  const transaction = db.transaction(() => {
    for (const p of positions) {
      insertStmt.run(
        p.icao24,
        p.callsign,
        p.lat,
        p.lon,
        p.alt ?? null,
        p.speed ?? null,
        p.heading ?? null,
        p.vrate ?? null,
        p.squawk ?? null,
        p.on_ground ?? null,
        p.ts
      );
    }
  });
  transaction();
}

export function pruneOldPositions(maxAgeSeconds: number = 86400) {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  db.run("DELETE FROM positions WHERE ts < ?", [cutoff]);
}

export interface LivePlane {
  icao24: string;
  callsign: string | null;
  lat: number;
  lon: number;
  alt: number | null;
  speed: number | null;
  heading: number | null;
  vrate: number | null;
  squawk: string | null;
  on_ground: number | null;
  ts: number;
}

/**
 * Returns the latest known position for each aircraft within the bounding box,
 * seen within the last maxAgeSecs seconds.
 */
export function queryLatestInBbox(
  lamin: number,
  lamax: number,
  lomin: number,
  lomax: number,
  maxAgeSecs: number = 180
): LivePlane[] {
  const minTs = Math.floor(Date.now() / 1000) - maxAgeSecs;
  return db.query(`
    SELECT p.icao24, p.callsign, p.lat, p.lon, p.alt, p.speed, p.heading, p.vrate, p.squawk, p.on_ground, p.ts
    FROM positions p
    INNER JOIN (
      SELECT icao24, MAX(ts) as max_ts
      FROM positions
      WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND ts >= ?
      GROUP BY icao24
    ) latest ON p.icao24 = latest.icao24 AND p.ts = latest.max_ts
    ORDER BY p.icao24
  `).all(lamin, lamax, lomin, lomax, minTs) as LivePlane[];
}

export interface TrailPoint {
  lat: number;
  lon: number;
  alt: number | null;
  ts: number;
}

/**
 * Returns full position history for a single aircraft since sinceTs.
 * Defaults to the last 24 hours.
 */
export function queryTrail(icao24: string, sinceTs?: number): TrailPoint[] {
  const cutoff = sinceTs ?? Math.floor(Date.now() / 1000) - 86400;
  return db.query(`
    SELECT lat, lon, alt, ts
    FROM positions
    WHERE icao24 = ? AND ts >= ?
    ORDER BY ts ASC
  `).all(icao24, cutoff) as TrailPoint[];
}

export function getPositionsDbStats(): { rowCount: number; oldestTs: number | null } {
  const rowCount = (db.query("SELECT COUNT(*) as count FROM positions").get() as { count: number }).count;
  const oldest = db.query("SELECT MIN(ts) as ts FROM positions").get() as { ts: number | null };
  return { rowCount, oldestTs: oldest.ts };
}
