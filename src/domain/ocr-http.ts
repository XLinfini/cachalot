import type { OcrHttpRequest } from "./ocr-adapter";
import { message } from "./messages";

/** Secret-bearing requests remain on the configured provider origin.
 * Unauthenticated upload hosts can explicitly use auth: none. */
export function prepareOcrRequest(baseUrl: string, request: OcrHttpRequest, secret?: string) {
  let url: URL, base: URL;
  try {
    url = new URL(request.url);
    base = new URL(baseUrl.trim());
  } catch {
    throw new Error(message("invalidApiUrl"));
  }
  const auth = request.auth || {
    type: "header" as const,
    name: "Authorization",
    prefix: "Bearer ",
  };
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (auth.type !== "none" && url.origin !== base.origin)
  )
    throw new Error(message("invalidApiUrl"));
  url.hash = "";
  const method = request.method || "POST";
  if (!["GET", "POST"].includes(method) || (method === "GET" && request.body !== undefined))
    throw new Error(message("ocrRequestInvalid"));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const setHeader = (name: string, value: string) => {
    for (const key of Object.keys(headers))
      if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
    headers[name] = value;
  };
  const customNames = new Set<string>();
  for (const [name, value] of Object.entries(request.headers || {})) {
    if (customNames.has(name.toLowerCase())) throw new Error(message("ocrRequestInvalid"));
    customNames.add(name.toLowerCase());
    setHeader(name, value);
  }
  let body = request.body;
  if (auth.type !== "none" && (!auth.name || /[\r\n]/.test(auth.name)))
    throw new Error(message("ocrRequestInvalid"));
  if (secret && auth.type === "header") setHeader(auth.name, `${auth.prefix || ""}${secret}`);
  if (secret && auth.type === "query") {
    url.searchParams.delete(auth.name);
    url.searchParams.set(auth.name, secret);
  }
  if (auth.type === "json") {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error(message("ocrRequestInvalid"));
    if (secret) body = { ...body, [auth.name]: secret };
  }
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (payload && new TextEncoder().encode(payload).byteLength > 20 * 1024 * 1024)
    throw new Error(message("ocrRequestInvalid"));
  return { url: url.toString(), method, headers, body: payload };
}
export function redactOcrJson(body: unknown, secret?: string): unknown {
  if (!secret) return body;
  if (typeof body === "string") return body.split(secret).join("[redacted]");
  if (Array.isArray(body)) return body.map((value) => redactOcrJson(value, secret));
  if (body && typeof body === "object")
    return Object.fromEntries(
      Object.entries(body).map(([key, value]) => [key, redactOcrJson(value, secret)]),
    );
  return body;
}
