// Usage: node version-bump.mjs patch|minor|major
import { readFileSync, writeFileSync } from "fs";

const bump = process.argv[2] ?? "patch";
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const [major, minor, patch] = manifest.version.split(".").map(Number);

const next = { patch: `${major}.${minor}.${patch + 1}`, minor: `${major}.${minor + 1}.0`, major: `${major + 1}.0.0` }[bump];
if (!next) { console.error("Usage: node version-bump.mjs patch|minor|major"); process.exit(1); }

manifest.version = next;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = next;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

console.log(`Bumped to ${next}`);
console.log(`Next: git add manifest.json package.json && git commit -m "chore: v${next}" && git tag ${next} && git push origin main --tags`);
