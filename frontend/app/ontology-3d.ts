import type { DisplayEdge } from "./ontology-data";
import type { GraphNode } from "./ontology-types";
import { nodePresentationName, type NodeAliasMap } from "./ontology-aliases";

export interface Ontology3DNode {
  id: string;
  label: string;
  technicalName: string;
  qname: string;
  module: string;
  color: string;
  root: boolean;
  zLayer: number;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface Ontology3DLink {
  id: string;
  source: string | Ontology3DNode;
  target: string | Ontology3DNode;
  label: string;
  edgeType: string;
  inferred: boolean;
  crossModule: boolean;
  bidirectional: boolean;
  curvature: number;
  originalEdgeIds: string[];
}

export interface Ontology3DData {
  nodes: Ontology3DNode[];
  links: Ontology3DLink[];
}

function curveOffset(index: number): number {
  if (index === 0) return 0;
  const magnitude = Math.ceil(index / 2) * 0.12;
  return index % 2 === 1 ? magnitude : -magnitude;
}

const MODULE_DEPTHS: Record<string, number> = {
  dimension: -96,
  metric: -32,
  capability: 32,
  scenario: 96,
  external: 0,
};

const MODULE_COLORS: Record<string, string> = {
  dimension: "#5da9ff",
  metric: "#2ed6b8",
  capability: "#f2b66d",
  scenario: "#c995ff",
  external: "#7eb5d6",
};

function stableHash(value: string): number {
  return [...value].reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
    2166136261,
  );
}

export function moduleColor(module: string): string {
  if (module in MODULE_COLORS) return MODULE_COLORS[module];
  const customPalette = ["#5da9ff", "#2ed6b8", "#f2b66d", "#c995ff", "#ff8f70", "#63d8ff"];
  return customPalette[stableHash(module) % customPalette.length];
}

export function moduleDepth(module: string): number {
  if (module in MODULE_DEPTHS) return MODULE_DEPTHS[module];
  const hash = [...module].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) % 121,
    0,
  );
  return hash - 60;
}

function initialPosition(index: number): { x: number; y: number } {
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  const radius = 42 + Math.sqrt(index + 1) * 38;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius * 0.72,
  };
}

export function buildOntology3DData(
  nodes: GraphNode[],
  edges: DisplayEdge[],
  aliases: NodeAliasMap,
  defaultModule = "external",
): Ontology3DData {
  const pairCounts = new Map<string, number>();
  const resolvedModules = nodes.map((node) => node.module || defaultModule);
  const moduleMembers = new Map<string, string[]>();
  nodes.forEach((node, index) => {
    const module = resolvedModules[index];
    const members = moduleMembers.get(module) || [];
    members.push(node.id);
    moduleMembers.set(module, members);
  });
  moduleMembers.forEach((members) => members.sort((left, right) => left.localeCompare(right)));
  const sortedNodeIds = nodes.map((node) => node.id).sort((left, right) => left.localeCompare(right));
  const isSingleModule = moduleMembers.size === 1;

  return {
    nodes: nodes.map((node, index) => {
      const module = resolvedModules[index];
      const members = moduleMembers.get(module) || [node.id];
      const memberIndex = members.indexOf(node.id);
      const layerSpan = isSingleModule ? 84 : 22;
      const layerOffset = members.length <= 1
        ? 0
        : (memberIndex / (members.length - 1) - 0.5) * layerSpan;
      const zLayer = moduleDepth(module);
      const position = initialPosition(sortedNodeIds.indexOf(node.id));
      return {
        id: node.id,
        label: nodePresentationName(node, aliases),
        technicalName: node.label || node.local_name || node.qname,
        qname: node.qname,
        module,
        color: moduleColor(module),
        root: node.sub_class_of.length === 0,
        zLayer,
        x: position.x,
        y: position.y,
        z: zLayer + layerOffset,
        fz: zLayer + layerOffset,
      };
    }),
    links: edges.map((edge) => {
      const pairKey = [edge.source, edge.target].sort().join("::");
      const pairIndex = pairCounts.get(pairKey) || 0;
      pairCounts.set(pairKey, pairIndex + 1);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label:
          edge.edge_type === "subClassOf"
            ? "is a"
            : edge.bidirectional
              ? `${edge.label} ↔ ${edge.reverse_label || "反向关系"}`
              : edge.label,
        edgeType: edge.edge_type,
        inferred: edge.inferred,
        crossModule: Boolean(edge.cross_module),
        bidirectional: Boolean(edge.bidirectional),
        curvature: curveOffset(pairIndex),
        originalEdgeIds: edge.original_edge_ids || [edge.id],
      };
    }),
  };
}

export function threeEndpointId(endpoint: Ontology3DLink["source"]): string {
  return typeof endpoint === "object" ? endpoint.id : String(endpoint);
}
