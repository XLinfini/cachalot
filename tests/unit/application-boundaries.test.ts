import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../../src/", import.meta.url));
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}
const files = new Set(sourceFiles(root));
const graph = new Map<string, string[]>();
for (const file of files) {
  const dependencies: string[] = [];
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node: ts.Node) {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0]
          : undefined;
    if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith(".")) {
      const path = resolve(dirname(file), specifier.text.split("?")[0]);
      const target = [path, `${path}.ts`, `${path}.tsx`, join(path, "index.ts")].find((candidate) =>
        files.has(candidate),
      );
      if (target) dependencies.push(target);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  graph.set(file, dependencies);
}
const name = (file: string) => relative(root, file).replaceAll("\\", "/");
const presentation = (path: string) => /^(components\/|hooks\/|App\.tsx|main\.tsx)/.test(path);

/** Follow transitive imports too: a facade/barrel must not hide a reverse edge. */
test("core analysis and OCR remain independent of extensions, including dynamic and barrel imports", () => {
  const violations: string[] = [];
  for (const file of files) {
    const origin = name(file);
    const forbidden = (path: string) => {
      if (/^(domain|infrastructure)\//.test(origin))
        return /^application\//.test(path) || presentation(path);
      if (origin.startsWith("application/document-analysis/"))
        return /^application\/ocr\//.test(path) || /^extensions\//.test(path) || presentation(path);
      if (origin.startsWith("application/ocr/"))
        return path.startsWith("extensions/") || presentation(path);
      return false;
    };
    const seen = new Set<string>([file]);
    function walk(current: string, trail: string[]) {
      for (const target of graph.get(current) || []) {
        if (seen.has(target)) continue;
        seen.add(target);
        const path = [...trail, name(target)];
        if (forbidden(name(target))) violations.push(path.join(" → "));
        else walk(target, path);
      }
    }
    walk(file, [origin]);
  }
  assert.deepEqual(violations, [], `Layer violations:\n${violations.join("\n")}`);
});

// SDK calls are runtime-scoped. Plugin packages may import their own modules,
// the public SDK and external libraries; no internal core facade is permitted.
test("extensions import only their own package or public SDK; only the composition root imports extensions", () => {
  const violations: string[] = [];
  for (const [file, dependencies] of graph) {
    const origin = name(file);
    for (const target of dependencies) {
      const destination = name(target);
      if (origin.startsWith("extensions/")) {
        const packageRoot = origin.split("/").slice(0, 2).join("/") + "/";
        if (!destination.startsWith(packageRoot) && !destination.startsWith("sdk/"))
          violations.push(`${origin} → ${destination}`);
      } else if (
        destination.startsWith("extensions/") &&
        origin !== "application/extensions/runtime.ts"
      )
        violations.push(`${origin} → ${destination}`);
    }
  }
  assert.deepEqual(violations, []);
});
