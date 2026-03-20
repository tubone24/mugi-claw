import { readFile } from "node:fs/promises";

// Timeline.json の型定義
interface VisitEntry {
  hierarchyLevel: number;
  probability: number;
  topCandidate: {
    placeId: string;
    semanticType: string;
    probability: number;
    placeLocation: {
      latLng: string;
    };
  };
}

interface SemanticSegment {
  startTime: string;
  endTime: string;
  startTimeTimezoneUtcOffsetMinutes?: number;
  endTimeTimezoneUtcOffsetMinutes?: number;
  visit?: VisitEntry;
  activity?: unknown;
  timelinePath?: unknown[];
}

interface TimelineJson {
  semanticSegments: SemanticSegment[];
}

export interface WorkVisit {
  date: string;         // YYYY-MM-DD
  startTime: string;    // HH:MM
  endTime: string;      // HH:MM
  duration: number;     // 滞在時間（分）
  placeId: string;
  semanticType: string;
  lat: number;
  lng: number;
}

export interface AttendanceOptions {
  month: string;           // YYYY-MM
  workLat?: number;
  workLng?: number;
  radiusMeters: number;
}

// "35.559786°, 139.5399374°" → [35.559786, 139.5399374]
function parseLatLng(latLng: string): [number, number] | null {
  const match = latLng.match(/([-\d.]+)°,\s*([-\d.]+)°/);
  if (!match) return null;
  return [parseFloat(match[1]), parseFloat(match[2])];
}

// 2点間の距離をメートルで計算（Haversine公式）
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// ISO文字列から日付とHH:MM時刻を取得（タイムゾーン考慮）
function parseDateTime(isoStr: string): { date: string; time: string } {
  // "2026-02-24T08:06:04.000+09:00" のような形式
  // タイムゾーンオフセットを含む場合はそのまま使う
  const match = isoStr.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return { date: "", time: "" };
  return {
    date: match[1],
    time: `${match[2]}:${match[3]}`,
  };
}

const WORK_SEMANTIC_TYPES = new Set(["TYPE_WORK", "INFERRED_WORK"]);

export async function analyzeTimeline(
  filePath: string,
  opts: AttendanceOptions
): Promise<WorkVisit[]> {
  const raw = await readFile(filePath, "utf-8");
  const data: TimelineJson = JSON.parse(raw);

  const [targetYear, targetMonth] = opts.month.split("-").map(Number);

  const workVisits: WorkVisit[] = [];

  for (const segment of data.semanticSegments) {
    if (!segment.visit) continue;

    const { date, time: startTime } = parseDateTime(segment.startTime);
    const { time: endTime } = parseDateTime(segment.endTime);

    if (!date) continue;

    // 月フィルタ
    const [year, month] = date.split("-").map(Number);
    if (year !== targetYear || month !== targetMonth) continue;

    const candidate = segment.visit.topCandidate;
    const coords = parseLatLng(candidate.placeLocation.latLng);
    if (!coords) continue;
    const [lat, lng] = coords;

    // 職場判定
    let isWork = false;

    // 1. semanticType による判定
    if (WORK_SEMANTIC_TYPES.has(candidate.semanticType)) {
      isWork = true;
    }

    // 2. 座標による判定
    if (!isWork && opts.workLat !== undefined && opts.workLng !== undefined) {
      const dist = distanceMeters(lat, lng, opts.workLat, opts.workLng);
      if (dist <= opts.radiusMeters) {
        isWork = true;
      }
    }

    if (!isWork) continue;

    // 滞在時間（分）
    const start = new Date(segment.startTime);
    const end = new Date(segment.endTime);
    const duration = Math.round((end.getTime() - start.getTime()) / 60000);

    workVisits.push({
      date,
      startTime,
      endTime,
      duration,
      placeId: candidate.placeId,
      semanticType: candidate.semanticType,
      lat,
      lng,
    });
  }

  // 日付・時刻順にソート
  workVisits.sort((a, b) =>
    a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)
  );

  return workVisits;
}

// 1日1回に集約
export function groupByDate(visits: WorkVisit[]): Map<string, WorkVisit[]> {
  const map = new Map<string, WorkVisit[]>();
  for (const v of visits) {
    const existing = map.get(v.date) ?? [];
    existing.push(v);
    map.set(v.date, existing);
  }
  return map;
}
