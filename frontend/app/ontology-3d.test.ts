import { describe, expect, it } from "vitest";
import { buildOntology3DData, moduleColor, moduleDepth, threeEndpointId } from "./ontology-3d";
import type { DisplayEdge } from "./ontology-data";
import type { GraphNode } from "./ontology-types";

const node = (id: string, parent = false): GraphNode => ({
  id,
  local_name: id,
  qname: `cloud-demo:${id}`,
  type: "Class",
  alt_labels: [],
  sub_class_of: parent ? ["Root"] : [],
  has_key: [],
  datatype_properties: [],
  object_properties: [],
  module: "dimension",
});

const edge = (id: string): DisplayEdge => ({
  id,
  source: "Root",
  target: "Pool",
  label: "contains",
  edge_type: "objectProperty",
  sub_property_of: [],
  declared: true,
  inferred: false,
});

describe("3D ontology adapter", () => {
  it("maps aliases onto cloned 3D nodes without mutating ontology data", () => {
    const nodes = [node("Root"), node("Pool", true)];
    const original = structuredClone(nodes);
    const data = buildOntology3DData(nodes, [edge("e1")], { Pool: "业务资源池" });
    expect(data.nodes[1].label).toBe("业务资源池");
    expect(data.nodes[1].qname).toBe("cloud-demo:Pool");
    expect(data.nodes[0].z).toBe(-54);
    expect(data.nodes[1].z).toBe(-138);
    expect(data.nodes[1].fz).toBe(-138);
    expect(data.nodes[0].x).not.toBe(data.nodes[1].x);
    expect(nodes).toEqual(original);
  });

  it("uses the active module as display metadata when API nodes omit module", () => {
    const nodes = [node("Root"), node("Pool", true)].map((item) => ({ ...item, module: undefined }));
    const data = buildOntology3DData(nodes, [edge("e1")], {}, "dimension");
    expect(data.nodes.every((item) => item.module === "dimension")).toBe(true);
    expect(data.nodes.every((item) => item.color === moduleColor("dimension"))).toBe(true);
  });

  it("separates parallel 3D relations with deterministic curvature", () => {
    const data = buildOntology3DData(
      [node("Root"), node("Pool", true)],
      [edge("e1"), edge("e2"), edge("e3")],
      {},
    );
    expect(data.links.map((link) => link.curvature)).toEqual([0, 0.12, -0.12]);
    expect(threeEndpointId(data.links[0].source)).toBe("Root");
    expect(threeEndpointId(data.nodes[0])).toBe("Root");
  });

  it("places ontology modules on stable semantic depth layers", () => {
    expect(moduleDepth("dimension")).toBe(-96);
    expect(moduleDepth("metric")).toBe(-32);
    expect(moduleDepth("capability")).toBe(32);
    expect(moduleDepth("scenario")).toBe(96);
    expect(moduleDepth("custom")).toBe(moduleDepth("custom"));
  });

  it("adds stable intra-module depth so a single-module graph is genuinely spatial", () => {
    const nodes = [node("Root"), node("Pool", true), node("Region", true)];
    const first = buildOntology3DData(nodes, [edge("e1")], {});
    const second = buildOntology3DData([...nodes].reverse(), [edge("e1")], {});
    const firstDepths = Object.fromEntries(first.nodes.map((item) => [item.id, item.z]));
    const secondDepths = Object.fromEntries(second.nodes.map((item) => [item.id, item.z]));
    expect(new Set(Object.values(firstDepths)).size).toBe(3);
    expect(secondDepths).toEqual(firstDepths);
  });
});
