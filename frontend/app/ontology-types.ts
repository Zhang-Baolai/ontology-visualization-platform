export interface GraphMeta {
  domain?: string;
  module?: string;
  source_file: string;
  source_files?: string[];
  ontology_iri?: string;
  ontology_label?: string;
  ontology_comment?: string;
  total_classes: number;
  total_datatype_properties: number;
  total_object_properties: number;
  total_nodes: number;
  total_edges: number;
  total_declared_edges: number;
  total_inferred_edges: number;
  total_warnings: number;
  parsed_at: string;
  analysis_mode?: string;
  module_counts?: Record<string, number>;
  total_cross_module_edges?: number;
  recommended_render_mode?: "full" | "filtered" | "neighborhood";
}

export interface DatatypePropertyInfo {
  uri: string;
  local_name: string;
  qname: string;
  label?: string;
  comment?: string;
  range: string[];
  is_functional: boolean;
  sub_property_of: string[];
}

export interface ObjectPropertyInfo {
  uri: string;
  local_name: string;
  qname: string;
  label?: string;
  comment?: string;
  range: string[];
  sub_property_of: string[];
  inverse_of?: string;
}

export interface GraphNode {
  id: string;
  local_name: string;
  qname: string;
  type: string;
  label?: string;
  comment?: string;
  class_description?: string;
  alt_labels: string[];
  sub_class_of: string[];
  has_key: string[];
  datatype_properties: DatatypePropertyInfo[];
  object_properties: ObjectPropertyInfo[];
  module?: string;
  modules?: string[];
  distance?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  edge_type: string;
  predicate?: string;
  inverse_of?: string;
  sub_property_of: string[];
  declared: boolean;
  inferred: boolean;
  inference_reason?: string;
  module?: string;
  source_modules?: string[];
  target_modules?: string[];
  cross_module?: boolean;
}

export interface ParseWarning {
  code: string;
  message: string;
  subject: string;
  line?: number;
}

export interface OntologyGraph {
  meta: GraphMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: ParseWarning[];
}

export interface CatalogModule {
  id: string;
  label: string;
  source_file: string;
  include_imports: boolean;
}

export interface CatalogDomain {
  id: string;
  label: string;
  modules: CatalogModule[];
}

export interface OntologyCatalog {
  domains: CatalogDomain[];
}

export type DataSourceMode = "mock" | "api";
export type LayoutName = "hierarchy" | "force" | "circle";
export type InspectorTab = "overview" | "properties" | "relations" | "impact";
