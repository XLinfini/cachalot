/** Build-time only. No global TeX installation, links, PATH or font-cache changes. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TEXLIVE } from "./texlive-spec.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const build = path.join(root, ".test-cache/texlive-build");
const runtime = path.join(build, "runtime");
const output = path.join(root, "src-tauri/resources/texlive");
const archive = path.join(output, "runtime.tar.gz");
const manifestPath = path.join(output, "manifest.json");
const engineSource = path.join(output, "engine-source.tar.gz");
const packageLock = path.join(root, "scripts/texlive-packages.lock.txt");
const platform = `${process.platform}-${process.arch}`;
if (platform !== TEXLIVE.platform)
  throw new Error(
    `XeLaTeX bundle currently supports ${TEXLIVE.platform}; refusing to package ${platform}.`,
  );
const target = process.env.CARGO_BUILD_TARGET ?? process.env.TAURI_ENV_TARGET_TRIPLE;
if (target && target !== "x86_64-unknown-linux-gnu")
  throw new Error(`The TeX bundle does not match target ${target}.`);

async function hash(file: string) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
async function run(program: string, args: string[], capture = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: root,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let text = "";
    child.stdout?.on("data", (chunk) => {
      text += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(text) : reject(new Error(`${program} exited ${code}`)),
    );
  });
}
async function check() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest.platform !== platform ||
    manifest.year !== TEXLIVE.year ||
    manifest.repository !== TEXLIVE.repository ||
    manifest.installerSha256 !== TEXLIVE.installerSha256 ||
    manifest.engineSourceCommit !== TEXLIVE.engineSourceCommit ||
    (await hash(engineSource)) !== TEXLIVE.engineSourceSha256 ||
    JSON.stringify(manifest.requiredPackages) !== JSON.stringify(TEXLIVE.packages) ||
    (await readFile(path.join(output, "packages.txt"), "utf8")).trim() !==
      (await readFile(packageLock, "utf8")).trim() ||
    (await hash(archive)) !== manifest.archiveSha256
  )
    throw new Error("TeX runtime bundle has the wrong platform, specification or SHA-256.");
  console.log(
    `XeLaTeX ${manifest.runtimeId}: ${Math.round((await stat(archive)).size / 1024 / 1024)} MiB, SHA-256 verified.`,
  );
}
if (process.argv.includes("--check")) {
  await check().catch((error) => {
    throw new Error(`${error.message} Run npm run texlive:prepare first.`);
  });
} else {
  if (
    !process.argv.includes("--force") &&
    (await check()
      .then(() => true)
      .catch(() => false))
  )
    process.exit(0);
  await mkdir(build, { recursive: true });
  const installer = path.join(build, TEXLIVE.installer);
  if ((await hash(installer).catch(() => "")) !== TEXLIVE.installerSha256) {
    await run("curl", [
      "-fL",
      "--retry",
      "2",
      "--max-time",
      "300",
      `${TEXLIVE.repository}/${TEXLIVE.installer}`,
      "-o",
      `${installer}.part`,
    ]);
    if ((await hash(`${installer}.part`)) !== TEXLIVE.installerSha256) {
      await rm(`${installer}.part`, { force: true });
      throw new Error("TeX Live installer SHA-256 mismatch.");
    }
    await run("mv", [`${installer}.part`, installer]);
  }
  if (!(await stat(path.join(runtime, "tlpkg/texlive.tlpdb")).catch(() => false))) {
    await run("tar", ["-xzf", installer, "-C", build]);
    const profile = path.join(build, "profile");
    await writeFile(
      profile,
      [
        "selected_scheme scheme-infraonly",
        `TEXDIR ${runtime}`,
        `TEXMFLOCAL ${runtime}/texmf-local`,
        `TEXMFSYSVAR ${runtime}/texmf-var`,
        `TEXMFSYSCONFIG ${runtime}/texmf-config`,
        `binary_${TEXLIVE.texPlatform} 1`,
        "instopt_portable 1",
        "instopt_adjustpath 0",
        "tlpdbopt_install_docfiles 1",
        "tlpdbopt_install_srcfiles 1",
        "tlpdbopt_autobackup 0",
        "tlpdbopt_desktop_integration 0",
        "tlpdbopt_file_assocs 0",
        "",
      ].join("\n"),
    );
    await run("perl", [
      path.join(build, TEXLIVE.installerDirectory, "install-tl"),
      "-no-gui",
      "-profile",
      profile,
      "-repository",
      TEXLIVE.repository,
    ]);
  }
  const bin = path.join(runtime, "bin", TEXLIVE.texPlatform);
  await run(path.join(bin, "tlmgr"), [
    "--repository",
    TEXLIVE.repository,
    "install",
    ...TEXLIVE.packages,
  ]);
  await run(path.join(bin, "fmtutil-sys"), ["--byfmt", "xelatex"]);
  for (const name of ["xelatex", "xdvipdfmx", "kpsewhich", "tlmgr"])
    await run(path.join(bin, name), ["--version"]);
  // Keep upstream licences, per-package docs and sources in the redistributed archive.
  // Do not include installer logs with local paths or machine-specific backups.
  await rm(path.join(runtime, "install-tl.log"), { force: true });
  await rm(path.join(runtime, "texmf-var/web2c/tlmgr.log"), { force: true });
  await rm(path.join(runtime, "texmf-var/web2c/tlmgr-commands.log"), { force: true });
  await mkdir(output, { recursive: true });
  if ((await hash(engineSource).catch(() => "")) !== TEXLIVE.engineSourceSha256) {
    await run("curl", [
      "-fL",
      "--retry",
      "2",
      "--max-time",
      "300",
      `https://codeload.github.com/TeX-Live/texlive-source/tar.gz/${TEXLIVE.engineSourceCommit}`,
      "-o",
      `${engineSource}.part`,
    ]);
    if ((await hash(`${engineSource}.part`)) !== TEXLIVE.engineSourceSha256) {
      await rm(`${engineSource}.part`, { force: true });
      throw new Error("TeX Live engine source SHA-256 mismatch.");
    }
    await run("mv", [`${engineSource}.part`, engineSource]);
  }
  const packages = await run(
    path.join(bin, "tlmgr"),
    ["info", "--only-installed", "--data", "name,localrev"],
    true,
  );
  if (packages.trim() !== (await readFile(packageLock, "utf8")).trim())
    throw new Error("Installed TeX Live revisions do not match the source lock.");
  await writeFile(
    path.join(runtime, "README.CACHALOT"),
    `Private Cachalot runtime based on TeX Live ${TEXLIVE.year}.\nSubset selected by scripts/texlive-spec.ts; package documentation, sources and licences retained.\nEngine build sources: engine-source.tar.gz in the application's texlive resource directory (official branch2025 commit ${TEXLIVE.engineSourceCommit}).\nPackage revisions: packages.txt in the same resource directory. User additions belong to a separate tree.\n`,
  );
  await run("tar", [
    "--sort=name",
    "--mtime=@0",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "-czf",
    archive,
    "-C",
    runtime,
    ".",
  ]);
  const archiveSha256 = await hash(archive);
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        year: TEXLIVE.year,
        platform,
        runtimeId: `texlive-${TEXLIVE.year}-${platform}-${archiveSha256.slice(0, 16)}`,
        binDirectory: `bin/${TEXLIVE.texPlatform}`,
        repository: TEXLIVE.repository,
        archiveSha256,
        installerSha256: TEXLIVE.installerSha256,
        engineSourceCommit: TEXLIVE.engineSourceCommit,
        engineSourceSha256: TEXLIVE.engineSourceSha256,
        requiredPackages: TEXLIVE.packages,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(path.join(output, "packages.txt"), packages);
  await check();
}
