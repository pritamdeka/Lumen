import test from "node:test";
import assert from "node:assert/strict";
import { MEDICAL_OCR_PROMPT, parseMedicalOcr } from "../src/ocr.js";

test("medical OCR prompt excludes identity data and requires exact delimited findings", () => {
  assert.match(MEDICAL_OCR_PROMPT, /Exclude names, identifiers/);
  assert.match(MEDICAL_OCR_PROMPT, /label \| value \| unit \| printed range/);
  assert.match(MEDICAL_OCR_PROMPT, /Do not explain/);
});

test("parses plain, numbered, bulleted, and Markdown-table OCR rows", () => {
  const findings = parseMedicalOcr([
    "label | value | unit | printed range",
    "R.B.S | 96.0 | mg/dL | 70-140",
    "2. Creatinine | 0.3 | mg/dL | 0.5-1.2",
    "- Haemoglobin | 13.6 | g/dL |",
    "| Blood group | B+ | | |",
    "|---|---|---|---|",
    "This is explanatory prose without delimiters."
  ].join("\n"), 2);

  assert.equal(findings.length, 4);
  assert.deepEqual(findings.map(finding => finding.test), ["R.B.S", "Creatinine", "Haemoglobin", "Blood group"]);
  assert.deepEqual(findings.map(finding => finding.value), ["96.0", "0.3", "13.6", "B+"]);
  assert.equal(findings[0].numericValue, 96);
  assert.equal(findings[0].referenceLow, 70);
  assert.equal(findings[0].referenceHigh, 140);
  assert.equal(findings[0].referenceKind, "interval");
  assert.equal(findings[3].numericValue, null);
  assert.ok(findings.every(finding => finding.sourcePage === 2));
  assert.ok(findings.every(finding => finding.confidence === "medium"));
});

test("rejects empty, header-only, prose, and malformed OCR", () => {
  assert.deepEqual(parseMedicalOcr(""), []);
  assert.deepEqual(parseMedicalOcr("label | value\nNo medical findings visible."), []);
  assert.deepEqual(parseMedicalOcr("||||\n```"), []);
});
