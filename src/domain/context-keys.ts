/** Small declarative context language. Never executes extension JavaScript. */
export type ContextValue = string | number | boolean | null;
type Node =
  | { kind: "value"; value: ContextValue }
  | { kind: "key"; key: string }
  | { kind: "not"; child: Node }
  | { kind: "binary"; op: string; left: Node; right: Node };
const cache = new Map<string, Node>();
export function parseContext(expression: string): Node {
  if (typeof expression !== "string" || !expression.trim() || expression.length > 2048)
    throw new Error("Invalid context expression");
  const cached = cache.get(expression);
  if (cached) return cached;
  const tokens: string[] = [];
  const lexer =
    /\s*(===|!==|==|!=|&&|\|\||[!()]|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|[A-Za-z_][\w.-]*)/y;
  let offset = 0;
  while (offset < expression.trimEnd().length) {
    lexer.lastIndex = offset;
    const match = lexer.exec(expression);
    if (!match || tokens.length >= 256) throw new Error("Invalid context expression");
    tokens.push(match[1]);
    offset = lexer.lastIndex;
  }
  let index = 0;
  const atom = (): Node => {
    const token = tokens[index++];
    if (token === "!") return { kind: "not", child: atom() };
    if (token === "(") {
      const node = or();
      if (tokens[index++] !== ")") throw new Error("Unclosed context expression");
      return node;
    }
    if (!token || ["&&", "||", ")", "==", "!=", "===", "!=="].includes(token))
      throw new Error("Invalid context operand");
    if (token === "true" || token === "false" || token === "null")
      return { kind: "value", value: token === "null" ? null : token === "true" };
    if (/^-?\d/.test(token)) {
      const number = Number(token);
      if (!Number.isFinite(number)) throw new Error("Invalid context number");
      return { kind: "value", value: number };
    }
    if (token.startsWith('"')) return { kind: "value", value: JSON.parse(token) };
    if (token.startsWith("'"))
      return { kind: "value", value: token.slice(1, -1).replace(/\\(['\\])/g, "$1") };
    return { kind: "key", key: token };
  };
  const compare = (): Node => {
    const left = atom(),
      op = tokens[index];
    if (!["==", "!=", "===", "!=="].includes(op)) return left;
    index++;
    let right = atom();
    // VS Code-style bare right-hand identifiers are literal strings.
    if (right.kind === "key") right = { kind: "value", value: right.key };
    return { kind: "binary", op, left, right };
  };
  const and = (): Node => {
    let node = compare();
    while (tokens[index] === "&&") {
      index++;
      node = { kind: "binary", op: "&&", left: node, right: compare() };
    }
    return node;
  };
  const or = (): Node => {
    let node = and();
    while (tokens[index] === "||") {
      index++;
      node = { kind: "binary", op: "||", left: node, right: and() };
    }
    return node;
  };
  const node = or();
  if (index !== tokens.length) throw new Error("Invalid context expression");
  if (cache.size >= 512) cache.clear();
  cache.set(expression, node);
  return node;
}
export function matchesContext(
  expression: string | undefined,
  values: Readonly<Record<string, ContextValue>>,
): boolean {
  if (!expression) return true;
  const evaluate = (node: Node): ContextValue | undefined => {
    if (node.kind === "value") return node.value;
    if (node.kind === "key") return Object.hasOwn(values, node.key) ? values[node.key] : undefined;
    if (node.kind === "not") return !evaluate(node.child);
    const left = evaluate(node.left);
    if (node.op === "&&") return Boolean(left) && Boolean(evaluate(node.right));
    if (node.op === "||") return Boolean(left) || Boolean(evaluate(node.right));
    const equal = left === evaluate(node.right);
    return node.op === "==" || node.op === "===" ? equal : !equal;
  };
  return Boolean(evaluate(parseContext(expression)));
}
export function normalizeKeybinding(value: string): string {
  const parts = value
    .toLowerCase()
    .split("+")
    .map((part) => part.trim());
  const key = parts.pop();
  const modifiers = new Set(parts);
  if (
    !key ||
    parts.length !== modifiers.size ||
    parts.some((part) => !["ctrl", "shift", "alt", "meta"].includes(part)) ||
    !/^(?:[a-z0-9]|f(?:[1-9]|1[0-2])|enter|escape|space|tab|arrow(?:up|down|left|right))$/.test(key)
  )
    throw new Error("Invalid keybinding: " + value);
  return ["ctrl", "alt", "shift", "meta"]
    .filter((part) => modifiers.has(part))
    .concat(key)
    .join("+");
}
