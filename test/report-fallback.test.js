import test from "node:test";
import assert from "node:assert/strict";
import { buildExplanationTimeoutReport } from "../src/report-fallback.js";

const labels = {
  report: "Report",
  analysisTimeout: "The explanation is taking longer than expected.",
  uninterpreted: "Not interpreted — compare with your original report.",
  disclaimerTitle: "Lumen is not a doctor.",
  disclaimerBody: "Always consult a qualified clinician."
};

test("timeout fallback preserves every extracted value and its source order", () => {
  const extraction = {
    isMedical: true,
    reportType: "Blood test",
    findings: [
      { findingId: "finding-8", sourceIndex: 4, sourcePage: 2, test: "Hb", value: "12.5", unit: "g/dL", refRange: "12–16", numericValue: 12.5, referenceLow: 12, referenceHigh: 16, referenceKind: "interval", comparisonName: "Haemoglobin", comparisonUnit: "g/dL", confidence: "medium", sourceText: "Hb 12.5" },
      { findingId: "finding-9", sourceIndex: 5, sourcePage: 3, test: "TSH", value: "<0.1", unit: "mIU/L", refRange: "0.4–4.0", numericValue: 0.1, confidence: "low", sourceText: "TSH <0.1" }
    ]
  };

  const report = buildExplanationTimeoutReport(extraction, "en", labels);

  assert.equal(report.outputLocale, "en");
  assert.equal(report.reportType, "Blood test");
  assert.deepEqual(report.findings.map(item => item.findingId), ["finding-8", "finding-9"]);
  assert.deepEqual(report.findings.map(item => item.sourcePage), [2, 3]);
  assert.deepEqual(report.findings.map(item => item.value), ["12.5", "<0.1"]);
  assert.equal(report.findings[0].unit, "g/dL");
  assert.equal(report.findings[0].refRange, "12–16");
  assert.equal(report.findings[0].numericValue, 12.5);
  assert.equal(report.findings[0].referenceLow, 12);
  assert.equal(report.findings[0].referenceHigh, 16);
  assert.equal(report.findings[0].comparisonName, "Haemoglobin");
  assert.ok(report.findings.every(item => item.status === "uninterpreted"));
  assert.ok(report.findings.every(item => item.explain === labels.uninterpreted));
  assert.equal(report.totalFindings, 2);
  assert.equal(report.explainedFindings, 0);
  assert.equal(report.incompleteExplanations, 2);
  assert.equal(report.explanationTimedOut, true);
});

test("timeout fallback remains neutral and handles empty or incomplete extraction", () => {
  const report = buildExplanationTimeoutReport({ findings: [{ test: "Visible result", value: "7" }] }, "ur", labels);

  assert.equal(report.outputLocale, "ur");
  assert.equal(report.findings[0].findingId, "finding-1");
  assert.equal(report.findings[0].sourceIndex, 0);
  assert.equal(report.findings[0].originalTest, "Visible result");
  assert.deepEqual(report.questions, []);
  assert.deepEqual(report.lifestyle, []);
  assert.deepEqual(report.glossary, []);
  assert.deepEqual(report.meaning, [labels.analysisTimeout]);
  assert.equal(report.urgencyTitle, labels.disclaimerTitle);
  assert.equal(report.urgencyNote, labels.disclaimerBody);

  const empty = buildExplanationTimeoutReport(null, "", labels);
  assert.equal(empty.outputLocale, "en");
  assert.deepEqual(empty.findings, []);
  assert.equal(empty.totalFindings, 0);
});
