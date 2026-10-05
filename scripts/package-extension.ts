import { readFile, writeFile, readdir, lstat, realpath } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { zipSync, strToU8 } from "fflate";
import {
  validateManifest,
  packagePath,
  extensionId,
} from "../src/infrastructure/extensions/manifest";
import { parseExtensionPackage } from "../src/infrastructure/extensions/package";

/** Local developer tool. Build scripts from the package are never executed. */
export async function packageExtension(directory: string, output?: string): Promise<string> {
  const root = resolve(directory),
    raw = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const entry = raw.main;
  if (entry && !packagePath(entry)) throw new Error("main must be a relative package path");
  const manifest = validateManifest({ ...raw, ...(entry ? { main: "extension.js" } : {}) });
  const files: Record<string, Uint8Array> = Object.create(null);
  files["package.json"] = strToU8(JSON.stringify(manifest, null, 2));
  if (entry) {
    const result = await build({
      absWorkingDir: root,
      entryPoints: [join(root, entry)],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "cachalotExtension",
      platform: "browser",
      target: "es2022",
      metafile: true,
      plugins: [
        {
          name: "cachalot-sdk",
          setup(builder) {
            builder.onResolve({ filter: /^cachalot(?:\/|$)/ }, (args) => {
              if (args.path !== "cachalot")
                throw new Error(
                  "Installed extensions use webviews for UI; cachalot/react is bundled-only",
                );
              return { path: fileURLToPath(new URL("../src/sdk/index.ts", import.meta.url)) };
            });
          },
        },
      ],
    });
    if (Object.values(result.metafile!.outputs).some((item) => item.imports.length))
      throw new Error("Bundle all runtime imports into the extension entry");
    files["extension.js"] = result.outputFiles![0].contents;
  }
  const include = async (path: string) => {
    if (!packagePath(path)) throw new Error(`Invalid package asset path: ${path}`);
    const resolved = await realpath(join(root, path));
    if (relative(root, resolved).startsWith("..") || relative(root, resolved).startsWith("/"))
      throw new Error(`Asset escapes extension directory: ${path}`);
    const absolute = join(root, path),
      stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not package assets: ${path}`);
    if (stat.isDirectory())
      for (const name of await readdir(absolute)) await include(`${path}/${name}`);
    else if (!files[path] && !["package.json", "extension.js"].includes(path))
      files[path] = new Uint8Array(await readFile(absolute));
  };
  for (const path of raw.files || []) await include(path);
  const archive = zipSync(files, { level: 6 });
  // The build and the installer use exactly the same package contract and limits.
  await parseExtensionPackage(archive);
  const target = resolve(output || `${extensionId(manifest)}-${manifest.version}.cachx`);
  await writeFile(target, archive);
  console.log(
    `Packaged ${extensionId(manifest)} ${manifest.version}: ${relative(process.cwd(), target)}`,
  );
  return target;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2])
    throw new Error("Usage: npm run extension:pack -- <extension-directory> [output.cachx]");
  await packageExtension(process.argv[2], process.argv[3]);
}
