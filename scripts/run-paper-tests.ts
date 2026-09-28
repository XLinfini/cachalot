/** Select an optional real-paper suite without relying on shell-specific env syntax. */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const target = args.length > 1 ? args[0] : null;
const paper = args.length > 1 ? args[1] : args[0];
if (!paper) throw new Error("Usage: npm run test:e2e:paper -- /absolute/path/reference.pdf");
const playwrightArgs = ["node_modules/@playwright/test/cli.js", "test"];
if (target) playwrightArgs.push(target);
else playwrightArgs.push("--grep", "@paper");
const child = spawn(process.execPath, playwrightArgs, {
  stdio: "inherit",
  env: { ...process.env, CACHALOT_PAPER: resolve(paper) },
});
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
