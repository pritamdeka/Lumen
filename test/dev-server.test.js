import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("local development command cannot recursively invoke Vercel", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.dev, "node scripts/dev-server.js");
  assert.doesNotMatch(pkg.scripts.dev, /\bvercel\s+dev\b/);
});

test("local server restricts static files and never prints credentials", async () => {
  const source = await readFile(new URL("../scripts/dev-server.js", import.meta.url), "utf8");
  assert.match(source, /PUBLIC_ROOT_FILES/);
  assert.match(source, /\^src\[/);
  assert.doesNotMatch(source, /console\.log\([^)]*(?:API_KEY|process\.env|match\[2\])/);
  assert.doesNotMatch(source, /key\.txt.*serveStatic/);
});
