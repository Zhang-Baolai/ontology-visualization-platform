import { describe, expect, it } from "vitest";
import {
  loadNodeAliases,
  NODE_ALIAS_STORAGE_KEY,
  nodeMatchesPresentation,
  nodePresentationName,
  normalizeNodeAlias,
  persistNodeAliases,
  updateNodeAlias,
} from "./ontology-aliases";
import type { GraphNode } from "./ontology-types";

const node = {
  id: "urn:test:CloudResourcePool",
  local_name: "CloudResourcePool",
  qname: "cloud-demo:CloudResourcePool",
  type: "Class",
  label: "Cloud Resource Pool",
  alt_labels: [],
  sub_class_of: [],
  has_key: [],
  datatype_properties: [],
  object_properties: [],
} satisfies GraphNode;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) || null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("node aliases", () => {
  it("normalizes, saves and removes aliases without changing the graph node", () => {
    const original = structuredClone(node);
    const aliases = updateNodeAlias({}, node.id, "  云资源池  ");
    expect(aliases[node.id]).toBe("云资源池");
    expect(node).toEqual(original);
    expect(updateNodeAlias(aliases, node.id, "")).toEqual({});
    expect(normalizeNodeAlias("  云   资源池 ")).toBe("云 资源池");
  });

  it("persists aliases only through the supplied browser storage", () => {
    const storage = memoryStorage();
    persistNodeAliases(storage, { [node.id]: "业务资源池" });
    expect(storage.getItem(NODE_ALIAS_STORAGE_KEY)).toContain("业务资源池");
    expect(loadNodeAliases(storage)).toEqual({ [node.id]: "业务资源池" });
  });

  it("uses aliases for display and search while retaining technical-name search", () => {
    const aliases = { [node.id]: "业务资源池" };
    expect(nodePresentationName(node, aliases)).toBe("业务资源池");
    expect(nodeMatchesPresentation(node, aliases, "业务")).toBe(true);
    expect(nodeMatchesPresentation(node, aliases, "CloudResourcePool")).toBe(true);
    expect(nodePresentationName(node, {})).toBe("Cloud Resource Pool");
  });
});
