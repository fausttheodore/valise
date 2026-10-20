// Zips the built extension in dist/ for installing elsewhere. Signing keys (*.pem) never live in dist/.
import { mkdir, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const target = `artifacts/valise-${version}.zip`;
await mkdir("artifacts", { recursive: true });
await rm(target, { force: true });
execFileSync("/usr/bin/zip", ["-qr", "../" + target, ".", "-x", "*.pem", "*.DS_Store"], {
  cwd: "dist",
});
console.log(target);
