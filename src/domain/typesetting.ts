/** Host-owned TeX runtime. These DTOs never expose commands or local paths to extensions. */
export interface TypesettingStatus {
  available: boolean;
  initialized: boolean;
  mode: "bundled" | "external";
  runtimeId: string | null;
  reason:
    | "desktop-only"
    | "unsupported-platform"
    | "bundle-missing"
    | "sandbox-missing"
    | "engine-missing"
    | null;
}

export interface TypesettingInput {
  /** Complete UTF-8 document; host fixes the job name to document. */
  source: string;
  /** Flat, relative filenames. Use these for native formula PDFs, images and fonts. */
  assets?: { name: string; bytes: Uint8Array }[];
  passes?: 1 | 2 | 3;
  timeoutMs?: number;
  /** Flat filenames produced by TeX, e.g. a baseline/size table. */
  returnFiles?: string[];
}

export interface TypesettingResult {
  success: boolean;
  pdf: Uint8Array | null;
  log: string;
  files: { name: string; bytes: Uint8Array }[];
}

/** Core settings only; extensions cannot configure executables or install packages. */
export interface TypesettingConfiguration {
  mode: "bundled" | "external";
  binDirectory: string;
}

export interface TypesettingSettings {
  configuration: TypesettingConfiguration;
  runtimeDirectory: string;
  userTree: string;
  templatesDirectory: string;
  repository: string;
}
