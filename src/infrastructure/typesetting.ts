import { invoke, isTauri } from "@tauri-apps/api/core";
import { nativeRequest } from "./platform";
import type {
  TypesettingConfiguration,
  TypesettingInput,
  TypesettingResult,
  TypesettingSettings,
  TypesettingStatus,
} from "../domain/typesetting";

function desktop() {
  if (!isTauri()) throw new Error("XeLaTeX requires the desktop application");
}
function encode(bytes: Uint8Array) {
  let raw = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(raw);
}
function decode(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
export const typesetting = {
  async getStatus(): Promise<TypesettingStatus> {
    if (!isTauri())
      return {
        available: false,
        initialized: false,
        mode: "bundled",
        runtimeId: null,
        reason: "desktop-only",
      };
    return invoke("typesetting_status");
  },
  async getSettings(): Promise<TypesettingSettings> {
    desktop();
    return invoke("typesetting_settings");
  },
  async configure(configuration: TypesettingConfiguration): Promise<void> {
    desktop();
    return invoke("typesetting_configure", { configuration });
  },
  async initialize(signal?: AbortSignal): Promise<void> {
    desktop();
    return nativeRequest("typesetting_initialize", {}, signal);
  },
  async installPackages(packages: string[], signal?: AbortSignal): Promise<string> {
    desktop();
    return nativeRequest("typesetting_install_packages", { packages }, signal);
  },
  async compile(input: TypesettingInput, signal?: AbortSignal): Promise<TypesettingResult> {
    desktop();
    // Copy and serialize before IPC; native code enforces the authoritative limits.
    const result = await nativeRequest<{
      success: boolean;
      pdf: string | null;
      log: string;
      files: { name: string; dataBase64: string }[];
    }>(
      "typesetting_compile",
      {
        input: {
          ...input,
          assets: input.assets?.map(({ name, bytes }) => ({ name, dataBase64: encode(bytes) })),
        },
      },
      signal,
    );
    return {
      ...result,
      pdf: result.pdf ? decode(result.pdf) : null,
      files: result.files.map(({ name, dataBase64 }) => ({ name, bytes: decode(dataBase64) })),
    };
  },
};
