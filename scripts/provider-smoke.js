import { buildExtractionPrompt, parseExtraction } from "../api/analyze.js";
import { callProvider, getConfiguredProviders } from "../api/providers.js";

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
    try {
      const output = await callProvider(provider, buildExtractionPrompt(), [SAFE_TEST_IMAGE]);
      parseExtraction(output);
      console.log(`${provider.name}: live multimodal contract passed`);
    } catch (error) {
      failures++;
      console.error(`${provider.name}: ${error instanceof Error ? error.message : "live contract failed"}`);
    }
  }
  if (failures) process.exitCode = 1;
}
