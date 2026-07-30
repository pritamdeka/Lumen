export const MEDICAL_OCR_PROMPT = "Extract only the visible medical findings from this document. Include every measurement, examination result, laboratory result, vaccination result, status, value, unit, and printed reference range. Exclude names, identifiers, contact details, barcodes, signatures, and dates unrelated to a result. Return one concise line per finding as: label | value | unit | printed range. Preserve visible wording and numbers exactly. Do not explain, summarize, diagnose, or add facts.";

function cleanCell(value) {
  return String(value || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
}

function numericMetadata(value, refRange) {
  const numberPattern = "-?\\d+(?:\\.\\d+)?";
  const valueMatch = String(value).replaceAll(",", "").match(new RegExp(`^[<>≤≥]?\\s*(${numberPattern})\\s*$`));
  const range = String(refRange).replaceAll(",", "").trim();
  const interval = range.match(new RegExp(`^(${numberPattern})\\s*[-–—]\\s*(${numberPattern})$`));
  const upper = range.match(new RegExp(`^(?:<|≤)\\s*(${numberPattern})$`));
  const lower = range.match(new RegExp(`^(?:>|≥)\\s*(${numberPattern})$`));
  return {
    numericValue: valueMatch ? Number(valueMatch[1]) : null,
    referenceLow: interval ? Number(interval[1]) : lower ? Number(lower[1]) : null,
    referenceHigh: interval ? Number(interval[2]) : upper ? Number(upper[1]) : null,
    referenceKind: interval ? "interval" : upper ? "upper" : lower ? "lower" : "text"
  };
}

export function parseMedicalOcr(text, sourcePage = 1) {
  const findings = [];
  for (const originalLine of String(text || "").split(/\r?\n/)) {
    let line = originalLine.trim();
    if (!line || /^```/.test(line) || /^[-:|\s]+$/.test(line)) continue;
    line = line.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "");
    if (line.startsWith("|")) line = line.slice(1);
    if (line.endsWith("|")) line = line.slice(0, -1);
    const cells = line.split("|").map(cleanCell);
    if (cells.length < 2) continue;
    const [test, value, unit = "", refRange = ""] = cells;
    if (!test || !value || /^(?:label|test|finding)$/i.test(test) && /^(?:value|result)$/i.test(value)) continue;
    findings.push({
      sourcePage,
      test,
      value,
      unit,
      refRange,
      ...numericMetadata(value, refRange),
      comparisonName: test,
      comparisonUnit: unit,
      confidence: "medium",
      sourceText: [test, value, unit, refRange].filter(Boolean).join(" | ").slice(0, 300)
    });
  }
  return findings;
}
