import type { GraphEdge, GraphNode, OntologyGraph } from "./ontology-types";

export interface HierarchyEntry {
  id: string;
  label: string;
  qname: string;
  module: string;
  modules: string[];
  parent_ids: string[];
  child_ids: string[];
  property_count: number;
}

export interface HierarchyResponse {
  domain: string;
  root_ids: string[];
  entries: HierarchyEntry[];
  total_roots: number;
  total_entries: number;
}

export type QualitySeverity = "error" | "warning" | "info";

export interface QualityIssue {
  id: string;
  severity: QualitySeverity;
  code: string;
  message: string;
  subject: string;
  related?: string;
  module: string;
  focus_entity?: string;
}

export interface QualityReport {
  domain: string;
  summary: {
    error: number;
    warning: number;
    info: number;
    total: number;
    score: number;
    passed: boolean;
  };
  issues: QualityIssue[];
}

export interface PathResponse {
  domain: string;
  found: boolean;
  directed: boolean;
  hops: number | null;
  node_ids: string[];
  edge_ids: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ImpactReference {
  kind: string;
  subject: string;
  predicate: string;
  object: string;
  module: string;
  cross_module: boolean;
}

export interface ImpactReport {
  domain: string;
  entity: { id: string; label: string; qname: string; module: string };
  summary: {
    total_references: number;
    cross_module_references: number;
    by_kind: Record<string, number>;
    risk: "low" | "medium" | "high";
  };
  references: ImpactReference[];
}

async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("无法连接语义分析服务，请确认后端已经启动。");
  }
  if (!response.ok) {
    let message = `语义分析接口返回 ${response.status}`;
    try {
      const body = (await response.json()) as {
        detail?: { message?: string } | string;
      };
      if (typeof body.detail === "string") message = body.detail;
      if (typeof body.detail === "object" && body.detail?.message) {
        message = body.detail.message;
      }
    } catch {
      // Retain the status message for non-JSON responses.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function endpoint(baseUrl: string, path: string, query: Record<string, string>) {
  const root = baseUrl.trim().replace(/\/$/, "");
  return `${root}/api/v1/ontology/analysis/${path}?${new URLSearchParams(query)}`;
}

export function loadSemanticGraph(
  baseUrl: string,
  domain: string,
  signal?: AbortSignal,
): Promise<OntologyGraph> {
  return requestJson(endpoint(baseUrl, "graph", { domain }), signal);
}

export function loadHierarchy(
  baseUrl: string,
  domain: string,
  signal?: AbortSignal,
): Promise<HierarchyResponse> {
  return requestJson(endpoint(baseUrl, "hierarchy", { domain }), signal);
}

export function loadQualityReport(
  baseUrl: string,
  domain: string,
  signal?: AbortSignal,
): Promise<QualityReport> {
  return requestJson(endpoint(baseUrl, "quality", { domain }), signal);
}

export function loadShortestPath(
  baseUrl: string,
  domain: string,
  sourceUri: string,
  targetUri: string,
  directed = false,
  signal?: AbortSignal,
): Promise<PathResponse> {
  return requestJson(
    endpoint(baseUrl, "path", {
      domain,
      source_uri: sourceUri,
      target_uri: targetUri,
      directed: String(directed),
    }),
    signal,
  );
}

export function loadImpactReport(
  baseUrl: string,
  domain: string,
  entityUri: string,
  signal?: AbortSignal,
): Promise<ImpactReport> {
  return requestJson(
    endpoint(baseUrl, "impact", { domain, entity_uri: entityUri }),
    signal,
  );
}
