import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exportExtensionSdk } from "./extension-sdk";
import { HOST_API_VERSION, ID_PATTERN } from "../src/infrastructure/extensions/manifest";
export async function createExtension(directory: string, id: string) {
  if (!ID_PATTERN.test(id)) throw new Error("Use a publisher.name extension ID");
  const root = resolve(directory),
    [publisher, name] = id.split(".");
  await mkdir(dirname(root), { recursive: true });
  await mkdir(root); // Existing projects must never be overwritten.
  await exportExtensionSdk(join(root, "sdk"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        publisher,
        name,
        version: "0.1.0",
        displayName: { zh: name, en: name },
        description: { zh: "Cachalot 插件", en: "Cachalot extension" },
        engines: { cachalot: "^" + HOST_API_VERSION },
        main: "src/extension.ts",
        activationEvents: ["onStartupFinished"],
        capabilities: [],
        contributes: {
          commands: [{ command: id + ".hello", title: { zh: "你好", en: "Hello" } }],
          menus: [{ location: "commandPalette", command: id + ".hello" }],
        },
        scripts: { check: "tsc --noEmit" },
        devDependencies: { typescript: "^5.9.3", cachalot: "file:./sdk" },
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          lib: ["ES2022", "DOM"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          baseUrl: ".",
          paths: { cachalot: ["sdk/types/sdk/index.d.ts"] },
        },
        include: ["src"],
      },
      null,
      2,
    ) + "\n",
  );
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src/extension.ts"),
    [
      'import type { ExtensionContext } from "cachalot";',
      "export function activate(context: ExtensionContext) {",
      "  context.commands.registerCommand(" + JSON.stringify(id + ".hello") + ", () => {",
      '    context.window.showInformationMessage(context.localization.language === "zh" ? "你好！" : "Hello!");',
      "  });",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(join(root, ".gitignore"), "node_modules/\n*.cachx\n");
  return root;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3])
    throw new Error("Usage: npm run extension:create -- <directory> <publisher.name>");
  console.log("Created extension: " + (await createExtension(process.argv[2], process.argv[3])));
}
