export const AZURE_VOICES = Object.freeze({
  en: { lang: "en-GB", voice: "en-GB-SoniaNeural" },
  hi: { lang: "hi-IN", voice: "hi-IN-SwaraNeural" },
  bn: { lang: "bn-IN", voice: "bn-IN-TanishaaNeural" },
  as: { lang: "as-IN", voice: "as-IN-YashicaNeural" },
  ta: { lang: "ta-IN", voice: "ta-IN-PallaviNeural" },
  te: { lang: "te-IN", voice: "te-IN-ShrutiNeural" },
  mr: { lang: "mr-IN", voice: "mr-IN-AarohiNeural" },
  kn: { lang: "kn-IN", voice: "kn-IN-SapnaNeural" },
  gu: { lang: "gu-IN", voice: "gu-IN-DhwaniNeural" },
  ml: { lang: "ml-IN", voice: "ml-IN-SobhanaNeural" },
  pa: { lang: "pa-IN", voice: "pa-IN-VaaniNeural" },
  or: { lang: "or-IN", voice: "or-IN-SubhasiniNeural" },
  ur: { lang: "ur-IN", voice: "ur-IN-GulNeural" },
  es: { lang: "es-ES", voice: "es-ES-ElviraNeural" },
  fr: { lang: "fr-FR", voice: "fr-FR-DeniseNeural" },
  de: { lang: "de-DE", voice: "de-DE-KatjaNeural" },
  it: { lang: "it-IT", voice: "it-IT-ElsaNeural" },
  "pt-PT": { lang: "pt-PT", voice: "pt-PT-RaquelNeural" }
});

export const MAX_SPEECH_CHARS = 3000;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function formatForSpeech(value) {
  return clean(value)
    .replace(/(\d)\s*[-–]\s*(\d)/g, "$1 to $2")
    .replace(/([A-Za-z])\/([A-Za-z])/g, "$1 per $2");
}

export function buildNarrationSections(report, labels = {}) {
  const statusLabel = status => labels[status] || status || labels.uninterpreted || "not interpreted";
  const overview = [report?.headline, report?.subline, ...(report?.meaning || [])].map(clean).filter(Boolean).join(". ");
  const findings = (report?.findings || []).map((finding, index) => {
    const parts = [
      `${index + 1}. ${finding.test || finding.originalTest || labels.result || "Result"}`,
      finding.value,
      finding.unit,
      finding.refRange ? `${labels.reference || "reference"} ${finding.refRange}` : "",
      statusLabel(finding.status),
      finding.explain || finding.meaningShort
    ];
    return formatForSpeech(parts.filter(Boolean).join(", "));
  });
  const questions = (report?.questions || []).map((question, index) => `${index + 1}. ${clean(question)}`);
  const disclaimer = clean(labels.disclaimer || "This explanation is informational and does not replace medical advice.");
  return [
    { key: "overview", title: labels.overview || "Overview", text: overview },
    { key: "findings", title: labels.findings || "Results", text: findings.join(". ") },
    { key: "questions", title: labels.questions || "Questions", text: questions.join(". ") },
    { key: "disclaimer", title: labels.disclaimerTitle || "Important information", text: disclaimer }
  ].filter(section => section.text);
}

export function splitNarrationSections(sections, maxChars = MAX_SPEECH_CHARS) {
  if (!Number.isInteger(maxChars) || maxChars < 100) throw new Error("Invalid speech segment limit");
  const chunks = [];
  for (const section of sections || []) {
    const sentences = clean(section.text).split(/(?<=[.!?।؟])\s+/u).filter(Boolean);
    let text = "";
    const push = () => { if (text) chunks.push({ key: section.key, title: section.title, text }); text = ""; };
    for (const sentence of sentences) {
      if (sentence.length > maxChars) {
        push();
        for (let start = 0; start < sentence.length; start += maxChars) chunks.push({ key: section.key, title: section.title, text: sentence.slice(start, start + maxChars) });
      } else if (!text || text.length + sentence.length + 1 <= maxChars) text += (text ? " " : "") + sentence;
      else { push(); text = sentence; }
    }
    push();
  }
  return chunks;
}

export function bestDeviceVoice(voices, locale) {
  const configured = AZURE_VOICES[locale];
  const full = (configured?.lang || locale).toLowerCase();
  const base = full.split("-")[0];
  return (voices || []).find(voice => voice.lang?.toLowerCase() === full)
    || (voices || []).find(voice => voice.lang?.toLowerCase().startsWith(base + "-"))
    || null;
}
