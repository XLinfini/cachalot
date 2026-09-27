/** Build-time download only. The installed app reads a local, verified model. */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import { LAYOUT_MODEL, MODEL_URL } from "../src/domain/model.ts";

const directory = fileURLToPath(new URL("../public/models/", import.meta.url));
const target = `${directory}${LAYOUT_MODEL.fileName}`;
async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

await mkdir(directory, { recursive: true });
if (await stat(target).then(s => s.size === LAYOUT_MODEL.size).catch(() => false) && await digest(target) === LAYOUT_MODEL.sha256) {
  console.log("Heron 模型已存在，SHA-256 校验通过。");
} else {
  if (process.argv.includes("--check")) throw new Error("固定版本 Heron 模型缺失或校验失败，请先运行 npm run models:prepare。");
  const partial = `${target}.part`;
  try {
    console.log(`下载固定版本 Heron 模型（${Math.round(LAYOUT_MODEL.size / 1e6)} MB）…`);
    const response = await fetch(MODEL_URL);
    if (!response.ok || !response.body) throw new Error(`模型下载失败：HTTP ${response.status}`);
    let received = 0;
    let milestone = 0;
    const progress = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length;
      const next = Math.floor(received / LAYOUT_MODEL.size * 10);
      if (next > milestone) { milestone = next; console.log(`${Math.min(next * 10, 100)}%`); }
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial));
    if (received !== LAYOUT_MODEL.size || await digest(partial) !== LAYOUT_MODEL.sha256) throw new Error("模型大小或 SHA-256 不匹配，下载文件已丢弃。");
    await rename(partial, target);
    console.log("模型准备完成，SHA-256 校验通过。");
  } catch (error) { await rm(partial, { force: true }); throw error; }
}
