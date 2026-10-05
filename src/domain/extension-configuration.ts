export type ConfigurationValue =
  string | number | boolean | null | ConfigurationValue[] | { [key: string]: ConfigurationValue };
export interface ConfigurationDeclaration {
  key: string;
  title: string | { zh: string; en: string };
  description?: string | { zh: string; en: string };
  default: ConfigurationValue;
  /** Omit for legacy string settings, preserving their existing storage format. */
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  enum?: ConfigurationValue[];
  minimum?: number;
  maximum?: number;
}
export function validateConfiguration(
  declaration: ConfigurationDeclaration,
  value: unknown,
): asserts value is ConfigurationValue {
  const type = declaration.type ?? "string";
  const valid =
    type === "array"
      ? Array.isArray(value)
      : type === "object"
        ? value !== null && typeof value === "object" && !Array.isArray(value)
        : type === "integer"
          ? Number.isSafeInteger(value)
          : typeof value === type;
  if (!valid || (typeof value === "number" && !Number.isFinite(value)))
    throw new Error("Invalid configuration type: " + declaration.key);
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    /* Reject cycles and unsupported values. */
  }
  if (serialized === undefined || serialized.length > 1024 * 1024 || !isJson(value))
    throw new Error("Invalid configuration value: " + declaration.key);
  if (declaration.enum && !declaration.enum.some((item) => JSON.stringify(item) === serialized))
    throw new Error("Configuration value outside enum: " + declaration.key);
  if (
    typeof value === "number" &&
    ((declaration.minimum !== undefined && value < declaration.minimum) ||
      (declaration.maximum !== undefined && value > declaration.maximum))
  )
    throw new Error("Configuration value outside range: " + declaration.key);
}
function isJson(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJson(item, depth + 1));
  return Boolean(
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every((item) => isJson(item, depth + 1)),
  );
}
export function decodeConfiguration(
  declaration: ConfigurationDeclaration,
  saved: string | null,
): ConfigurationValue {
  if (saved === null) return structuredClone(declaration.default);
  try {
    const value: unknown = declaration.type ? JSON.parse(saved) : saved;
    validateConfiguration(declaration, value);
    return value;
  } catch {
    return structuredClone(declaration.default);
  }
}
