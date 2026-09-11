"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  GitBranch,
  Info,
  Layers3,
  Network,
  RefreshCw,
  Route,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { compactUri, nodeDisplayName } from "./ontology-data";
import { downloadBlob } from "./ontology-maintenance";
import type { GraphNode, OntologyGraph } from "./ontology-types";
import {
  loadHierarchy,
  loadImpactReport,
  loadQualityReport,
  loadShortestPath,
  type HierarchyEntry,
  type HierarchyResponse,
  type ImpactReport,
  type PathResponse,
  type QualityReport,
  type QualitySeverity,
} from "./semantic-analysis";


type AnalysisTab = "structure" | "path" | "impact" | "quality";

const MODULE_LABELS: Record<string, string> = {
  dimension: "维度",
  metric: "指标",
  capability: "能力",
  scenario: "场景",
  external: "外部引用",
};

export default function SemanticAnalysisDrawer({
  open,
  onClose,
  baseUrl,
  domain,
  graph,
  selectedNode,
  onSelectEntity,
  onHighlightPath,
  offline = false,
}: {
  open: boolean;
  onClose: () => void;
  baseUrl: string;
  domain: string;
  graph: OntologyGraph | null;
  selectedNode: GraphNode | null;
  onSelectEntity: (id: string) => void;
  onHighlightPath: (nodeIds: string[], edgeIds: string[]) => void;
  offline?: boolean;
}) {
  const [tab, setTab] = useState<AnalysisTab>("structure");
  const [hierarchy, setHierarchy] = useState<HierarchyResponse | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [impact, setImpact] = useState<ImpactReport | null>(null);
  const [pathResult, setPathResult] = useState<PathResponse | null>(null);
  const [sourceUri, setSourceUri] = useState("");
  const [targetUri, setTargetUri] = useState("");
  const [directed, setDirected] = useState(false);
  const [severity, setSeverity] = useState<QualitySeverity | "all">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedNodes = useMemo(
    () =>
      [...(graph?.nodes || [])].sort((left, right) =>
        nodeDisplayName(left).localeCompare(nodeDisplayName(right), "zh-CN"),
      ),
    [graph],
  );
  const moduleCounts = useMemo(() => {
    if (graph?.meta.module_counts) return graph.meta.module_counts;
    if (!graph) return {};
    return graph.nodes.reduce<Record<string, number>>((counts, node) => {
      const moduleId = node.module || graph.meta.module || "dimension";
      counts[moduleId] = (counts[moduleId] || 0) + 1;
      return counts;
    }, {});
  }, [graph]);

  async function loadOverview() {
    setLoading(true);
    setError(null);
    try {
      if (offline && graph) {
        setHierarchy(buildLocalHierarchy(graph, domain));
        setQuality(buildLocalQuality(graph, domain));
        return;
      }
      const [hierarchyData, qualityData] = await Promise.all([
        loadHierarchy(baseUrl, domain),
        loadQualityReport(baseUrl, domain),
      ]);
      setHierarchy(hierarchyData);
      setQuality(qualityData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "语义分析加载失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setPathResult(null);
    setImpact(null);
    onHighlightPath([], []);
    const timer = window.setTimeout(() => void loadOverview(), 0);
    return () => window.clearTimeout(timer);
    // Reopen or domain changes should refresh analysis; URL changes are applied on reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, domain, offline]);

  useEffect(() => {
    if (!open || tab !== "impact" || !selectedNode) return;
    if (offline && graph) {
      setImpact(buildLocalImpact(graph, selectedNode, domain));
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loadImpactReport(baseUrl, domain, selectedNode.id, controller.signal)
      .then(setImpact)
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "影响分析失败。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [baseUrl, domain, graph, offline, open, selectedNode, tab]);

  if (!open) return null;

  async function findPath() {
    if (!sourceUri || !targetUri) return;
    setLoading(true);
    setError(null);
    try {
      const result =
        offline && graph
          ? buildLocalPath(graph, domain, sourceUri, targetUri, directed)
          : await loadShortestPath(
              baseUrl,
              domain,
              sourceUri,
              targetUri,
              directed,
            );
      setPathResult(result);
      onHighlightPath(result.node_ids, result.edge_ids);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "最短路径计算失败。");
    } finally {
      setLoading(false);
    }
  }

  function exportQuality(format: "json" | "csv") {
    if (!quality) return;
    if (format === "json") {
      downloadBlob(
        new Blob([JSON.stringify(quality, null, 2)], { type: "application/json" }),
        `${domain}-ontology-quality.json`,
      );
      return;
    }
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["severity", "code", "module", "subject", "related", "message"],
      ...quality.issues.map((issue) => [
        issue.severity,
        issue.code,
        issue.module,
        issue.subject,
        issue.related || "",
        issue.message,
      ]),
    ];
    downloadBlob(
      new Blob([`\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\n")}`], {
        type: "text/csv;charset=utf-8",
      }),
      `${domain}-ontology-quality.csv`,
    );
  }

  const filteredIssues =
    quality?.issues.filter((issue) => severity === "all" || issue.severity === severity) || [];

  return (
    <div className="analysis-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="analysis-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="本体语义分析中心"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="analysis-header">
          <div>
            <span>SEMANTIC ANALYSIS</span>
            <h2>语义分析中心</h2>
            <p>{domain} · {offline ? "示例数据分析演示" : "跨模块关系、路径、影响与质量"}</p>
          </div>
          <button onClick={onClose} aria-label="关闭语义分析中心">
            <X size={19} />
          </button>
        </header>

        <nav className="analysis-tabs" aria-label="分析模块">
          {(
            [
              ["structure", "结构", GitBranch],
              ["path", "语义路径", Route],
              ["impact", "影响", Network],
              ["quality", "质量", ShieldCheck],
            ] as [AnalysisTab, string, typeof GitBranch][]
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              className={tab === value ? "active" : ""}
              onClick={() => setTab(value)}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </nav>

        {loading && (
          <div className="analysis-loading"><RefreshCw size={17} className="is-spinning" />正在分析真实 TTL…</div>
        )}
        {error && <div className="analysis-error"><AlertTriangle size={16} />{error}</div>}

        <div className="analysis-body">
          {tab === "structure" && (
            <div className="analysis-structure">
              <div className="analysis-kpis">
                <article><strong>{graph?.meta.total_nodes || 0}</strong><span>类</span></article>
                <article><strong>{graph?.meta.total_edges || 0}</strong><span>关系</span></article>
                <article><strong>{graph?.meta.total_cross_module_edges || 0}</strong><span>跨模块</span></article>
                <article><strong>{hierarchy?.total_roots || 0}</strong><span>根类</span></article>
              </div>
              <section className="module-overview">
                <div className="analysis-section-title"><Layers3 size={15} />模块分布</div>
                <div className="module-bars">
                  {Object.entries(moduleCounts).map(([module, count]) => (
                    <div key={module}>
                      <span><i className={`module-dot module-${module}`} />{MODULE_LABELS[module] || module}</span>
                      <div><i style={{ width: `${Math.max(8, (count / Math.max(1, graph?.meta.total_nodes || 1)) * 100)}%` }} /></div>
                      <strong>{count}</strong>
                    </div>
                  ))}
                </div>
              </section>
              <section className="hierarchy-analysis">
                <div className="analysis-section-title"><GitBranch size={15} />类层次树</div>
                {hierarchy ? (
                  <HierarchyForest hierarchy={hierarchy} onSelect={onSelectEntity} />
                ) : (
                  <span className="analysis-empty">尚未加载类层次</span>
                )}
              </section>
            </div>
          )}

          {tab === "path" && (
            <div className="path-analysis">
              <div className="path-form">
                <label>
                  <span>起点实体</span>
                  <select value={sourceUri} onChange={(event) => setSourceUri(event.target.value)}>
                    <option value="">请选择起点</option>
                    {sortedNodes.map((node) => <option key={node.id} value={node.id}>{nodeDisplayName(node)} · {node.module || "—"}</option>)}
                  </select>
                </label>
                <ArrowRight size={18} />
                <label>
                  <span>终点实体</span>
                  <select value={targetUri} onChange={(event) => setTargetUri(event.target.value)}>
                    <option value="">请选择终点</option>
                    {sortedNodes.map((node) => <option key={node.id} value={node.id}>{nodeDisplayName(node)} · {node.module || "—"}</option>)}
                  </select>
                </label>
              </div>
              <label className="directed-check"><input type="checkbox" checked={directed} onChange={(event) => setDirected(event.target.checked)} />仅沿关系方向查找</label>
              <button className="analysis-primary" disabled={!sourceUri || !targetUri || loading} onClick={findPath}><Route size={15} />计算最短语义路径</button>

              {pathResult && (
                pathResult.found ? (
                  <div className="path-result">
                    <div><CheckCircle2 size={17} /><strong>{pathResult.hops} 跳可达</strong><span>路径已在主图高亮</span></div>
                    <ol>
                      {pathResult.nodes.map((node, index) => (
                        <li key={node.id}>
                          <button onClick={() => onSelectEntity(node.id)}>{nodeDisplayName(node)}</button>
                          <span>{MODULE_LABELS[node.module || ""] || node.module}</span>
                          {index < pathResult.nodes.length - 1 && <ArrowRight size={14} />}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <div className="analysis-empty"><Info size={17} />当前关系方向和筛选下，两实体之间不存在可达路径。</div>
                )
              )}
            </div>
          )}

          {tab === "impact" && (
            selectedNode ? (
              <div className="impact-analysis">
                <div className="impact-heading">
                  <span>当前实体</span>
                  <strong>{nodeDisplayName(selectedNode)}</strong>
                  <code>{selectedNode.qname}</code>
                </div>
                {impact && (
                  <>
                    <div className="impact-summary">
                      <article><strong>{impact.summary.total_references}</strong><span>直接引用</span></article>
                      <article><strong>{impact.summary.cross_module_references}</strong><span>跨模块引用</span></article>
                      <article className={`risk-${impact.summary.risk}`}><strong>{impact.summary.risk.toUpperCase()}</strong><span>修改风险</span></article>
                    </div>
                    <div className="impact-list">
                      {impact.references.map((reference, index) => (
                        <button key={`${reference.subject}-${reference.predicate}-${index}`} onClick={() => onSelectEntity(reference.subject)}>
                          <span className={`impact-kind ${reference.kind}`}>{reference.kind}</span>
                          <div><strong>{compactUri(reference.subject)}</strong><small>{reference.module}{reference.cross_module ? " · 跨模块" : ""}</small></div>
                          <ArrowRight size={14} />
                          <code>{compactUri(reference.object)}</code>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="analysis-empty"><Network size={20} />请先在主图或类层次树中选择一个实体。</div>
            )
          )}

          {tab === "quality" && quality && (
            <div className="quality-analysis">
              <div className="quality-score">
                <div><strong>{quality.summary.score}</strong><span>/ 100</span></div>
                <p><b>{quality.summary.passed ? "未发现阻断错误" : "存在阻断错误"}</b><span>质量分用于定位治理优先级，不会自动修改 TTL。</span></p>
                <div className="quality-actions">
                  <button onClick={() => exportQuality("json")}><Download size={14} />JSON</button>
                  <button onClick={() => exportQuality("csv")}><Download size={14} />CSV</button>
                </div>
              </div>
              <div className="severity-filter">
                {(["all", "error", "warning", "info"] as const).map((value) => (
                  <button key={value} className={severity === value ? "active" : ""} onClick={() => setSeverity(value)}>
                    {value === "all" ? "全部" : value === "error" ? "错误" : value === "warning" ? "警告" : "建议"}
                    <span>{value === "all" ? quality.summary.total : quality.summary[value]}</span>
                  </button>
                ))}
              </div>
              <div className="quality-list">
                {filteredIssues.map((issue) => (
                  <button key={issue.id} onClick={() => onSelectEntity(issue.focus_entity || issue.subject)}>
                    <i className={issue.severity}>{issue.severity === "error" ? "E" : issue.severity === "warning" ? "W" : "I"}</i>
                    <div><strong>{issue.code}</strong><p>{issue.message}</p><code>{compactUri(issue.subject)}</code></div>
                    <span>{MODULE_LABELS[issue.module] || issue.module}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function buildLocalHierarchy(graph: OntologyGraph, domain: string): HierarchyResponse {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.edge_type !== "subClassOf") continue;
    parents.set(edge.source, [...(parents.get(edge.source) || []), edge.target]);
    children.set(edge.target, [...(children.get(edge.target) || []), edge.source]);
  }
  const entries = graph.nodes.map((node) => ({
    id: node.id,
    label: nodeDisplayName(node),
    qname: node.qname,
    module: node.module || "dimension",
    modules: node.modules || [],
    parent_ids: parents.get(node.id) || [],
    child_ids: children.get(node.id) || [],
    property_count: node.datatype_properties.length + node.object_properties.length,
  }));
  const root_ids = entries.filter((entry) => !entry.parent_ids.length).map((entry) => entry.id);
  return { domain, root_ids, entries, total_roots: root_ids.length, total_entries: entries.length };
}

function buildLocalQuality(graph: OntologyGraph, domain: string): QualityReport {
  const issues = graph.warnings.map((warning, index) => ({
    id: `mock-${index}`,
    severity: "warning" as const,
    code: warning.code,
    message: warning.message,
    subject: warning.subject,
    module: graph.meta.module || "dimension",
    focus_entity: warning.subject,
  }));
  return {
    domain,
    summary: {
      error: 0,
      warning: issues.length,
      info: 0,
      total: issues.length,
      score: Math.max(0, 100 - issues.length * 2),
      passed: true,
    },
    issues,
  };
}

function buildLocalPath(
  graph: OntologyGraph,
  domain: string,
  sourceUri: string,
  targetUri: string,
  directed: boolean,
): PathResponse {
  const adjacency = new Map<string, { id: string; edge: OntologyGraph["edges"][number] }[]>();
  for (const edge of graph.edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) || []), { id: edge.target, edge }]);
    if (!directed) adjacency.set(edge.target, [...(adjacency.get(edge.target) || []), { id: edge.source, edge }]);
  }
  const queue = [sourceUri];
  const previous = new Map<string, { id: string; edge: OntologyGraph["edges"][number] }>();
  const visited = new Set([sourceUri]);
  while (queue.length && !visited.has(targetUri)) {
    const current = queue.shift() as string;
    for (const candidate of adjacency.get(current) || []) {
      if (visited.has(candidate.id)) continue;
      visited.add(candidate.id);
      previous.set(candidate.id, { id: current, edge: candidate.edge });
      queue.push(candidate.id);
    }
  }
  if (!visited.has(targetUri)) {
    return { domain, found: false, directed, hops: null, node_ids: [], edge_ids: [], nodes: [], edges: [] };
  }
  const nodeIds = [targetUri];
  const edges = [] as OntologyGraph["edges"];
  let current = targetUri;
  while (current !== sourceUri) {
    const item = previous.get(current);
    if (!item) break;
    nodeIds.push(item.id);
    edges.push(item.edge);
    current = item.id;
  }
  nodeIds.reverse();
  edges.reverse();
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  return {
    domain,
    found: true,
    directed,
    hops: edges.length,
    node_ids: nodeIds,
    edge_ids: edges.map((edge) => edge.id),
    nodes: nodeIds.map((id) => nodeMap.get(id)).filter(Boolean) as GraphNode[],
    edges,
  };
}

function buildLocalImpact(
  graph: OntologyGraph,
  node: GraphNode,
  domain: string,
): ImpactReport {
  const references = graph.edges
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) => ({
      kind: edge.edge_type,
      subject: edge.source,
      predicate: edge.predicate || edge.edge_type,
      object: edge.target,
      module: edge.module || node.module || graph.meta.module || "dimension",
      cross_module: Boolean(edge.cross_module),
    }));
  const crossModule = references.filter((reference) => reference.cross_module).length;
  return {
    domain,
    entity: { id: node.id, label: nodeDisplayName(node), qname: node.qname, module: node.module || "dimension" },
    summary: {
      total_references: references.length,
      cross_module_references: crossModule,
      by_kind: references.reduce<Record<string, number>>((counts, reference) => {
        counts[reference.kind] = (counts[reference.kind] || 0) + 1;
        return counts;
      }, {}),
      risk: crossModule || references.length >= 8 ? "high" : references.length ? "medium" : "low",
    },
    references,
  };
}

function HierarchyForest({
  hierarchy,
  onSelect,
}: {
  hierarchy: HierarchyResponse;
  onSelect: (id: string) => void;
}) {
  const entries = useMemo(
    () => new Map(hierarchy.entries.map((entry) => [entry.id, entry])),
    [hierarchy],
  );
  return (
    <div className="analysis-tree">
      {hierarchy.root_ids.map((id) => (
        <HierarchyBranch key={id} id={id} entries={entries} trail={new Set()} onSelect={onSelect} />
      ))}
    </div>
  );
}

function HierarchyBranch({
  id,
  entries,
  trail,
  onSelect,
}: {
  id: string;
  entries: Map<string, HierarchyEntry>;
  trail: Set<string>;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const entry = entries.get(id);
  if (!entry || trail.has(id)) return null;
  const nextTrail = new Set(trail).add(id);
  return (
    <div className="analysis-tree-branch">
      <div>
        <button className="tree-expander" onClick={() => setOpen((value) => !value)} disabled={!entry.child_ids.length}>{entry.child_ids.length ? (open ? "−" : "+") : "·"}</button>
        <button className="tree-entity" onClick={() => onSelect(entry.id)}>
          <i className={`module-dot module-${entry.module}`} />
          <span><strong>{entry.label}</strong><small>{entry.property_count} 个属性 · {entry.child_ids.length} 个子类</small></span>
          <code>{entry.qname}</code>
        </button>
      </div>
      {open && entry.child_ids.length > 0 && (
        <div className="analysis-tree-children">
          {entry.child_ids.map((child) => (
            <HierarchyBranch key={child} id={child} entries={entries} trail={nextTrail} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
