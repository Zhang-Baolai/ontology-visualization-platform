import { nodeDisplayName, nodeMatches } from "./ontology-data";
import type { GraphNode } from "./ontology-types";

export type NodeAliasMap = Record<string, string>;

export const NODE_ALIAS_STORAGE_KEY = "ontology-visualization:node-aliases:v1";

type AliasStorage = Pick<Storage, "getItem" | "setItem">;

export function normalizeNodeAlias(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 60);
}

export function updateNodeAlias(
  aliases: NodeAliasMap,
  nodeId: string,
  value: string,
): NodeAliasMap {
  const next = { ...aliases };
  const normalized = normalizeNodeAlias(value);
  if (normalized) next[nodeId] = normalized;
  else delete next[nodeId];
  return next;
}

export function loadNodeAliases(storage?: AliasStorage): NodeAliasMap {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(NODE_ALIAS_STORAGE_KEY) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([nodeId, alias]) => [nodeId, normalizeNodeAlias(alias)])
        .filter(([, alias]) => Boolean(alias)),
    );
  } catch {
    return {};
  }
}

export function persistNodeAliases(storage: AliasStorage | undefined, aliases: NodeAliasMap): void {
  if (!storage) return;
  try {
    storage.setItem(NODE_ALIAS_STORAGE_KEY, JSON.stringify(aliases));
  } catch {
    // The graph remains usable when browser storage is unavailable or full.
  }
}

export function nodePresentationName(node: GraphNode, aliases: NodeAliasMap): string {
  return aliases[node.id] || nodeDisplayName(node);
}

export function nodeMatchesPresentation(
  node: GraphNode,
  aliases: NodeAliasMap,
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return false;
  return Boolean(
    aliases[node.id]?.toLocaleLowerCase().includes(normalized) || nodeMatches(node, query),
  );
}
