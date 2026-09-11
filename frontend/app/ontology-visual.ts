import type { GraphEdge, GraphNode } from "./ontology-types";

// Microsoft Fluent-inspired entity palette. Colours are deterministic so the
// same ontology class keeps its visual identity across reloads and layouts.
const ENTITY_PALETTE = [
  "#0078d4",
  "#107c10",
  "#ffb900",
  "#8764b8",
  "#00b7c3",
  "#d83b01",
  "#5c2d91",
  "#498205",
  "#038387",
  "#ca5010",
];

export function graphNodeColor(node: GraphNode): string {
  const key = `${node.module || "ontology"}:${node.qname || node.id}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return ENTITY_PALETTE[hash % ENTITY_PALETTE.length];
}

export function graphNodeGlyph(node: GraphNode): string {
  const text = `${node.label || ""} ${node.local_name} ${node.qname}`.toLowerCase();
  if (/region|大区|区域/.test(text)) return "◎";
  if (/availability|\baz\b|可用区/.test(text)) return "⌖";
  if (/pool|资源池/.test(text)) return "◉";
  if (/type|flavor|类型/.test(text)) return "◆";
  if (/metric|指标/.test(text)) return "Σ";
  if (/business|业务/.test(text)) return "◇";
  return "●";
}

export function collectNeighborhood(
  centerId: string,
  edges: Pick<GraphEdge, "id" | "source" | "target">[],
  depth: number,
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>([centerId]);
  const edgeIds = new Set<string>();
  let frontier = new Set<string>([centerId]);

  for (let level = 0; level < Math.max(1, depth); level += 1) {
    const next = new Set<string>();
    for (const edge of edges) {
      const sourceInFrontier = frontier.has(edge.source);
      const targetInFrontier = frontier.has(edge.target);
      if (!sourceInFrontier && !targetInFrontier) continue;
      edgeIds.add(edge.id);
      const neighbor = sourceInFrontier ? edge.target : edge.source;
      if (!nodeIds.has(neighbor)) next.add(neighbor);
      nodeIds.add(neighbor);
    }
    frontier = next;
    if (!frontier.size) break;
  }

  return { nodeIds, edgeIds };
}
