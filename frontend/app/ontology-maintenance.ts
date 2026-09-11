import type {
  ChangePreview,
  EditOperation,
  OntologySourceSnapshot,
  ValidationResult,
  VersionList,
} from "./maintenance-types";

function apiRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error("无法连接本体维护服务，请确认 FastAPI 已启动。");
  }
  if (!response.ok) {
    let message = `维护接口返回 ${response.status}`;
    try {
      const body = (await response.json()) as {
        detail?: string | { message?: string };
      };
      if (typeof body.detail === "string") message = body.detail;
      if (typeof body.detail === "object" && body.detail?.message) {
        message = body.detail.message;
      }
    } catch {
      // Keep the status-based message for non-JSON errors.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function loadSource(
  baseUrl: string,
  domain: string,
  module: string,
): Promise<OntologySourceSnapshot> {
  const query = new URLSearchParams({ domain, module });
  return request(`${apiRoot(baseUrl)}/api/v1/ontology/source?${query}`);
}

export function validateContent(
  baseUrl: string,
  content: string,
): Promise<ValidationResult> {
  return post(`${apiRoot(baseUrl)}/api/v1/ontology/validate`, { content });
}

export function previewContent(
  baseUrl: string,
  input: {
    domain: string;
    module: string;
    content: string;
    base_hash: string | null;
    create_new: boolean;
  },
): Promise<ChangePreview> {
  return post(`${apiRoot(baseUrl)}/api/v1/ontology/preview`, input);
}

export function previewOperations(
  baseUrl: string,
  input: {
    domain: string;
    module: string;
    base_hash: string;
    operations: EditOperation[];
  },
): Promise<ChangePreview> {
  return post(`${apiRoot(baseUrl)}/api/v1/ontology/preview-operations`, input);
}

export function saveContent(
  baseUrl: string,
  input: {
    domain: string;
    module: string;
    content: string;
    base_hash: string | null;
    create_new: boolean;
    reason: string;
  },
): Promise<{ saved: boolean; content_hash: string; created: boolean }> {
  return post(`${apiRoot(baseUrl)}/api/v1/ontology/save`, input);
}

export function loadVersions(
  baseUrl: string,
  domain: string,
  module: string,
): Promise<VersionList> {
  const query = new URLSearchParams({ domain, module });
  return request(`${apiRoot(baseUrl)}/api/v1/ontology/versions?${query}`);
}

export function restoreVersion(
  baseUrl: string,
  domain: string,
  module: string,
  versionId: string,
  expectedHash: string,
): Promise<{ restored: boolean; content_hash: string }> {
  const query = new URLSearchParams({ domain, module });
  return post(
    `${apiRoot(baseUrl)}/api/v1/ontology/versions/${encodeURIComponent(versionId)}/restore?${query}`,
    { expected_hash: expectedHash },
  );
}

export async function downloadApiFile(
  baseUrl: string,
  path: string,
  fallbackName: string,
): Promise<void> {
  const response = await fetch(`${apiRoot(baseUrl)}${path}`);
  if (!response.ok) throw new Error(`导出接口返回 ${response.status}`);
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const matched = disposition.match(/filename="?([^";]+)"?/i);
  downloadBlob(blob, matched?.[1] || fallbackName);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function splitIris(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
