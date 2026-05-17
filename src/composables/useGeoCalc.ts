// WGS-84 ellipsoid constants
const A = 6378137.0          // semi-major axis (m)
const B = 6356752.314245     // semi-minor axis (m)
const F = 1 / 298.257223563  // flattening

function toRad(deg: number) { return (deg * Math.PI) / 180 }
function toDeg(rad: number) { return (rad * 180) / Math.PI }

/**
 * Haversine distance (spherical approximation, ~0.3% error).
 * Returns kilometers.
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Vincenty inverse formula (ellipsoidal, <0.5mm accuracy).
 * Returns distance in kilometers, or falls back to haversine.
 */
export function vincentyKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (Math.abs(lat1 - lat2) < 1e-12 && Math.abs(lng1 - lng2) < 1e-12) return 0

  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const L = toRad(lng2 - lng1)

  // Reduced latitudes
  const U1 = Math.atan((1 - F) * Math.tan(phi1))
  const U2 = Math.atan((1 - F) * Math.tan(phi2))

  let lambda = L
  let lambdaP: number
  const maxIter = 100
  const epsilon = 1e-12

  let sinSigma = 0, cosSigma = 0, sigma = 0
  let sinAlpha = 0, cos2Alpha = 0, cos2SigmaM = 0

  for (let i = 0; i < maxIter; i++) {
    const sinLambda = Math.sin(lambda)
    const cosLambda = Math.cos(lambda)
    sinSigma = Math.sqrt(
      (Math.cos(U2) * sinLambda) ** 2
      + (Math.cos(U1) * Math.sin(U2) - Math.sin(U1) * Math.cos(U2) * cosLambda) ** 2,
    )
    if (sinSigma < 1e-12) return 0 // coincident points

    cosSigma = Math.sin(U1) * Math.sin(U2) + Math.cos(U1) * Math.cos(U2) * cosLambda
    sigma = Math.atan2(sinSigma, cosSigma)
    sinAlpha = (Math.cos(U1) * Math.cos(U2) * sinLambda) / sinSigma
    cos2Alpha = 1 - sinAlpha * sinAlpha
    cos2SigmaM = cosSigma - (2 * Math.sin(U1) * Math.sin(U2)) / cos2Alpha
    if (isNaN(cos2SigmaM)) cos2SigmaM = 0 // equatorial line

    const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha))
    lambdaP = lambda
    lambda = L + (1 - C) * F * sinAlpha
      * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)))

    if (Math.abs(lambda - lambdaP) < epsilon) break
    if (i === maxIter - 1) return haversineKm(lat1, lng1, lat2, lng2) // antipodal fallback
  }

  const u2 = cos2Alpha * ((A * A - B * B) / (B * B))
  const k1 = (Math.sqrt(1 + u2) - 1) / (Math.sqrt(1 + u2) + 1)
  const A_coeff = (1 + 0.25 * k1 * k1) / (1 - k1)
  const B_coeff = k1 * (1 - 0.375 * k1 * k1)

  const deltaSigma = B_coeff * sinSigma
    * (cos2SigmaM + (B_coeff / 4)
      * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)
        - (B_coeff / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)))

  const s = B * A_coeff * (sigma - deltaSigma)
  return s / 1000
}

/**
 * Initial bearing (forward azimuth) from point 1 to point 2.
 * Returns degrees (0-360, 0=North, 90=East).
 */
export function initialBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const dL = toRad(lng2 - lng1)

  const y = Math.sin(dL) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dL)
  const deg = toDeg(Math.atan2(y, x))
  return (deg + 360) % 360
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export function bearingToCardinal(deg: number): string {
  const idx = Math.round(deg / 45) % 8
  return CARDINALS[idx]
}
