/** Presentation of a stored credential. Never pass this mask to saveProvider. */
export function maskApiKey(key: string): string {
  const characters = Array.from(key);
  if (characters.length <= 4) return "...";
  const prefix = key.startsWith("sk-") ? "sk-" : characters.slice(0, 3).join("");
  return `${prefix}...${characters.slice(-4).join("")}`;
}
