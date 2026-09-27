import { message } from "./messages";

export type ApiResource = "models" | "chat/completions";

/** A bare origin uses /v1. Explicit base paths (including gateway prefixes)
 * remain intact. Pasted endpoint URLs can be reused for either operation.
 * The request adapter and settings preview must use this same resolver.
 */
export function apiEndpoint(baseUrl: string, resource: ApiResource): string {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error(message("invalidApiUrl"));
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(message("invalidApiUrl"));
  let path = url.pathname.replace(/\/+$/, "");
  path = path.replace(/\/(?:chat\/completions|models)$/, "");
  url.pathname = `${path || "/v1"}/${resource}`;
  url.hash = "";
  return url.toString();
}
