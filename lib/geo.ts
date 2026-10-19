// Geohash cells -> the nearest US metro, so the evidence pack can say "Los Angeles", not "9q5c".

const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function decodeGeohash(h: string): { lat: number; lng: number } {
  let even = true;
  const lat = [-90, 90], lng = [-180, 180];
  for (const c of h.toLowerCase()) {
    const v = B32.indexOf(c);
    for (let bit = 4; bit >= 0; bit--) {
      const r = even ? lng : lat;
      const mid = (r[0] + r[1]) / 2;
      if ((v >> bit) & 1) r[0] = mid; else r[1] = mid;
      even = !even;
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lng: (lng[0] + lng[1]) / 2 };
}

export const METROS: [string, number, number][] = [
  ["New York", 40.71, -74.0], ["Los Angeles", 34.05, -118.24], ["Chicago", 41.88, -87.63],
  ["Houston", 29.76, -95.37], ["Phoenix", 33.45, -112.07], ["Philadelphia", 39.95, -75.17],
  ["San Antonio", 29.42, -98.49], ["San Diego", 32.72, -117.16], ["Dallas", 32.78, -96.8],
  ["Austin", 30.27, -97.74], ["San Jose", 37.34, -121.89], ["San Francisco", 37.77, -122.42],
  ["Oakland", 37.8, -122.27], ["Seattle", 47.61, -122.33], ["Portland", 45.52, -122.68],
  ["Denver", 39.74, -104.99], ["Washington DC", 38.91, -77.04], ["Boston", 42.36, -71.06],
  ["Nashville", 36.16, -86.78], ["Atlanta", 33.75, -84.39], ["Miami", 25.76, -80.19],
  ["Orlando", 28.54, -81.38], ["Tampa", 27.95, -82.46], ["Detroit", 42.33, -83.05],
  ["Minneapolis", 44.98, -93.27], ["St. Louis", 38.63, -90.2], ["Kansas City", 39.1, -94.58],
  ["New Orleans", 29.95, -90.07], ["Las Vegas", 36.17, -115.14], ["Salt Lake City", 40.76, -111.89],
  ["Charlotte", 35.23, -80.84], ["Raleigh", 35.78, -78.64], ["Pittsburgh", 40.44, -79.99],
  ["Baltimore", 39.29, -76.61], ["Columbus", 39.96, -83.0], ["Cleveland", 41.5, -81.69],
  ["Cincinnati", 39.1, -84.51], ["Indianapolis", 39.77, -86.16], ["Milwaukee", 43.04, -87.91],
  ["Sacramento", 38.58, -121.49], ["Honolulu", 21.31, -157.86], ["Brooklyn", 40.68, -73.94],
  ["Long Beach", 33.77, -118.19], ["Anaheim", 33.84, -117.91], ["Riverside", 33.95, -117.4],
  ["Albuquerque", 35.08, -106.65], ["Tucson", 32.22, -110.97], ["Richmond", 37.54, -77.44],
  ["Providence", 41.82, -71.41], ["Buffalo", 42.89, -78.88],
  // Latin and border markets (19 Oct): Bad Bunny's strongest cells are all in Puerto Rico, the DR and the Texas border,
  // and without these they fell through to "out in the country".
  ["San Juan", 18.47, -66.11], ["Ponce", 18.01, -66.61], ["Mayagüez", 18.2, -67.14], ["Punta Cana", 18.58, -68.4],
  ["El Paso", 31.76, -106.49], ["Laredo", 27.53, -99.49], ["McAllen", 26.2, -98.23],
];

/** Country for a metro, for the Clearance agent's sending rules. */
export const METRO_COUNTRY: Record<string, string> = { "Punta Cana": "DO" };
export const countryOfMetro = (m: string) => METRO_COUNTRY[m] ?? "US";

function km(a: { lat: number; lng: number }, lat: number, lng: number) {
  const r = Math.PI / 180;
  const x = (lng - a.lng) * r * Math.cos(((lat + a.lat) / 2) * r);
  const y = (lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

/** Nearest metro within 80 km, or null for cells out in the country. */
export function metroOf(geohash: string): string | null {
  const p = decodeGeohash(geohash);
  let best: string | null = null, bestKm = 80;
  for (const [name, lat, lng] of METROS) {
    const d = km(p, lat, lng);
    if (d < bestKm) { best = name; bestKm = d; }
  }
  return best;
}

/** The nearest metro at any distance (for rooms already known to sit near one). */
export function nearestMetro(lat: number, lng: number): string | null {
  let best: string | null = null, bestKm = Infinity;
  for (const [name, mlat, mlng] of METROS) {
    const d = km({ lat, lng }, mlat, mlng);
    if (d < bestKm) { best = name; bestKm = d; }
  }
  return best;
}

/** Distinct metros for a list of cells, in the order the cells came. */
export function metros(cells: string[]): string[] {
  return [...new Set(cells.map(metroOf).filter((m): m is string => !!m))];
}
