import { mappingMatches } from "./r2rml-analysis";
import type { LineageEdge, LineageNode, MappingIssue, R2RMLAnalysis, TriplesMap } from "./r2rml-types";

export type MappingGroupBy = "logical-table" | "class" | "file" | "kind";
export type MappingKindFilter = "all" | "regular" | "canonical";

export interface MappingFilters {
  fileId?: string;
  query?: string;
  kind?: MappingKindFilter;
  joinsOnly?: boolean;
  issuesOnly?: boolean;
}

export interface MappingGroup {
  id: string;
  key: string;
  label: string;
  subtitle: string;
  kind: MappingGroupBy;
  mappingIds: string[];
  mappingCount: number;
  classCount: number;
  propertyCount: number;
  joinCount: number;
  issueCount: number;
  draft: boolean;
}

export interface BrowseNode extends Omit<LineageNode, "type"> {
  type: LineageNode["type"] | "group-source" | "group-mapping" | "ontology-summary";
  group_id?: string;
  count?: number;
}

export interface BrowseEdge extends LineageEdge {
  count?: number;
}

export interface BrowseGraph {
  nodes: BrowseNode[];
  edges: BrowseEdge[];
  mappingIds: string[];
}

function compact(value: string): string {
  const match = value.match(/([^#/]+)[#/]?$/);
  return match?.[1] || value;
}

function hasJoin(mapping: TriplesMap): boolean {
  return mapping.predicate_object_maps.some((pom) =>
    Boolean(pom.object_map.parent_triples_map) || pom.object_map.joins.length > 0,
  );
}

export function filterR2RMLMappings(
  analysis: R2RMLAnalysis,
  filters: MappingFilters,
): TriplesMap[] {
  const issueMappingIds = new Set(analysis.issues.flatMap((issue) => issue.mapping_id ? [issue.mapping_id] : []));
  return analysis.mappings.filter((mapping) => {
    if (filters.fileId && filters.fileId !== "all" && mapping.file_id !== filters.fileId) return false;
    if (!mappingMatches(mapping, filters.query || "")) return false;
    if (filters.kind === "canonical" && !mapping.canonical_iri_of) return false;
    if (filters.kind === "regular" && mapping.canonical_iri_of) return false;
    if (filters.joinsOnly && !hasJoin(mapping)) return false;
    if (filters.issuesOnly && !issueMappingIds.has(mapping.id)) return false;
    return true;
  });
}

function groupEntries(mapping: TriplesMap, groupBy: MappingGroupBy): Array<{ key: string; label: string; subtitle: string }> {
  if (groupBy === "file") {
    return [{ key: mapping.file_id, label: mapping.source_file.split(/[\\/]/).pop() || mapping.source_file, subtitle: mapping.domain }];
  }
  if (groupBy === "class") {
    const values = mapping.classes.length ? mapping.classes : ["未声明本体类"];
    return values.map((value, index) => ({
      key: mapping.class_uris[index] || value,
      label: compact(value),
      subtitle: "本体类",
    }));
  }
  if (groupBy === "kind") {
    return mapping.canonical_iri_of
      ? [{ key: "canonical", label: "Canonical IRI", subtitle: "规范 IRI 声明" }]
      : [{ key: "regular", label: "常规映射", subtitle: "PredicateObjectMap" }];
  }
  const value = mapping.logical_table.table_name || mapping.logical_table.sql_query || "未声明逻辑表";
  return [{
    key: `${mapping.file_id}|${value}`,
    label: mapping.logical_table.table_name || "SQL logical table",
    subtitle: mapping.logical_table.kind === "sql" ? "rr:sqlQuery" : mapping.domain,
  }];
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function groupR2RMLMappings(
  analysis: R2RMLAnalysis,
  mappings: TriplesMap[],
  groupBy: MappingGroupBy,
): MappingGroup[] {
  const buckets = new Map<string, { label: string; subtitle: string; mappings: TriplesMap[] }>();
  for (const mapping of mappings) {
    for (const entry of groupEntries(mapping, groupBy)) {
      const bucket = buckets.get(entry.key) || { label: entry.label, subtitle: entry.subtitle, mappings: [] };
      if (!bucket.mappings.some((item) => item.id === mapping.id)) bucket.mappings.push(mapping);
      buckets.set(entry.key, bucket);
    }
  }
  const issuesByMapping = new Map<string, MappingIssue[]>();
  for (const issue of analysis.issues) {
    if (!issue.mapping_id) continue;
    issuesByMapping.set(issue.mapping_id, [...(issuesByMapping.get(issue.mapping_id) || []), issue]);
  }
  return [...buckets.entries()].map(([key, bucket]) => {
    const classes = new Set(bucket.mappings.flatMap((mapping) => mapping.class_uris.length ? mapping.class_uris : mapping.classes));
    const properties = new Set(bucket.mappings.flatMap((mapping) => mapping.predicate_object_maps.map((pom) => pom.predicate_uri || pom.predicate || pom.predicate_local_name)));
    const joins = bucket.mappings.reduce((total, mapping) => total + mapping.predicate_object_maps.reduce(
      (subtotal, pom) => subtotal + pom.object_map.joins.length + (pom.object_map.parent_triples_map && !pom.object_map.joins.length ? 1 : 0),
      0,
    ), 0);
    const issueCount = bucket.mappings.reduce((total, mapping) => total + (issuesByMapping.get(mapping.id)?.length || 0), 0);
    return {
      id: `group:${groupBy}:${stableId(key)}`,
      key,
      label: bucket.label,
      subtitle: bucket.subtitle,
      kind: groupBy,
      mappingIds: bucket.mappings.map((mapping) => mapping.id),
      mappingCount: bucket.mappings.length,
      classCount: classes.size,
      propertyCount: properties.size,
      joinCount: joins,
      issueCount,
      draft: bucket.mappings.some((mapping) => mapping.draft),
    };
  }).sort((left, right) => right.mappingCount - left.mappingCount || left.label.localeCompare(right.label, "zh-CN"));
}

export function buildOverviewGraph(groups: MappingGroup[]): BrowseGraph {
  const nodes: BrowseNode[] = [];
  const edges: BrowseEdge[] = [];
  const mappingIds = new Set<string>();
  for (const group of groups) {
    group.mappingIds.forEach((id) => mappingIds.add(id));
    const sourceId = `overview:source:${group.id}`;
    const mappingId = `overview:mapping:${group.id}`;
    const ontologyId = `overview:ontology:${group.id}`;
    nodes.push(
      { id: sourceId, type: "group-source", label: group.label, group_id: group.id, draft: group.draft, count: group.mappingCount },
      { id: mappingId, type: "group-mapping", label: `${group.mappingCount} 个 TriplesMap`, group_id: group.id, draft: group.draft, count: group.mappingCount },
      { id: ontologyId, type: "ontology-summary", label: `${group.classCount} 类 · ${group.propertyCount} 属性`, group_id: group.id, draft: group.draft, count: group.propertyCount },
    );
    edges.push(
      { id: `overview:e1:${group.id}`, source: sourceId, target: mappingId, type: "aggregate-input", label: `${group.mappingCount} 条映射`, mapping_id: group.mappingIds[0] || "", count: group.mappingCount },
      { id: `overview:e2:${group.id}`, source: mappingId, target: ontologyId, type: "aggregate-output", label: `${group.propertyCount} 条输出`, mapping_id: group.mappingIds[0] || "", count: group.propertyCount },
    );
  }
  return { nodes, edges, mappingIds: [...mappingIds] };
}

function mergeEdges(edges: LineageEdge[]): BrowseEdge[] {
  const merged = new Map<string, BrowseEdge>();
  for (const edge of edges) {
    const key = `${edge.source}|${edge.target}|${edge.type}`;
    const current = merged.get(key);
    if (current) {
      current.count = (current.count || 1) + 1;
      current.label = `${current.count} 条 ${edge.label}`;
    } else {
      merged.set(key, { ...edge, count: 1 });
    }
  }
  return [...merged.values()];
}

export function buildLineageGraph(
  analysis: R2RMLAnalysis,
  mappings: TriplesMap[],
  options: { detail?: boolean; showColumns?: boolean; showJoins?: boolean } = {},
): BrowseGraph {
  const mappingIds = new Set(mappings.map((mapping) => mapping.id));
  const allowedTypes = options.detail
    ? new Set(["logical-table", "class", "predicate", "object-template", ...(options.showColumns ? ["column", "column-property"] : []), ...(options.showJoins ? ["parent-triples-map"] : [])])
    : new Set(["logical-table", "class", ...(options.showJoins ? ["parent-triples-map"] : [])]);
  const edges = analysis.edges.filter((edge) => mappingIds.has(edge.mapping_id) && allowedTypes.has(edge.type));
  const nodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  for (const mapping of mappings) nodeIds.add(`mapping:${mapping.id}`);
  const nodes = analysis.nodes.filter((node) => nodeIds.has(node.id));
  return { nodes, edges: mergeEdges(edges), mappingIds: [...mappingIds] };
}

export function estimateDetailedNodeCount(
  analysis: R2RMLAnalysis,
  mappings: TriplesMap[],
  options: { showColumns?: boolean; showJoins?: boolean } = {},
): number {
  return buildLineageGraph(analysis, mappings, { detail: true, ...options }).nodes.length;
}
