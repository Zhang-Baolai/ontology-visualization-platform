import { describe, expect, it } from "vitest";
import { collectNeighborhood, graphNodeColor, graphNodeGlyph } from "./ontology-visual";
import type { GraphNode } from "./ontology-types";

function node(overrides: Partial<GraphNode>): GraphNode {
  return {
    id: "urn:test:node",
    local_name: "Node",
    qname: "test:Node",
    type: "class",
    alt_labels: [],
    sub_class_of: [],
    has_key: [],
    datatype_properties: [],
    object_properties: [],
    ...overrides,
  };
}

describe("ontology playground visual helpers", () => {
  it("keeps entity colours stable and assigns semantic glyphs", () => {
    const resourcePool = node({ label: "Compute资源池", qname: "smart:EcsPool" });
    expect(graphNodeColor(resourcePool)).toBe(graphNodeColor(resourcePool));
    expect(graphNodeGlyph(resourcePool)).toBe("◉");
    expect(graphNodeGlyph(node({ label: "Region", qname: "smart:Region" }))).toBe("◎");
  });

  it("collects one-hop and two-hop context without removing the full graph", () => {
    const edges = [
      { id: "ab", source: "A", target: "B" },
      { id: "bc", source: "B", target: "C" },
      { id: "de", source: "D", target: "E" },
    ];
    expect([...collectNeighborhood("A", edges, 1).nodeIds].sort()).toEqual(["A", "B"]);
    expect([...collectNeighborhood("A", edges, 2).nodeIds].sort()).toEqual(["A", "B", "C"]);
  });
});
