/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const ignoredDirs = new Set([".git", ".next", "node_modules", "docs", "coverage"]);
const ignoredFiles = new Set([".env", ".env.local", ".env.example", "package-lock.json"]);

const patterns = [
  { name: "Supabase service role", regex: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*(?!your-service-role-key)/i },
  { name: "OpenAI key", regex: /sk-proj-[A-Za-z0-9_-]+/ },
  { name: "Generic private key", regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "JWT-like token", regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(path.join(dir, entry.name), files);
      continue;
    }

    if (ignoredFiles.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (!/\.(ts|tsx|js|jsx|cjs|mjs|json|sql|md|yml|yaml)$/.test(entry.name)) continue;
    files.push(fullPath);
  }
  return files;
}

const findings = [];
for (const file of walk(root)) {
  const content = fs.readFileSync(file, "utf8");
  for (const pattern of patterns) {
    if (pattern.regex.test(content)) {
      findings.push({ file: path.relative(root, file), pattern: pattern.name });
    }
  }
}

if (findings.length > 0) {
  console.error("Potential secret patterns found:");
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.pattern}`);
  }
  process.exit(1);
}

console.log("Secret scan passed.");
