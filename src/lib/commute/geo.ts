// Geometria trasy — czysta, bez sieci. Wszystko w metrach na płaskim
// przybliżeniu (equirectangular): dla odcinków rzędu setek metrów błąd jest
// nieistotny, a nie ciągniemy biblioteki geodezyjnej do jednej odległości.
import type { LatLon } from "./types";

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Odległość punktu od odcinka a–b w metrach. */
export function distToSegmentM(p: LatLon, a: LatLon, b: LatLon): number {
  const k = Math.cos(rad(p.lat));
  const px = rad(p.lon) * k * R;
  const py = rad(p.lat) * R;
  const ax = rad(a.lon) * k * R;
  const ay = rad(a.lat) * R;
  const bx = rad(b.lon) * k * R;
  const by = rad(b.lat) * R;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Odległość punktu od łamanej w metrach (Infinity dla pustej). */
export function distToPolylineM(p: LatLon, line: readonly LatLon[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversineM(p, line[0]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    best = Math.min(best, distToSegmentM(p, line[i - 1], line[i]));
  }
  return best;
}

/** Czy którykolwiek z punktów leży w `withinM` metrów od łamanej. */
export function anyNearPolyline(
  pts: readonly LatLon[],
  line: readonly LatLon[],
  withinM: number,
): boolean {
  return pts.some((p) => distToPolylineM(p, line) <= withinM);
}

/** Zostawia najwyżej `max` punktów, równo rozłożonych; pierwszy i ostatni zawsze. */
export function decimate<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  return out;
}

/** Jaka część punktów `a` leży blisko łamanej `b` (0–1). */
export function overlapFraction(
  a: readonly LatLon[],
  b: readonly LatLon[],
  withinM: number,
): number {
  if (a.length === 0) return 0;
  const sample = decimate(a, 60);
  const near = sample.filter((p) => distToPolylineM(p, b) <= withinM).length;
  return near / sample.length;
}

export type Bbox = { minLat: number; minLon: number; maxLat: number; maxLon: number };

/** Pole prostokąta w km² (przybliżone). */
export function bboxAreaKm2(b: Bbox): number {
  const midLat = (b.minLat + b.maxLat) / 2;
  const h = (b.maxLat - b.minLat) * 111.2;
  const w = (b.maxLon - b.minLon) * 111.2 * Math.cos(rad(midLat));
  return h * w;
}

/** TomTom przyjmuje prostokąt do 10 000 km² — zostawiamy zapas. */
const MAX_BOX_KM2 = 8_000;
const MAX_BOXES = 6;

/**
 * Prostokąty, którymi odpytujemy o utrudnienia wzdłuż trasy.
 *
 * Jeden prostokąt obejmujący całą trasę, jeśli mieści się w limicie
 * dostawcy; inaczej kilka mniejszych wokół punktów próbkowanych wzdłuż niej
 * (najwyżej MAX_BOXES — dalsze odcinki i tak nie mieszczą się w „dojeździe").
 */
export function incidentBoxes(route: readonly LatLon[], padDeg = 0.01): Bbox[] {
  if (route.length === 0) return [];
  const lats = route.map((p) => p.lat);
  const lons = route.map((p) => p.lon);
  const whole: Bbox = {
    minLat: Math.min(...lats) - padDeg,
    maxLat: Math.max(...lats) + padDeg,
    minLon: Math.min(...lons) - padDeg,
    maxLon: Math.max(...lons) + padDeg,
  };
  if (bboxAreaKm2(whole) <= MAX_BOX_KM2) return [whole];
  const half = 0.05;
  return decimate(route, MAX_BOXES).map((p) => ({
    minLat: p.lat - half,
    maxLat: p.lat + half,
    minLon: p.lon - half * 1.5,
    maxLon: p.lon + half * 1.5,
  }));
}
