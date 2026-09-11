import { describe, expect, it, vi } from "vitest";
import {
  collapseInverseEdges,
  compactUri,
  nodeMatches,
  loadOntologyCatalog,
  validateGraphResponse,
} from "./ontology-data";
import type { GraphEdge, GraphNode } from "./ontology-types";

const sampleNode: GraphNode = {
  id: "http://example.com/ontology/voc#ComputeResourcePool",
  local_name: "ComputeResourcePool",
  qname: "voc:ComputeResourcePool",
  type: "class",
  label: "Compute资源池",
  comment: "Compute计算资源池",
  alt_labels: ["计算资源池"],
  sub_class_of: ["http://example.com/ontology/voc#ResourcePool"],
  has_key: [],
  datatype_properties: [],
  object_properties: [],
};

function edge(overrides: Partial<GraphEdge>): GraphEdge {
  return {
    id: "edge",
    source: "A",
    target: "B",
    label: "包含",
    edge_type: "objectProperty",
    sub_property_of: [],
    declared: true,
    inferred: false,
    ...overrides,
  };
}

describe("ontology graph adapter helpers", () => {
  it("validates the FastAPI top-level response contract", () => {
    expect(
      validateGraphResponse({ meta: {}, nodes: [], edges: [], warnings: [] }),
    ).toBe(true);
    expect(validateGraphResponse({ nodes: [], edges: [] })).toBe(false);
  });

  it("matches localized labels, QName and descriptions", () => {
    expect(nodeMatches(sampleNode, "Compute资源池")).toBe(true);
    expect(nodeMatches(sampleNode, "voc:computeresourcepool")).toBe(true);
    expect(nodeMatches(sampleNode, "计算资源")).toBe(true);
    expect(nodeMatches(sampleNode, "Storage")).toBe(false);
  });

  it("compacts hash and slash URIs", () => {
    expect(compactUri("http://example.com/voc#Region")).toBe("Region");
    expect(compactUri("http://example.com/voc/Region")).toBe("Region");
  });

  it("collapses a declared inverse pair without removing other edges", () => {
    const forward = edge({
      id: "forward",
      predicate: "hasPart",
      inverse_of: "partOf",
    });
    const reverse = edge({
      id: "reverse",
      source: "B",
      target: "A",
      predicate: "partOf",
      inverse_of: "hasPart",
      label: "属于",
    });
    const subclass = edge({
      id: "subclass",
      edge_type: "subClassOf",
      inverse_of: undefined,
    });

    const collapsed = collapseInverseEdges([forward, reverse, subclass]);

    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]).toMatchObject({
      bidirectional: true,
      reverse_label: "属于",
      original_edge_ids: ["forward", "reverse"],
    });
    expect(collapsed[1].id).toBe("subclass");
  });
});

describe("loadOntologyCatalog", () => {
  it("loads the domain/module catalog", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        domains: [
          {
            id: "cloud-demo",
            label: "Cloud Demo",
            modules: [
              {
                id: "dimension",
                label: "维度本体",
                source_file: "ontologies/cloud-demo/core/dimension_ontology.ttl",
                include_imports: false,
              },
            ],
          },
        ],
      }),
    }) as typeof fetch;

    const catalog = await loadOntologyCatalog("http://127.0.0.1:8000/");
    expect(catalog.domains[0].modules[0].id).toBe("dimension");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/ontology/catalog",
      { signal: undefined },
    );
    globalThis.fetch = originalFetch;
  });
});
