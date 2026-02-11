import { useEffect, useState } from "react";
import { RefreshCw, Plane, AlertCircle } from "@tabler/icons-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Plane {
  icao24: string;
  callsign: string | null;
  origin_country: string;
  latitude: number | null;
  longitude: number | null;
  baro_altitude: number | null;
  velocity: number | null;
  true_track: number | null;
  vertical_rate: number | null;
  on_ground: boolean;
}

interface ApiResponse {
  time: number;
  states: (string | number | boolean | null)[][] | null;
}

/**
 * Plane Tracker - Shows planes flying near your location using OpenSky Network API
 */
export default function PlaneTracker() {
  const [planes, setPlanes] = useState<Plane[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);

  // Get user location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          });
        },
        (err) => {
          console.error("Geolocation error:", err);
          // Use default location (central US) if geolocation fails
          setUserLocation({ lat: 39.8283, lon: -98.5795 });
        }
      );
    } else {
      setUserLocation({ lat: 39.8283, lon: -98.5795 });
    }
  }, []);

  const fetchPlanes = async () => {
    if (!userLocation) return;

    setLoading(true);
    setError(null);

    try {
      // Define bounding box around user's location (approximately 100km radius)
      const boxSize = 1.0; // ~100km
      const lamin = userLocation.lat - boxSize / 2;
      const lamax = userLocation.lat + boxSize / 2;
      const lomin = userLocation.lon - boxSize / 2;
      const lomax = userLocation.lon + boxSize / 2;

      const response = await fetch(
        `https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}&extended=1`
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data: ApiResponse = await response.json();

      if (data.states && data.states.length > 0) {
        const parsedPlanes: Plane[] = data.states
          .filter((state) => state[5] !== null && state[6] !== null) // Has position
          .map((state) => ({
            icao24: state[0] as string,
            callsign: state[1] as string | null,
            origin_country: state[2] as string,
            latitude: state[6] as number | null,
            longitude: state[5] as number | null,
            baro_altitude: state[7] as number | null,
            velocity: state[9] as number | null,
            true_track: state[10] as number | null,
            vertical_rate: state[11] as number | null,
            on_ground: state[8] as boolean,
          }));

        setPlanes(parsedPlanes);
        setLastUpdate(new Date());
      } else {
        setPlanes([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch plane data");
      setPlanes([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userLocation) {
      fetchPlanes();
      // Refresh every 30 seconds
      const interval = setInterval(fetchPlanes, 30000);
      return () => clearInterval(interval);
    }
  }, [userLocation]);

  const formatAltitude = (meters: number | null) => {
    if (meters === null) return "N/A";
    return `${Math.round(meters * 3.28084).toLocaleString()} ft`;
  };

  const formatSpeed = (metersPerSec: number | null) => {
    if (metersPerSec === null) return "N/A";
    return `${Math.round(metersPerSec * 1.94384)} kts`;
  };

  const getHeading = (degrees: number | null) => {
    if (degrees === null) return "—";
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const index = Math.round(degrees / 45) % 8;
    return directions[index];
  };

  const getVerticalStatus = (rate: number | null) => {
    if (rate === null || Math.abs(rate) < 0.5) return "LEVEL";
    return rate > 0 ? "CLIMB" : "DESCEND";
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 via-sky-50 to-background dark:from-sky-950 dark:via-sky-900 dark:to-background">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-sky-500 text-white">
              <Plane className="size-6" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                Plane Tracker
              </h1>
              <p className="text-sm text-muted-foreground">
                Real-time aircraft near your location
              </p>
            </div>
          </div>

          <Button
            onClick={fetchPlanes}
            disabled={loading}
            variant="outline"
            className="gap-2"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </header>

        <Card className="mb-8 bg-white/80 dark:bg-slate-900/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg">
              {loading ? "Scanning airspace..." : `Found ${planes.length} aircraft`}
            </CardTitle>
            {lastUpdate && (
              <CardDescription>
                Last updated: {lastUpdate.toLocaleTimeString()}
                {userLocation && (
                  <>
                    {" • Location: "}
                    {userLocation.lat.toFixed(4)}°, {userLocation.lon.toFixed(4)}°
                  </>
                )}
              </CardDescription>
            )}
          </CardHeader>
        </Card>

        {error && (
          <Card className="mb-8 border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="size-5 text-red-600 dark:text-red-400" />
                <div>
                  <p className="font-medium text-red-900 dark:text-red-300">
                    Unable to load plane data
                  </p>
                  <p className="text-sm text-red-700 dark:text-red-400">
                    {error}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!loading && planes.length === 0 && !error && (
          <Card className="mb-8">
            <CardContent className="pt-6 text-center text-muted-foreground">
              <Plane className="mx-auto mb-4 size-12 opacity-20" />
              <p className="text-lg font-medium">No planes detected nearby</p>
              <p className="text-sm">
                Planes will appear here when they enter your area
              </p>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {planes.map((plane) => (
            <Card
              key={plane.icao24}
              className="bg-white/80 dark:bg-slate-900/80 backdrop-blur hover:shadow-lg transition-shadow"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">
                      {plane.callsign || "Unknown"}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs">
                      {plane.icao24}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {plane.origin_country}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Altitude</p>
                    <p className="font-medium">
                      {formatAltitude(plane.baro_altitude)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Speed</p>
                    <p className="font-medium">
                      {formatSpeed(plane.velocity)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Heading</p>
                    <p className="font-medium">
                      {getHeading(plane.true_track)}{" "}
                      {plane.true_track && `(${Math.round(plane.true_track)}°)`}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Vertical</p>
                    <p
                      className={`font-medium ${
                        plane.vertical_rate && plane.vertical_rate > 0
                          ? "text-green-600 dark:text-green-400"
                          : plane.vertical_rate && plane.vertical_rate < 0
                          ? "text-orange-600 dark:text-orange-400"
                          : ""
                      }`}
                    >
                      {getVerticalStatus(plane.vertical_rate)}
                    </p>
                  </div>
                </div>

                {plane.latitude && plane.longitude && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground">Position</p>
                    <p className="font-mono text-xs">
                      {plane.latitude.toFixed(4)}°, {plane.longitude.toFixed(4)}°
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <footer className="mt-12 text-center text-xs text-muted-foreground">
          <p>
            Data provided by the OpenSky Network •
            <a
              href="https://opensky-network.org"
              target="_blank"
              rel="noopener noreferrer"
              className="mx-1 underline"
            >
              Learn more
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
