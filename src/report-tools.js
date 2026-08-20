const SAFE_STATUSES = new Set(["normal", "low", "high", "borderline", "critical"]);
const SAFE_CONFIDENCE = new Set(["high", "medium", "low"]);

export function normalizeComparisonToken(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function comparisonKey(finding) {
  const name = normalizeComparisonToken(finding?.comparisonName || finding?.test);
  const unit = normalizeComparisonToken(finding?.comparisonUnit || finding?.unit);
  return name && unit ? `${name}::${unit}` : "";
}

export function statusGroup(status) {
  const safe = SAFE_STATUSES.has(status) ? status : "borderline";
  if (safe === "normal") return "normal";
  if (safe === "critical") return "critical";
  return "attention";
}

export function summarizeFindings(findings = []) {
  return findings.reduce((summary, finding) => {
    summary.total++;
    summary[statusGroup(finding?.status)]++;
    if (finding?.confidence && finding.confidence !== "high") summary.uncertain++;
    if (finding?.confirmed === true) summary.confirmed++;
    return summary;
  }, { total: 0, normal: 0, attention: 0, critical: 0, uncertain: 0, confirmed: 0 });
}

export function filterFindings(findings = [], filter = "all") {
  if (filter === "outside") return findings.filter(finding => statusGroup(finding?.status) !== "normal");
  if (filter === "uncertain") return findings.filter(finding => SAFE_CONFIDENCE.has(finding?.confidence) && finding.confidence !== "high");
  if (filter === "confirmed") return findings.filter(finding => finding?.confirmed === true);
  return findings;
}

export function rangePosition(finding) {
  const value = Number(finding?.numericValue);
  const low = finding?.referenceLow === null || finding?.referenceLow === undefined ? null : Number(finding.referenceLow);
  const high = finding?.referenceHigh === null || finding?.referenceHigh === undefined ? null : Number(finding.referenceHigh);
  const kind = ["interval", "upper", "lower"].includes(finding?.referenceKind) ? finding.referenceKind : "text";
  if (!Number.isFinite(value)) return null;
  let min; let max; let safeLow; let safeHigh;
  if (kind === "interval" && Number.isFinite(low) && Number.isFinite(high) && high > low) {
    const span = high - low; min = low - span * .35; max = high + span * .35; safeLow = low; safeHigh = high;
  } else if (kind === "upper" && Number.isFinite(high)) {
    min = Math.min(0, high - Math.abs(high || 1) * .5); max = high + Math.abs(high || 1) * .5; safeLow = min; safeHigh = high;
  } else if (kind === "lower" && Number.isFinite(low)) {
    min = Math.min(0, low - Math.abs(low || 1) * .5); max = low + Math.abs(low || 1) * .5; safeLow = low; safeHigh = max;
  } else return null;
  min = Math.min(min, value); max = Math.max(max, value);
  if (!(max > min)) return null;
  const pct = number => Math.max(0, Math.min(100, ((number - min) / (max - min)) * 100));
  return { value, low, high, kind, valuePct: pct(value), safeStartPct: pct(safeLow), safeEndPct: pct(safeHigh) };
}

export function buildTrendSeries(history = [], finding) {
  const key = comparisonKey(finding);
  if (!key) return [];
  return history.flatMap(item => {
    const match = item?.report?.findings?.find(candidate => comparisonKey(candidate) === key);
    const value = Number(match?.numericValue);
    const referenceLow = match?.referenceLow === null || match?.referenceLow === undefined ? null : Number(match.referenceLow);
    const referenceHigh = match?.referenceHigh === null || match?.referenceHigh === undefined ? null : Number(match.referenceHigh);
    return match && Number.isFinite(value) ? [{
      time: Number(item.t) || 0,
      value,
      unit: match.unit || finding.unit || "",
      referenceLow: Number.isFinite(referenceLow) ? referenceLow : null,
      referenceHigh: Number.isFinite(referenceHigh) ? referenceHigh : null
    }] : [];
  }).sort((a, b) => a.time - b.time);
}

function icsEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function createReminderIcs({ date, title, description = "" }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("Invalid reminder date");
  const stamp = String(date).replaceAll("-", "");
  const uid = `spasht-${stamp}-${Math.random().toString(36).slice(2)}@local`;
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Spasht//Follow-up reminder//EN", "BEGIN:VEVENT",
    `UID:${uid}`, `DTSTART;VALUE=DATE:${stamp}`, `SUMMARY:${icsEscape(title)}`, `DESCRIPTION:${icsEscape(description)}`,
    "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

export function speechText(report) {
  return [report?.headline, report?.subline, ...(report?.meaning || []), ...(report?.questions || [])].filter(Boolean).join(". ");
}
