import type { LineageEdge, LineageNode, R2RMLAnalysis, TriplesMap } from "./r2rml-types";

export async function loadR2RMLAnalysis(
  baseUrl: string,
  options: { domain?: string; includeDrafts?: boolean; refresh?: boolean; signal?: AbortSignal } = {},
): Promise<R2RMLAnalysis> {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/v1/mappings/analysis`);
  if (options.domain && options.domain !== "all") url.searchParams.set("domain", options.domain);
  url.searchParams.set("include_drafts", String(Boolean(options.includeDrafts)));
  if (options.refresh) url.searchParams.set("refresh", "true");
  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) {
    let message = `R2RML 映射加载失败（HTTP ${response.status}）`;
    try {
      const payload = await response.json();
      if (payload.detail) message = String(payload.detail);
    } catch {
      // Keep the HTTP fallback.
    }
    throw new Error(message);
  }
  return response.json() as Promise<R2RMLAnalysis>;
}

export function mappingMatches(mapping: TriplesMap, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const values = [
    mapping.name,
    mapping.qname,
    mapping.logical_table.table_name,
    mapping.logical_table.sql_query,
    mapping.subject_map.template,
    ...mapping.classes,
    ...mapping.predicate_object_maps.flatMap((pom) => [
      pom.predicate,
      pom.predicate_local_name,
      pom.object_map.column,
      pom.object_map.template,
      pom.object_map.parent_triples_map,
    ]),
  ];
  return values.some((value) => String(value || "").toLocaleLowerCase().includes(normalized));
}

export function selectLineageSubgraph(
  analysis: R2RMLAnalysis,
  options: { fileId?: string; query?: string; selectedMappingId?: string; showColumns?: boolean },
): { nodes: LineageNode[]; edges: LineageEdge[]; mappings: TriplesMap[] } {
  const matchingMappings = analysis.mappings.filter((mapping) => {
    if (options.fileId && options.fileId !== "all" && mapping.file_id !== options.fileId) return false;
    if (options.selectedMappingId && mapping.id !== options.selectedMappingId) return false;
    return mappingMatches(mapping, options.query || "");
  });
  const mappingIds = new Set(matchingMappings.map((mapping) => mapping.id));
  const edges = analysis.edges.filter(
    (edge) => mappingIds.has(edge.mapping_id) && (options.showColumns !== false || !["column", "column-property"].includes(edge.type)),
  );
  const nodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const nodes = analysis.nodes.filter(
    (node) => nodeIds.has(node.id) && (options.showColumns !== false || node.type !== "column"),
  );
  return { nodes, edges, mappings: matchingMappings };
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function mappingsToCsv(mappings: TriplesMap[]): string {
  const rows = [[
    "domain", "source_file", "draft", "triples_map", "logical_table", "subject_template",
    "class", "predicate", "object_kind", "object_value", "datatype", "parent_triples_map", "join_condition",
  ]];
  for (const mapping of mappings) {
    const poms = mapping.predicate_object_maps.length ? mapping.predicate_object_maps : [null];
    for (const pom of poms) {
      rows.push([
        mapping.domain,
        mapping.source_file,
        String(mapping.draft),
        mapping.name,
        mapping.logical_table.table_name || mapping.logical_table.sql_query || "",
        mapping.subject_map.template || mapping.subject_map.column || "",
        mapping.classes.join(" | "),
        pom?.predicate || "",
        pom?.object_map.kind || "",
        pom?.object_map.value || "",
        pom?.object_map.datatype || "",
        pom?.object_map.parent_triples_map || "",
        pom?.object_map.joins.map((join) => `${join.child}=${join.parent}`).join(" | ") || "",
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
