import type {
  DataSourceMode,
  GraphEdge,
  GraphNode,
  OntologyCatalog,
  OntologyGraph,
} from "./ontology-types";

export interface GraphLoadOptions {
  source: DataSourceMode;
  baseUrl: string;
  domain: string;
  module: string;
  signal?: AbortSignal;
}

export function validateGraphResponse(data: unknown): data is OntologyGraph {
  if (!data || typeof data !== "object") return false;
  const candidate = data as Partial<OntologyGraph>;
  return Boolean(
    candidate.meta &&
      Array.isArray(candidate.nodes) &&
      Array.isArray(candidate.edges) &&
      Array.isArray(candidate.warnings),
  );
}

export async function loadOntologyGraph({
  source,
  baseUrl,
  domain,
  module,
  signal,
}: GraphLoadOptions): Promise<OntologyGraph> {
  const query = new URLSearchParams({ domain, module });
  const root = baseUrl.trim().replace(/\/$/, "");
  const url =
    source === "mock"
      ? "/mock/dimension_graph.json"
      : `${root}/api/v1/ontology/graph?${query.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error(
      "无法连接本体服务。请确认 FastAPI 已启动，并检查接口地址与 CORS 配置。",
    );
  }

  if (!response.ok) {
    let message = `本体服务返回 ${response.status}`;
    try {
      const body = (await response.json()) as {
        detail?: { message?: string } | string;
      };
      if (typeof body.detail === "string") message = body.detail;
      if (typeof body.detail === "object" && body.detail?.message) {
        message = body.detail.message;
      }
    } catch {
      // Keep the status-based message when the backend did not return JSON.
    }
    throw new Error(message);
  }

  const data: unknown = await response.json();
  if (!validateGraphResponse(data)) {
    throw new Error("接口响应缺少 meta、nodes、edges 或 warnings 字段。");
  }
  return data;
}

export async function loadOntologyCatalog(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<OntologyCatalog> {
  const root = baseUrl.trim().replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${root}/api/v1/ontology/catalog`, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("无法读取本体目录。请确认后端已在 8000 端口启动。");
  }

  if (!response.ok) {
    throw new Error(`本体目录接口返回 ${response.status}`);
  }

  const data = (await response.json()) as Partial<OntologyCatalog>;
  if (!Array.isArray(data.domains)) {
    throw new Error("目录接口响应缺少 domains 字段。");
  }
  return { domains: data.domains };
}

export function nodeDisplayName(node: GraphNode): string {
  return node.label || node.local_name || node.qname;
}

export function compactUri(value: string): string {
  const marker = Math.max(value.lastIndexOf("#"), value.lastIndexOf("/"));
  return marker >= 0 ? value.slice(marker + 1) : value;
}

export function nodeMatches(node: GraphNode, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return false;
  return [
    node.label,
    node.local_name,
    node.qname,
    node.comment,
    node.class_description,
    ...node.alt_labels,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase().includes(normalized));
}

export interface DisplayEdge extends GraphEdge {
  bidirectional?: boolean;
  reverse_label?: string;
  original_edge_ids?: string[];
}

export function collapseInverseEdges(edges: GraphEdge[]): DisplayEdge[] {
  const consumed = new Set<string>();
  const output: DisplayEdge[] = [];

  for (const edge of edges) {
    if (consumed.has(edge.id)) continue;

    if (edge.edge_type === "objectProperty" && edge.inverse_of) {
      const reverse = edges.find(
        (candidate) =>
          candidate.id !== edge.id &&
          candidate.edge_type === "objectProperty" &&
          candidate.source === edge.target &&
          candidate.target === edge.source &&
          candidate.predicate === edge.inverse_of,
      );

      if (reverse) {
        consumed.add(edge.id);
        consumed.add(reverse.id);
        output.push({
          ...edge,
          id: `inverse:${edge.id}`,
          bidirectional: true,
          reverse_label: reverse.label,
          original_edge_ids: [edge.id, reverse.id],
        });
        continue;
      }
    }

    consumed.add(edge.id);
    output.push(edge);
  }

  return output;
}
