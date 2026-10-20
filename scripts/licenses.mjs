import {
  readFile,
  readdir,
  copyFile,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const graph = JSON.parse(
  execFileSync("npm", ["ls", "--all", "--omit=dev", "--json"], {
    encoding: "utf8",
  }),
);
const names = new Set();
function visit(node) {
  for (const [name, child] of Object.entries(node.dependencies || {})) {
    if (child.version) names.add(name);
    visit(child);
  }
}
visit(graph);
await mkdir("public/licenses", { recursive: true });
const notices = [
  "# Production dependency notices",
  "",
  "These files accompany Valise. DOMPurify is used under its Apache-2.0 option.",
  "",
];
for (const name of [...names].sort()) {
  const root = join("node_modules", name);
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const files = (await readdir(root)).filter((f) =>
    /^(licen[cs]e|copying|notice)(\.|$)/i.test(f),
  );
  notices.push(
    `- ${name} ${pkg.version}: ${pkg.license || "see license file"}`,
  );
  for (const file of files)
    await copyFile(
      join(root, file),
      join("public/licenses", name.replaceAll("/", "_") + "-" + file),
    );
}
await copyFile("LICENSE", "public/licenses/Valise-MIT.txt");
await writeFile("public/licenses/DEPENDENCIES.md", notices.join("\n") + "\n");
