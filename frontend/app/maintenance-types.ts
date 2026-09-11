import type { GraphNode, OntologyGraph } from "./ontology-types";

export type MaintenanceTab = "edit" | "import" | "export" | "history";
export type EntityType = "class" | "datatype_property" | "object_property";
export type EditAction = "upsert" | "delete";

export interface OntologySourceSnapshot {
  domain: string;
  module: string;
  source_file: string;
  content: string;
  content_hash: string;
  size_bytes: number;
  modified_at: string;
  writable: boolean;
}

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  subject?: string | null;
  related?: string | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
  summary: {
    classes: number;
    datatype_properties: number;
    object_properties: number;
    triples: number;
  };
  size_bytes: number;
}

export interface EditOperation {
  action: EditAction;
  entity_type: EntityType;
  uri: string;
  label?: string;
  comment?: string;
  parent_uris?: string[];
  has_key_uris?: string[];
  domain_uris?: string[];
  range_uris?: string[];
  sub_property_of?: string[];
  inverse_of?: string;
  is_functional?: boolean;
}

export interface ChangePreview {
  domain: string;
  module: string;
  source_file: string;
  base_hash: string | null;
  draft_hash: string;
  conflict: boolean;
  validation: ValidationResult;
  diff: {
    added_triples: number;
    removed_triples: number;
    unchanged_triples: number;
    lines: string[];
  };
  content: string;
  create_new: boolean;
  impacts?: Array<{
    action: string;
    uri: string;
    owned_triples: number;
    reference_triples: number;
    message: string;
  }>;
}

export interface OntologyVersion {
  id: string;
  created_at: string;
  reason: string;
  content_hash: string;
  size_bytes: number;
  source_file: string;
}

export interface VersionList {
  domain: string;
  module: string;
  current_hash: string;
  versions: OntologyVersion[];
}

export interface MaintenanceDrawerProps {
  open: boolean;
  onClose: () => void;
  baseUrl: string;
  domain: string;
  module: string;
  graph: OntologyGraph | null;
  selectedNode: GraphNode | null;
  onSaved: () => Promise<void> | void;
  onExportView: (format: "png" | "svg" | "json") => void;
}
