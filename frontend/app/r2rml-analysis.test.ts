import { describe, expect, it } from "vitest";
import { mappingMatches, mappingsToCsv, selectLineageSubgraph } from "./r2rml-analysis";
import type { R2RMLAnalysis, TriplesMap } from "./r2rml-types";

const mapping: TriplesMap = {
  id: "m1", uri: "urn:m1", qname: "ex:m1", name: "RegionMapping", file_id: "f1",
  source_file: "ontologies/cloud-demo/mappings/obda_mappings.r2rml.ttl", domain: "cloud-demo", draft: false,
  logical_table: { kind: "table", table_name: "demo.cloud_region" },
  subject_map: { kind: "template", value: "region:{region_id}", template: "region:{region_id}", joins: [] },
  classes: ["voc:Region"], class_uris: ["urn:Region"],
  predicate_object_maps: [{
    id: "p1", predicate: "voc:regionId", predicate_local_name: "regionId", source_index: 0,
    object_map: { kind: "column", value: "region_id", column: "region_id", joins: [] },
  }],
};

const analysis = {
  meta: {} as R2RMLAnalysis["meta"], files: [], mappings: [mapping], issues: [],
  nodes: [
    { id: "table", type: "table", label: "table" },
    { id: "map", type: "triples-map", label: "RegionMapping", mapping_id: "m1" },
    { id: "column", type: "column", label: "region_id" },
  ],
  edges: [
    { id: "e1", source: "table", target: "map", type: "logical-table", label: "逻辑表", mapping_id: "m1" },
    { id: "e2", source: "column", target: "map", type: "column", label: "读取字段", mapping_id: "m1" },
  ],
} as R2RMLAnalysis;

describe("R2RML analysis helpers", () => {
  it("searches across table, template, class, predicate and column", () => {
    expect(mappingMatches(mapping, "cloud_region")).toBe(true);
    expect(mappingMatches(mapping, "region_id")).toBe(true);
    expect(mappingMatches(mapping, "missing")).toBe(false);
  });

  it("filters the lineage graph and can hide physical columns", () => {
    const graph = selectLineageSubgraph(analysis, { fileId: "f1", showColumns: false });
    expect(graph.nodes.map((node) => node.id)).toEqual(["table", "map"]);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["e1"]);
  });

  it("exports one row per predicate-object mapping", () => {
    const csv = mappingsToCsv([mapping]);
    expect(csv).toContain("RegionMapping");
    expect(csv).toContain("region_id");
    expect(csv).toContain("voc:regionId");
  });
});
