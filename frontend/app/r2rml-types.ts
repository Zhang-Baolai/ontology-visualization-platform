export interface R2RMLMeta {
  analysis_mode: "offline-r2rml";
  database_connected: false;
  sql_executed: false;
  domain: string;
  include_drafts: boolean;
  total_files: number;
  total_triples_maps: number;
  total_tables: number;
  total_sql_queries: number;
  total_columns: number;
  total_classes: number;
  total_properties: number;
  total_joins: number;
  total_nodes: number;
  total_edges: number;
  total_issues: number;
  quality: { errors: number; warnings: number; info: number };
  parsed_at: string;
}

export interface R2RMLFile {
  id: string;
  domain: string;
  path: string;
  name: string;
  size_bytes: number;
  sha256: string;
  draft: boolean;
  triples_maps: number;
  table_names: number;
  sql_queries: number;
  joins: number;
}

export interface R2RMLTermMap {
  kind: "column" | "template" | "constant" | "parentTriplesMap" | "unknown";
  value?: string;
  column?: string;
  template?: string;
  constant?: string;
  parent_triples_map?: string;
  parent_triples_map_uri?: string;
  datatype?: string;
  term_type?: string;
  language?: string;
  joins: { child?: string; parent?: string }[];
}

export interface PredicateObjectMap {
  id: string;
  predicate?: string;
  predicate_uri?: string;
  predicate_local_name: string;
  object_map: R2RMLTermMap;
  source_index: number;
}

export interface TriplesMap {
  id: string;
  uri: string;
  qname: string;
  name: string;
  file_id: string;
  source_file: string;
  domain: string;
  draft: boolean;
  logical_table: {
    uri?: string;
    kind: "table" | "sql" | "unknown";
    table_name?: string;
    sql_query?: string;
  };
  subject_map: R2RMLTermMap;
  classes: string[];
  class_uris: string[];
  canonical_iri_of?: string;
  predicate_object_maps: PredicateObjectMap[];
}

export interface LineageNode {
  id: string;
  type: "table" | "sql" | "column" | "triples-map" | "class" | "property" | "template";
  label: string;
  uri?: string;
  mapping_id?: string;
  table?: string;
  datatype?: string;
  term_type?: string;
  draft?: boolean;
  source_file?: string;
}

export interface LineageEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  mapping_id: string;
}

export interface MappingIssue {
  id: string;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  mapping_id?: string;
  mapping_name?: string;
  entity_uri?: string;
  source_file?: string;
}

export interface R2RMLAnalysis {
  meta: R2RMLMeta;
  files: R2RMLFile[];
  mappings: TriplesMap[];
  nodes: LineageNode[];
  edges: LineageEdge[];
  issues: MappingIssue[];
}
