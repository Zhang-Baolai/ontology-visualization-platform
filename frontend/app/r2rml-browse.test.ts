import { describe, expect, it } from "vitest";
import {
  buildLineageGraph,
  buildOverviewGraph,
  filterR2RMLMappings,
  groupR2RMLMappings,
} from "./r2rml-browse";
import type { R2RMLAnalysis, TriplesMap } from "./r2rml-types";

function mapping(id: string, table: string, className: string, options: { canonical?: boolean; join?: boolean; draft?: boolean } = {}): TriplesMap {
  return {
    id,
    uri: `urn:${id}`,
    qname: `ex:${id}`,
    name: id,
    file_id: options.draft ? "draft" : "main",
    source_file: options.draft ? "mappings/draft/offline.ttl" : "mappings/main.ttl",
    domain: "cloud-demo",
    draft: Boolean(options.draft),
    logical_table: { kind: "table", table_name: table },
    subject_map: { kind: "template", template: `${table}/{id}`, joins: [] },
    classes: [className],
    class_uris: [`urn:${className}`],
    canonical_iri_of: options.canonical ? "ex:canonical" : undefined,
    predicate_object_maps: options.canonical ? [] : [{
      id: `${id}-pom`,
      predicate: "ex:name",
      predicate_uri: "urn:name",
      predicate_local_name: "name",
      source_index: 0,
      object_map: options.join
        ? { kind: "parentTriplesMap", parent_triples_map: "ex:parent", joins: [{ child: "parent_id", parent: "id" }] }
        : { kind: "column", column: "name", value: "name", joins: [] },
    }],
  };
}

const mappings = [
  mapping("RegionMap", "cloud_region", "Region"),
  mapping("AzMap", "cloud_region", "AvailabilityZone", { join: true }),
  mapping("RegionCanonical", "cloud_region", "Region", { canonical: true }),
  mapping("DraftComputeMap", "compute_pool", "ComputePool", { draft: true }),
];

const analysis = {
  meta: {} as R2RMLAnalysis["meta"],
  files: [],
  mappings,
  issues: [{ id: "i1", severity: "warning", code: "TEST", message: "test", mapping_id: "AzMap" }],
  nodes: [
    { id: "table:region", type: "table", label: "cloud_region" },
    { id: "mapping:RegionMap", type: "triples-map", label: "RegionMap", mapping_id: "RegionMap" },
    { id: "class:region", type: "class", label: "Region", uri: "urn:Region" },
    { id: "property:name", type: "property", label: "name", uri: "urn:name" },
    { id: "column:name", type: "column", label: "name", table: "cloud_region" },
  ],
  edges: [
    { id: "e1", source: "table:region", target: "mapping:RegionMap", type: "logical-table", label: "逻辑表", mapping_id: "RegionMap" },
    { id: "e2", source: "mapping:RegionMap", target: "class:region", type: "class", label: "生成实体", mapping_id: "RegionMap" },
    { id: "e3", source: "mapping:RegionMap", target: "property:name", type: "predicate", label: "映射属性", mapping_id: "RegionMap" },
    { id: "e4", source: "column:name", target: "mapping:RegionMap", type: "column", label: "读取字段", mapping_id: "RegionMap" },
    { id: "e5", source: "column:name", target: "property:name", type: "column-property", label: "字段映射", mapping_id: "RegionMap" },
  ],
} as R2RMLAnalysis;

describe("R2RML progressive browsing", () => {
  it("filters by canonical, join and quality issue without mixing draft state", () => {
    expect(filterR2RMLMappings(analysis, { kind: "canonical" }).map((item) => item.id)).toEqual(["RegionCanonical"]);
    expect(filterR2RMLMappings(analysis, { joinsOnly: true }).map((item) => item.id)).toEqual(["AzMap"]);
    expect(filterR2RMLMappings(analysis, { issuesOnly: true }).map((item) => item.id)).toEqual(["AzMap"]);
    expect(filterR2RMLMappings(analysis, { fileId: "main" })).toHaveLength(3);
  });

  it("groups logical tables and aggregates counts for the overview", () => {
    const groups = groupR2RMLMappings(analysis, mappings, "logical-table");
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe("cloud_region");
    expect(groups[0].mappingCount).toBe(3);
    expect(groups[0].classCount).toBe(2);
    expect(groups[0].joinCount).toBe(1);
    const graph = buildOverviewGraph(groups.slice(0, 1));
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0].label).toBe("3 条映射");
  });

  it("keeps focus mode compact and expands field details only on demand", () => {
    const focus = buildLineageGraph(analysis, [mappings[0]], { detail: false });
    expect(focus.nodes.map((node) => node.type)).not.toContain("column");
    expect(focus.nodes.map((node) => node.type)).not.toContain("property");
    const detail = buildLineageGraph(analysis, [mappings[0]], { detail: true, showColumns: true });
    expect(detail.nodes.map((node) => node.type)).toContain("column");
    expect(detail.nodes.map((node) => node.type)).toContain("property");
  });
});
