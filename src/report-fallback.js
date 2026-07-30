function text(value) {
  return typeof value === "string" ? value : "";
}

export function buildExplanationTimeoutReport(extraction, locale, labels = {}) {
  const source = extraction && typeof extraction === "object" ? extraction : {};
  const findings = Array.isArray(source.findings) ? source.findings : [];
  const uninterpreted = text(labels.uninterpreted);

  return {
    outputLocale: text(locale) || "en",
    isMedical: source.isMedical !== false,
    overall: "attention",
    headline: text(labels.report),
    subline: text(labels.analysisTimeout),
    reportType: text(source.reportType),
    findings: findings.map((finding, index) => ({
      ...finding,
      findingId: text(finding?.findingId) || `finding-${index + 1}`,
      sourceIndex: Number.isInteger(finding?.sourceIndex) ? finding.sourceIndex : index,
      originalTest: text(finding?.test),
      meaningShort: "",
      status: "uninterpreted",
      explain: uninterpreted,
      confirmed: finding?.confirmed === true
    })),
    meaning: [text(labels.analysisTimeout)].filter(Boolean),
    questions: [],
    lifestyle: [],
    glossary: [],
    urgencyTitle: text(labels.disclaimerTitle),
    urgencyNote: text(labels.disclaimerBody),
    totalFindings: findings.length,
    explainedFindings: 0,
    incompleteExplanations: findings.length,
    explanationTimedOut: true
  };
}
