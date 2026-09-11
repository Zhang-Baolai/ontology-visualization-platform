import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadQualityReport,
  loadSemanticGraph,
  loadShortestPath,
} from "./semantic-analysis";


afterEach(() => vi.restoreAllMocks());

describe("semantic analysis client", () => {
  it("loads a domain graph from the analysis endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ meta: {}, nodes: [], edges: [], warnings: [] })),
    );
    await loadSemanticGraph("http://127.0.0.1:8000/", "cloud-demo");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/ontology/analysis/graph?domain=cloud-demo",
      { signal: undefined },
    );
  });

  it("encodes both path endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ found: false, nodes: [], edges: [] })),
    );
    await loadShortestPath("http://api", "cloud-demo", "https://a/#A", "https://a/#B");
    expect(String(fetchMock.mock.calls[0][0])).toContain("source_uri=https%3A%2F%2Fa%2F%23A");
    expect(String(fetchMock.mock.calls[0][0])).toContain("target_uri=https%3A%2F%2Fa%2F%23B");
  });

  it("surfaces controlled backend errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: { message: "质量分析失败" } }), {
        status: 500,
      }),
    );
    await expect(loadQualityReport("http://api", "cloud-demo")).rejects.toThrow(
      "质量分析失败",
    );
  });
});
