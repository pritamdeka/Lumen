import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrendSeries,
  comparisonKey,
  createReminderIcs,
  filterFindings,
  rangePosition,
  speechText,
  summarizeFindings
} from "../src/report-tools.js";

test("summarizes and filters findings without relying on colour", () => {
  const findings = [
    { status: "normal", confidence: "high", confirmed: true },
    { status: "high", confidence: "medium", confirmed: true },
    { status: "critical", confidence: "low", confirmed: false }
  ];
  assert.deepEqual(summarizeFindings(findings), { total: 3, normal: 1, attention: 1, critical: 1, uncertain: 2, confirmed: 2 });
  assert.equal(filterFindings(findings, "outside").length, 2);
  assert.equal(filterFindings(findings, "uncertain").length, 2);
  assert.equal(filterFindings(findings, "confirmed").length, 2);
});

test("creates range positions only from structured report ranges", () => {
  const interval = rangePosition({ numericValue: 15, referenceLow: 10, referenceHigh: 20, referenceKind: "interval" });
  assert.ok(interval.valuePct > interval.safeStartPct && interval.valuePct < interval.safeEndPct);
  assert.ok(rangePosition({ numericValue: 8, referenceHigh: 10, referenceKind: "upper" }));
  assert.ok(rangePosition({ numericValue: 12, referenceLow: 10, referenceKind: "lower" }));
  assert.equal(rangePosition({ value: "15", refRange: "10-20", referenceKind: "text" }), null);
  assert.equal(rangePosition({ numericValue: 15, referenceLow: 20, referenceHigh: 10, referenceKind: "interval" }), null);
});

test("trends require the same normalized test name and unit", () => {
  const current = { test: "Haemoglobin", unit: "g/dL" };
  const history = [
    { t: 2, report: { findings: [{ test: " haemoglobin ", unit: "G/DL", numericValue: 12 }] } },
    { t: 1, report: { findings: [{ test: "Haemoglobin", unit: "g/L", numericValue: 120 }] } },
    { t: 3, report: { findings: [{ test: "Haemoglobin", unit: "g/dL", numericValue: 13, referenceLow: null, referenceHigh: null }] } }
  ];
  assert.equal(comparisonKey(current), "haemoglobin::g dl");
  const series = buildTrendSeries(history, current);
  assert.deepEqual(series.map(point => point.value), [12, 13]);
  assert.equal(series[1].referenceLow, null);
});

test("calendar reminders escape user-controlled text", () => {
  const ics = createReminderIcs({ date: "2026-08-01", title: "Follow-up, clinic", description: "Line 1; check\\value\nLine 2" });
  assert.match(ics, /DTSTART;VALUE=DATE:20260801/);
  assert.match(ics, /SUMMARY:Follow-up\\, clinic/);
  assert.match(ics, /DESCRIPTION:Line 1\\; check\\\\value\\nLine 2/);
  assert.throws(() => createReminderIcs({ date: "01-08-2026", title: "x" }));
});

test("speech text includes explanation and visit questions", () => {
  assert.equal(speechText({ headline: "Summary", meaning: ["Meaning"], questions: ["Question"] }), "Summary. Meaning. Question");
});
