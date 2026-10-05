import { Unzip, UnzipInflate } from "fflate";
import type { ExtensionManifest } from "../../sdk";
import { extensionId, packagePath, validateManifest } from "./manifest";

export interface ExtensionPackage {
  id: string;
  manifest: ExtensionManifest;
  files: Record<string, Uint8Array>;
  digest: string;
  installedAt: number;
}
const MAX_ARCHIVE = 16 * 1024 * 1024,
  MAX_TOTAL = 32 * 1024 * 1024,
  MAX_FILE = 8 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = MAX_ARCHIVE;
const decoder = new TextDecoder("utf-8", { fatal: true });
/** Bounded streaming extraction. Packages are data; no filesystem extraction or install scripts. */
export async function parseExtensionPackage(bytes: Uint8Array): Promise<ExtensionPackage> {
  if (bytes.length > MAX_ARCHIVE || bytes.length < 22)
    throw new Error("Invalid extension package size (maximum 16 MiB)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50)
    end--;
  if (
    end < 0 ||
    view.getUint32(end, true) !== 0x06054b50 ||
    end + 22 + view.getUint16(end + 20, true) !== bytes.length
  )
    throw new Error("Invalid ZIP directory");
  const count = view.getUint16(end + 10, true),
    directorySize = view.getUint32(end + 12, true),
    start = view.getUint32(end + 16, true);
  if (
    count > 128 ||
    count === 0 ||
    start + directorySize !== end ||
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count
  )
    throw new Error("Unsupported ZIP directory");
  const expected = new Map<
    string,
    { size: number; crc: number; method: number; compressed: number; offset: number }
  >();
  let position = start,
    declared = 0;
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50)
      throw new Error("Invalid ZIP entry");
    const flags = view.getUint16(position + 8, true),
      method = view.getUint16(position + 10, true),
      compressed = view.getUint32(position + 20, true),
      size = view.getUint32(position + 24, true),
      nameLength = view.getUint16(position + 28, true),
      extraLength = view.getUint16(position + 30, true),
      commentLength = view.getUint16(position + 32, true),
      attributes = view.getUint32(position + 38, true),
      offset = view.getUint32(position + 42, true);
    if (position + 46 + nameLength + extraLength + commentLength > end)
      throw new Error("Invalid ZIP entry length");
    const name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength));
    if (
      !packagePath(name) ||
      expected.has(name) ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      ((attributes >>> 16) & 0xf000) === 0xa000 ||
      size > MAX_FILE ||
      compressed > MAX_ARCHIVE ||
      (declared += size) > MAX_TOTAL
    )
      throw new Error(`Unsupported ZIP entry: ${name}`);
    if (
      offset + 30 > start ||
      view.getUint32(offset, true) !== 0x04034b50 ||
      view.getUint16(offset + 8, true) !== method ||
      view.getUint16(offset + 6, true) & 1
    )
      throw new Error(`Invalid ZIP local entry: ${name}`);
    const localNameLength = view.getUint16(offset + 26, true),
      localExtraLength = view.getUint16(offset + 28, true);
    if (
      offset + 30 + localNameLength + localExtraLength + compressed > start ||
      decoder.decode(bytes.subarray(offset + 30, offset + 30 + localNameLength)) !== name
    )
      throw new Error(`Mismatched ZIP entry: ${name}`);
    expected.set(name, {
      size,
      crc: view.getUint32(position + 16, true),
      method,
      compressed,
      offset,
    });
    position += 46 + nameLength + extraLength + commentLength;
  }
  if (position !== end) throw new Error("Invalid ZIP directory length");
  const files: Record<string, Uint8Array> = Object.create(null);
  let total = 0;
  const seen = new Set<string>();
  const unzip = new Unzip((file) => {
    const entry = expected.get(file.name);
    if (!entry || seen.has(file.name) || file.compression !== entry.method)
      throw new Error("Unexpected ZIP entry");
    seen.add(file.name);
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, data, final) => {
      if (error) throw error;
      size += data.length;
      total += data.length;
      if (size > entry.size || size > MAX_FILE || total > MAX_TOTAL)
        throw new Error("ZIP expansion limit exceeded");
      chunks.push(data);
      if (final) {
        if (size !== entry.size) throw new Error("ZIP size mismatch");
        const result = new Uint8Array(size);
        let cursor = 0;
        for (const chunk of chunks) {
          result.set(chunk, cursor);
          cursor += chunk.length;
        }
        if (crc32(result) !== entry.crc) throw new Error("ZIP checksum mismatch");
        files[file.name] = result;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 4096)
    unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
  if (Object.keys(files).length !== count || !files["package.json"])
    throw new Error("Missing package.json or incomplete archive");
  if (files["package.json"].length > 128 * 1024) throw new Error("Manifest is too large");
  const manifest = validateManifest(JSON.parse(decoder.decode(files["package.json"])));
  if (manifest.main ? !files[manifest.main] : !manifest.extensionPack?.length)
    throw new Error("Missing bundled main entry or extensionPack");
  if (manifest.main) decoder.decode(files[manifest.main]);
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { id: extensionId(manifest), manifest, files, digest, installedAt: Date.now() };
}
function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
