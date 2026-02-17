import { Database } from "bun:sqlite";

const db = new Database("sightings.db");

db.run(`
  CREATE TABLE IF NOT EXISTS sightings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    icao24 TEXT NOT NULL,
    callsign TEXT,
    origin_country TEXT,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    min_alt REAL,
    max_alt REAL,
    max_speed REAL,
    lat REAL,
    lon REAL
  )
`);
db.run(`CREATE INDEX IF NOT EXISTS idx_sightings_icao24 ON sightings(icao24)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_sightings_last_seen ON sightings(last_seen)`);

export interface PlaneInput {
  icao24: string;
  callsign?: string | null;
  origin_country?: string | null;
  alt?: number | null;
  vel?: number | null;
  lat?: number | null;
  lon?: number | null;
}

export interface Sighting {
  id: number;
  icao24: string;
  callsign: string | null;
  origin_country: string | null;
  first_seen: number;
  last_seen: number;
  min_alt: number | null;
  max_alt: number | null;
  max_speed: number | null;
  lat: number | null;
  lon: number | null;
}

const upsertStmt = db.prepare(`
  INSERT INTO sightings (icao24, callsign, origin_country, first_seen, last_seen, min_alt, max_alt, max_speed, lat, lon)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING
`);

const findByIcao = db.prepare(`
  SELECT id, min_alt, max_alt, max_speed FROM sightings
  WHERE icao24 = ? AND last_seen > ? ORDER BY last_seen DESC LIMIT 1
`);

const updateStmt = db.prepare(`
  UPDATE sightings SET last_seen = ?, callsign = COALESCE(?, callsign),
    min_alt = ?, max_alt = ?, max_speed = ?, lat = ?, lon = ?
  WHERE id = ?
`);

export function upsertSightings(planes: PlaneInput[]) {
  const now = Math.floor(Date.now() / 1000);
  // Consider a sighting "active" if seen in the last 10 minutes
  const staleThreshold = now - 600;

  const transaction = db.transaction(() => {
    for (const plane of planes) {
      const existing = findByIcao.get(plane.icao24, staleThreshold) as {
        id: number;
        min_alt: number | null;
        max_alt: number | null;
        max_speed: number | null;
      } | null;

      if (existing) {
        const minAlt = plane.alt != null
          ? (existing.min_alt != null ? Math.min(existing.min_alt, plane.alt) : plane.alt)
          : existing.min_alt;
        const maxAlt = plane.alt != null
          ? (existing.max_alt != null ? Math.max(existing.max_alt, plane.alt) : plane.alt)
          : existing.max_alt;
        const maxSpeed = plane.vel != null
          ? (existing.max_speed != null ? Math.max(existing.max_speed, plane.vel) : plane.vel)
          : existing.max_speed;

        updateStmt.run(
          now,
          (plane.callsign || '').trim() || null,
          minAlt,
          maxAlt,
          maxSpeed,
          plane.lat ?? null,
          plane.lon ?? null,
          existing.id
        );
      } else {
        upsertStmt.run(
          plane.icao24,
          (plane.callsign || '').trim() || null,
          plane.origin_country || null,
          now,
          now,
          plane.alt ?? null,
          plane.alt ?? null,
          plane.vel ?? null,
          plane.lat ?? null,
          plane.lon ?? null
        );
      }
    }
  });

  transaction();
}

export function getHistory(limit = 50, offset = 0): Sighting[] {
  return db
    .query(
      "SELECT * FROM sightings ORDER BY last_seen DESC LIMIT ? OFFSET ?"
    )
    .all(limit, offset) as Sighting[];
}

export function getStats() {
  const totalUnique = (
    db.query("SELECT COUNT(DISTINCT icao24) as count FROM sightings").get() as { count: number }
  ).count;

  const last24h = Math.floor(Date.now() / 1000) - 86400;
  const recentCount = (
    db.query("SELECT COUNT(DISTINCT icao24) as count FROM sightings WHERE last_seen > ?").get(last24h) as { count: number }
  ).count;

  const topCountries = db
    .query(
      "SELECT origin_country, COUNT(DISTINCT icao24) as count FROM sightings WHERE origin_country IS NOT NULL GROUP BY origin_country ORDER BY count DESC LIMIT 5"
    )
    .all() as { origin_country: string; count: number }[];

  return { totalUnique, recentCount, topCountries };
}
