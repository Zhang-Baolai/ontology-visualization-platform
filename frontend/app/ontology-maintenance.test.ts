import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadSource,
  previewOperations,
  splitIris,
} from "./ontology-maintenance";


afterEach(() => {
  vi.unstubAllGlobals();
});


describe("ontology maintenance client", () => {
  it("loads a source snapshot with the selected module", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          domain: "cloud-demo",
          module: "dimension",
          source_file: "ontologies/cloud-demo/core/dimension_ontology.ttl",
          content: "@prefix ex: <https://example.com/> .",
          content_hash: "abc",
          size_bytes: 40,
          modified_at: "2026-08-11T00:00:00Z",
          writable: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await loadSource(
      "http://127.0.0.1:8000/",
      "cloud-demo",
      "dimension",
    );

    expect(result.content_hash).toBe("abc");
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "domain=cloud-demo&module=dimension",
    );
  });

  it("surfaces controlled backend messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ detail: { message: "TTL 文件已被其他程序修改" } }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      loadSource("http://127.0.0.1:8000", "cloud-demo", "dimension"),
    ).rejects.toThrow("TTL 文件已被其他程序修改");
  });

  it("posts structured operations to the preview gate", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          domain: "cloud-demo",
          module: "dimension",
          source_file: "dimension_ontology.ttl",
          base_hash: "base",
          draft_hash: "draft",
          conflict: false,
          validation: {
            valid: true,
            errors: 0,
            warnings: 0,
            issues: [],
            summary: {
              classes: 1,
              datatype_properties: 0,
              object_properties: 0,
              triples: 1,
            },
            size_bytes: 1,
          },
          diff: {
            added_triples: 1,
            removed_triples: 0,
            unchanged_triples: 0,
            lines: [],
          },
          content: "draft",
          create_new: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await previewOperations("http://127.0.0.1:8000", {
      domain: "cloud-demo",
      module: "dimension",
      base_hash: "base",
      operations: [
        {
          action: "upsert",
          entity_type: "class",
          uri: "https://example.com/Asset",
        },
      ],
    });

    expect(result.validation.valid).toBe(true);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(String(request.body)).not.toContain("preview-operations");
    expect(String(request.body)).toContain("https://example.com/Asset");
  });

  it("splits comma and newline separated IRIs", () => {
    expect(splitIris("https://a.example/A, https://a.example/B\nhttps://a.example/C")).toEqual([
      "https://a.example/A",
      "https://a.example/B",
      "https://a.example/C",
    ]);
  });
});
