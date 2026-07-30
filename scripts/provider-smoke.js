import { buildExtractionPrompt, buildPrompt, parseExtraction, parseModelObject, parseReport, runProviderFallback } from "../api/analyze.js";
import { getConfiguredProviders } from "../api/providers.js";

// A transparent 1x1 PNG verifies the multimodal route without sending report data.
const SAFE_TEST_IMAGE = {
  mime: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
};

const providers = getConfiguredProviders();
if (providers.length === 0) {
  console.error("No provider keys are configured. Export at least one analysis provider key before running this smoke test.");
  process.exitCode = 1;
} else {
  let failures = 0;
  for (const provider of providers) {
    let stage = "extraction";
    try {
      const extractionStartedAt = Date.now();
      const extraction = await runProviderFallback([provider], {
        prompt: buildExtractionPrompt(),
        images: [SAFE_TEST_IMAGE],
        maxOutputTokens: 16_384
      }, {
        accept(extractionOutput) {
          try {
            return parseExtraction(extractionOutput);
          } catch (error) {
            const value = parseModelObject(extractionOutput);
            const keys = Object.keys(value).sort().join(",") || "none";
            throw new Error(`invalid extraction shape (keys: ${keys}; findings array: ${Array.isArray(value.findings)})`, { cause: error });
          }
        }
      });
      const extractionMs = Date.now() - extractionStartedAt;

      stage = "explanation";
      const explanationStartedAt = Date.now();
      await runProviderFallback([provider], {
        prompt: buildPrompt("en", extraction),
        images: [],
        maxOutputTokens: 3_000
      }, {
        accept: explanationOutput => parseReport(explanationOutput, "en")
      });
      const explanationMs = Date.now() - explanationStartedAt;

      console.log(`${provider.name}: live extraction and explanation contracts passed (${extractionMs} ms + ${explanationMs} ms)`);
    } catch (error) {
      failures++;
      console.error(`${provider.name} ${stage}: ${error instanceof Error ? error.message : "live contract failed"}`);
    }
  }
  if (failures) process.exitCode = 1;
}
