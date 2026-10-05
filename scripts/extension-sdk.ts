import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { build } from "esbuild";
import { HOST_API_VERSION } from "../src/infrastructure/extensions/manifest";
const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
/** Export a self-contained local SDK package. No source paths into the host remain. */
export async function exportExtensionSdk(directory: string) {
  const target = resolve(directory);
  await mkdir(target, { recursive: true });
  const program = ts.createProgram([join(sourceRoot, "sdk/index.ts")], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    strict: true,
    skipLibCheck: true,
    types: [],
    declaration: true,
    emitDeclarationOnly: true,
    rootDir: sourceRoot,
    outDir: join(target, "types"),
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (path) => path,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => "\n",
      }),
    );
  const outputs: [string, string][] = [];
  program.emit(undefined, (path, contents) => outputs.push([path, contents]));
  for (const [path, contents] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
  await build({
    entryPoints: [join(sourceRoot, "sdk/index.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outfile: join(target, "index.js"),
  });
  await writeFile(
    join(target, "package.json"),
    JSON.stringify(
      {
        name: "cachalot",
        version: HOST_API_VERSION,
        private: true,
        type: "module",
        main: "./index.js",
        types: "./types/sdk/index.d.ts",
        exports: { ".": { types: "./types/sdk/index.d.ts", import: "./index.js" } },
      },
      null,
      2,
    ) + "\n",
  );
  return target;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: npm run extension:sdk -- <output-directory>");
  console.log("Exported local SDK: " + (await exportExtensionSdk(process.argv[2])));
}
