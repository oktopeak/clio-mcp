#!/usr/bin/env node
// Enumerates exactly what `npm pack` would ship and scans it for secret-shaped
// content. Locally it checks generic patterns; in CI, with
// KNOWN_SECRET_FINGERPRINT set to a real secret (never committed), it also
// checks for that literal value. Wired into `prepublishOnly` so a publish is
// blocked on failure.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SECRET_PATTERNS = [
  { name: "client_secret assignment", pattern: /client_secret\s*[:=]\s*['"][^'"]{10,}['"]/i },
  { name: "credentials embedded in a URL", pattern: /:\/\/[^\s'"/]+:[^\s'"/]+@/ },
  { name: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

function getPackedFilePaths() {
  const output = execSync("npm pack --dry-run --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const [pkgInfo] = JSON.parse(output);
  return pkgInfo.files.map((f) => f.path);
}

function main() {
  const files = getPackedFilePaths();
  const fingerprint = (process.env.KNOWN_SECRET_FINGERPRINT ?? "").trim();
  let failed = false;

  for (const relPath of files) {
    let content;
    try {
      content = readFileSync(relPath, "utf8");
    } catch {
      continue; // not a text file
    }
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        console.error(`[verify-no-secrets] FAIL: ${relPath} matches "${name}" pattern.`);
        failed = true;
      }
    }
    if (fingerprint && content.includes(fingerprint)) {
      console.error(`[verify-no-secrets] FAIL: ${relPath} contains the known secret fingerprint.`);
      failed = true;
    }
  }

  if (failed) {
    console.error(`[verify-no-secrets] Scanned ${files.length} file(s) that would ship in the npm package: FAILED.`);
    process.exit(1);
  }
  console.log(`[verify-no-secrets] Scanned ${files.length} file(s) that would ship in the npm package: clean.`);
}

main();
