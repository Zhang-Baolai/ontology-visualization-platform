"use client";

import cytoscape, { type Core, type ElementDefinition, type StylesheetJson } from "cytoscape";
import {
  AlertTriangle,
  ArrowRight,
  Braces,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  FileWarning,
  Filter,
  Focus,
  GitMerge,
  Image,
  Info,
  Layers3,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { downloadBlob } from "./ontology-maintenance";
import {
  buildLineageGraph,
  buildOverviewGraph,
  estimateDetailedNodeCount,
  filterR2RMLMappings,
  groupR2RMLMappings,
  type BrowseGraph,
  type MappingGroup,
  type MappingGroupBy,
  type MappingKindFilter,
} from "./r2rml-browse";
import { loadR2RMLAnalysis, mappingsToCsv } from "./r2rml-analysis";
import type { LineageNode, MappingIssue, R2RMLAnalysis, TriplesMap } from "./r2rml-types";

type DetailTab = "mapping" | "impact" | "quality";
type BrowseMode = "overview" | "focus" | "detail" | "expanded";

const GROUP_PAGE_SIZE = 8;
const GROUP_BY_LABELS: Record<MappingGroupBy, string> = {
  "logical-table": "按逻辑表",
  class: "按本体类",
  file: "按映射文件",
  kind: "按映射类型",
};
const MODE_LABELS: Record<BrowseMode, string> = {
  overview: "聚合概览",
  focus: "分组聚焦",
  detail: "单映射详情",
  expanded: "筛选结果展开",
};
const TYPE_LABELS: Record<string, string> = {
  table: "数据库表",
  sql: "SQL 逻辑表",
  column: "字段",
  "triples-map": "TriplesMap",
  class: "本体类",
  property: "本体属性",
  template: "IRI 模板",
};

function graphStyle(dark: boolean): StylesheetJson {
  const panel = dark ? "#20283a" : "#ffffff";
  const text = dark ? "#e8edf7" : "#1f2a44";
  return [
    {
      selector: "node",
      style: {
        width: 148,
        height: 42,
        shape: "round-rectangle",
        label: "data(label)",
        "text-wrap": "ellipsis",
        "text-max-width": "126px",
        "font-size": 11,
        "font-weight": 600,
        color: text,
        "background-color": panel,
        "border-color": "#9aa7ba",
        "border-width": 1.3,
        "text-valign": "center",
        "text-halign": "center",
        "overlay-opacity": 0,
        "transition-property": "opacity, border-width, border-color",
        "transition-duration": 120,
      },
    },
    { selector: "node.table, node.group-source", style: { "background-color": dark ? "#21354c" : "#edf6ff", "border-color": "#4b84b9" } },
    { selector: "node.group-source", style: { width: 178, height: 48, "font-size": 10, "border-width": 2 } },
    { selector: "node.sql", style: { "background-color": dark ? "#3b303f" : "#fff0f8", "border-color": "#b36691" } },
    { selector: "node.column", style: { width: 118, height: 32, "font-size": 10, "background-color": dark ? "#29313d" : "#f7f9fc", "border-color": "#91a0b2" } },
    { selector: "node.triples-map, node.group-mapping", style: { width: 164, height: 48, "background-color": dark ? "#3f351f" : "#fff7dc", "border-color": "#c89327", "border-width": 2 } },
    { selector: "node.group-mapping", style: { width: 174 } },
    { selector: "node.class, node.ontology-summary", style: { "background-color": dark ? "#263c35" : "#edf9f4", "border-color": "#3a9a75" } },
    { selector: "node.ontology-summary", style: { width: 174, height: 48, "border-width": 2 } },
    { selector: "node.property", style: { width: 136, height: 36, "background-color": dark ? "#303149" : "#f2f1ff", "border-color": "#7772c5" } },
    { selector: "node.template", style: { width: 180, height: 36, "font-family": "monospace", "font-size": 9, "background-color": dark ? "#382e27" : "#fff3eb", "border-color": "#b8794f" } },
    { selector: "node.draft", style: { "border-style": "dashed", opacity: 0.78 } },
    { selector: "node:selected", style: { "border-color": "#315ec7", "border-width": 4, "underlay-color": "#315ec7", "underlay-opacity": 0.1, "underlay-padding": 7 } },
    { selector: "node.faded", style: { opacity: 0.14 } },
    { selector: "node.highlighted", style: { "border-width": 3 } },
    {
      selector: "edge",
      style: {
        width: 1.25,
        "curve-style": "bezier",
        "line-color": dark ? "#63708a" : "#8e9aae",
        "target-arrow-color": dark ? "#63708a" : "#8e9aae",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.72,
        label: "data(label)",
        "font-size": 8,
        "min-zoomed-font-size": 9,
        color: dark ? "#b6c0d2" : "#59667a",
        "text-background-color": dark ? "#171d29" : "#ffffff",
        "text-background-opacity": 0.86,
        "text-background-padding": "2px",
        "overlay-opacity": 0,
        "transition-property": "opacity, width",
        "transition-duration": 120,
      },
    },
    { selector: "edge.aggregate-input, edge.aggregate-output", style: { width: 3, "curve-style": "straight", "line-color": "#91a0b2", "target-arrow-color": "#91a0b2", "font-size": 9 } },
    { selector: "edge.aggregate-output", style: { "line-color": "#62a68b", "target-arrow-color": "#62a68b" } },
    { selector: "edge.column-property", style: { "line-style": "dashed", "line-color": "#7772c5", "target-arrow-color": "#7772c5" } },
    { selector: "edge.parent-triples-map", style: { width: 2.2, "line-color": "#cf6c56", "target-arrow-color": "#cf6c56", "line-style": "dashed" } },
    { selector: "edge.class", style: { width: 2, "line-color": "#3a9a75", "target-arrow-color": "#3a9a75" } },
    { selector: "edge.faded", style: { opacity: 0.08 } },
    { selector: "edge.highlighted", style: { width: 3, opacity: 1 } },
  ];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function compact(value?: string): string {
  if (!value) return "—";
  if (/^[a-z][\w-]*:/i.test(value) && !value.startsWith("http")) return value;
  const match = value.match(/([^#/]+)[#/]?$/);
  return match?.[1] || value;
}

function SeverityIcon({ severity }: { severity: MappingIssue["severity"] }) {
  if (severity === "error") return <FileWarning size={15} />;
  if (severity === "warning") return <AlertTriangle size={15} />;
  return <Info size={15} />;
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="r2-metric"><strong>{value}</strong><span>{label}</span></div>;
}

export default function R2RMLExplorer({
  open,
  onClose,
  baseUrl,
  initialDomain,
  onOpenOntologyEntity,
}: {
  open: boolean;
  onClose: () => void;
  baseUrl: string;
  initialDomain: string;
  onOpenOntologyEntity: (uri: string) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [analysis, setAnalysis] = useState<R2RMLAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState(initialDomain || "all");
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [fileId, setFileId] = useState("all");
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<MappingGroupBy>("logical-table");
  const [kindFilter, setKindFilter] = useState<MappingKindFilter>("all");
  const [joinsOnly, setJoinsOnly] = useState(false);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showJoins, setShowJoins] = useState(false);
  const [browseMode, setBrowseMode] = useState<BrowseMode>("overview");
  const [selectedGroupId, setSelectedGroupId] = useState<string>();
  const [selectedMappingId, setSelectedMappingId] = useState<string>();
  const [selectedNode, setSelectedNode] = useState<LineageNode | null>(null);
  const [groupPage, setGroupPage] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("mapping");
  const [qualityFilter, setQualityFilter] = useState<"all" | MappingIssue["severity"]>("all");

  const dark = typeof document !== "undefined" && document.querySelector(".ontology-shell")?.getAttribute("data-theme") === "dark";

  useEffect(() => setDomain(initialDomain || "all"), [initialDomain]);

  const resetView = () => {
    setBrowseMode("overview");
    setSelectedGroupId(undefined);
    setSelectedMappingId(undefined);
    setSelectedNode(null);
    setGroupPage(0);
    setNotice(null);
  };

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loadR2RMLAnalysis(baseUrl, { domain, includeDrafts, signal: controller.signal })
      .then((payload) => {
        setAnalysis(payload);
        setFileId("all");
        resetView();
      })
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "R2RML 映射加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [baseUrl, domain, includeDrafts, open]);

  const filteredMappings = useMemo(
    () => analysis ? filterR2RMLMappings(analysis, { fileId, query, kind: kindFilter, joinsOnly, issuesOnly }) : [],
    [analysis, fileId, issuesOnly, joinsOnly, kindFilter, query],
  );
  const groups = useMemo(
    () => analysis ? groupR2RMLMappings(analysis, filteredMappings, groupBy) : [],
    [analysis, filteredMappings, groupBy],
  );
  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) || null,
    [groups, selectedGroupId],
  );
  const selectedMapping = useMemo(
    () => analysis?.mappings.find((mapping) => mapping.id === selectedMappingId) || null,
    [analysis, selectedMappingId],
  );
  const mappingsInGroup = useMemo(() => {
    if (!selectedGroup) return filteredMappings;
    const ids = new Set(selectedGroup.mappingIds);
    return filteredMappings.filter((mapping) => ids.has(mapping.id));
  }, [filteredMappings, selectedGroup]);
  const groupPageCount = Math.max(1, Math.ceil(groups.length / GROUP_PAGE_SIZE));
  const pageGroups = useMemo(
    () => groups.slice(groupPage * GROUP_PAGE_SIZE, (groupPage + 1) * GROUP_PAGE_SIZE),
    [groupPage, groups],
  );

  useEffect(() => {
    if (groupPage >= groupPageCount) setGroupPage(Math.max(0, groupPageCount - 1));
  }, [groupPage, groupPageCount]);

  useEffect(() => {
    setGroupPage(0);
    setSelectedGroupId(undefined);
    setSelectedMappingId(undefined);
    setSelectedNode(null);
    setBrowseMode("overview");
  }, [fileId, groupBy, issuesOnly, joinsOnly, kindFilter, query]);

  const graph = useMemo<BrowseGraph>(() => {
    if (!analysis) return { nodes: [], edges: [], mappingIds: [] };
    if (browseMode === "overview") return buildOverviewGraph(pageGroups);
    if (browseMode === "focus") return buildLineageGraph(analysis, mappingsInGroup, { showJoins });
    if (browseMode === "detail" && selectedMapping) {
      return buildLineageGraph(analysis, [selectedMapping], { detail: true, showColumns, showJoins });
    }
    if (browseMode === "expanded") {
      return buildLineageGraph(analysis, filteredMappings, { detail: true, showColumns, showJoins });
    }
    return buildOverviewGraph(pageGroups);
  }, [analysis, browseMode, filteredMappings, mappingsInGroup, pageGroups, selectedMapping, showColumns, showJoins]);

  const visibleMappingIds = useMemo(() => new Set(graph.mappingIds), [graph.mappingIds]);
  const exportMappings = useMemo(
    () => filteredMappings.filter((mapping) => visibleMappingIds.has(mapping.id)),
    [filteredMappings, visibleMappingIds],
  );

  const filteredIssues = useMemo(() => {
    if (!analysis) return [];
    return analysis.issues.filter((issue) => {
      if (qualityFilter !== "all" && issue.severity !== qualityFilter) return false;
      if (fileId !== "all" && issue.source_file !== analysis.files.find((file) => file.id === fileId)?.path) return false;
      return true;
    });
  }, [analysis, fileId, qualityFilter]);

  const mappingImpact = useMemo(() => {
    if (!analysis || !selectedMapping) return null;
    const columns = new Set<string>();
    const templates = new Set<string>();
    const parents = new Set<string>();
    const joins: { predicate: string; child?: string; parent?: string }[] = [];
    for (const pom of selectedMapping.predicate_object_maps) {
      if (pom.object_map.column) columns.add(pom.object_map.column);
      if (pom.object_map.template) templates.add(pom.object_map.template);
      if (pom.object_map.parent_triples_map) parents.add(compact(pom.object_map.parent_triples_map));
      for (const join of pom.object_map.joins) joins.push({ predicate: pom.predicate_local_name, ...join });
    }
    const referencedBy = analysis.mappings.filter((mapping) =>
      mapping.predicate_object_maps.some((pom) => pom.object_map.parent_triples_map_uri === selectedMapping.uri),
    );
    return { columns: [...columns], templates: [...templates], parents: [...parents], joins, referencedBy };
  }, [analysis, selectedMapping]);

  const enterGroup = (groupId: string) => {
    setSelectedGroupId(groupId);
    setSelectedMappingId(undefined);
    setSelectedNode(null);
    setBrowseMode("focus");
    setDetailTab("mapping");
    setNotice(null);
  };
  const enterMapping = (mappingId: string) => {
    setSelectedMappingId(mappingId);
    setSelectedNode(null);
    setBrowseMode("detail");
    setDetailTab("mapping");
    setNotice(null);
  };
  const goBack = () => {
    setSelectedNode(null);
    setNotice(null);
    if (browseMode === "detail" && selectedGroup) {
      setSelectedMappingId(undefined);
      setBrowseMode("focus");
      return;
    }
    resetView();
  };

  useEffect(() => {
    if (!open || !canvasRef.current || cyRef.current) return;
    const cy = cytoscape({
      container: canvasRef.current,
      elements: [],
      style: graphStyle(dark),
      minZoom: 0.16,
      maxZoom: 2.8,
      wheelSensitivity: 0.18,
      boxSelectionEnabled: false,
    });
    cy.on("tap", "node", (event) => {
      const id = event.target.id();
      const groupId = event.target.data("groupId") as string | undefined;
      if (groupId) {
        enterGroup(groupId);
        return;
      }
      const node = event.target.data("model") as LineageNode | undefined;
      setSelectedNode(node && TYPE_LABELS[node.type] ? node : null);
      const mappingId = event.target.data("mappingId") as string | undefined;
      if (mappingId && event.target.data("type") === "triples-map") enterMapping(mappingId);
      cy.elements().unselect();
      cy.getElementById(id).select();
    });
    cy.on("mouseover", "node", (event) => {
      const neighborhood = event.target.closedNeighborhood();
      cy.elements().not(neighborhood).addClass("faded");
      neighborhood.addClass("highlighted");
    });
    cy.on("mouseout", "node", () => cy.elements().removeClass("faded highlighted"));
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [dark, open]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const rank = {
      table: 0,
      sql: 0,
      column: 0,
      "group-source": 0,
      "triples-map": 1,
      "group-mapping": 1,
      class: 2,
      property: 2,
      template: 2,
      "ontology-summary": 2,
    } as Record<string, number>;
    const counts = [0, 0, 0];
    const groupRows = new Map(pageGroups.map((group, index) => [group.id, index]));
    const canvasWidth = canvasRef.current?.clientWidth || 1080;
    const laneWidth = Math.max(230, canvasWidth / 3);
    const elements: ElementDefinition[] = graph.nodes.map((node) => {
      const column = rank[node.type] ?? 1;
      const overviewRow = node.group_id ? groupRows.get(node.group_id) : undefined;
      const row = overviewRow ?? counts[column]++;
      return {
        group: "nodes",
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          mappingId: node.mapping_id,
          groupId: node.group_id,
          model: node,
          count: node.count || 1,
        },
        position: { x: laneWidth * (column + 0.5), y: 58 + row * (browseMode === "overview" ? 72 : node.type === "column" || node.type === "property" ? 46 : 60) },
        classes: `${node.type}${node.draft ? " draft" : ""}`,
      };
    });
    for (const edge of graph.edges) {
      elements.push({
        group: "edges",
        data: { id: edge.id, source: edge.source, target: edge.target, label: edge.label, mappingId: edge.mapping_id, count: edge.count || 1 },
        classes: edge.type,
      });
    }
    cy.elements().remove();
    cy.add(elements);
    cy.layout({ name: "preset", fit: true, padding: browseMode === "overview" ? 38 : 52 }).run();
  }, [browseMode, graph, pageGroups]);

  if (!open) return null;

  const refresh = () => {
    setLoading(true);
    loadR2RMLAnalysis(baseUrl, { domain, includeDrafts, refresh: true })
      .then((payload) => { setAnalysis(payload); resetView(); })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "刷新失败"))
      .finally(() => setLoading(false));
  };

  const expandFiltered = () => {
    if (!analysis || !filteredMappings.length) return;
    const requested = estimateDetailedNodeCount(analysis, filteredMappings, { showColumns, showJoins });
    if (requested > 100 && showColumns) {
      const collapsed = estimateDetailedNodeCount(analysis, filteredMappings, { showColumns: false, showJoins });
      if (collapsed <= 100) {
        setShowColumns(false);
        setBrowseMode("expanded");
        setNotice(`预计 ${requested} 个节点，已自动折叠字段后展开 ${collapsed} 个节点。`);
        return;
      }
    }
    if (requested > 100) {
      setNotice(`预计 ${requested} 个节点，已阻止全量展开。请先搜索或按文件、本体类、Join、质量问题筛选到 100 个节点以内。`);
      return;
    }
    setBrowseMode("expanded");
    setSelectedGroupId(undefined);
    setSelectedMappingId(undefined);
    setNotice(requested > 40 ? `当前为 ${requested} 个节点，字段保持折叠；悬停节点可只高亮当前关系链。` : null);
  };

  const toggleColumns = () => {
    if (!analysis) return;
    const scope = browseMode === "detail" && selectedMapping ? [selectedMapping] : filteredMappings;
    if (!showColumns) {
      const requested = estimateDetailedNodeCount(analysis, scope, { showColumns: true, showJoins });
      if (requested > 100) {
        setNotice(`显示字段后预计 ${requested} 个节点，已保持折叠。请先缩小映射范围。`);
        return;
      }
      if (requested > 40) setNotice(`已展开字段，共 ${requested} 个节点；建议继续聚焦单条映射。`);
    }
    setShowColumns((value) => !value);
  };

  const exportJson = () => {
    if (!analysis) return;
    downloadBlob(new Blob([JSON.stringify({ ...analysis, nodes: graph.nodes, edges: graph.edges, view_mode: browseMode }, null, 2)], { type: "application/json" }), `r2rml-${domain}-analysis.json`);
  };
  const exportCsv = () => downloadBlob(new Blob([mappingsToCsv(exportMappings)], { type: "text/csv;charset=utf-8" }), `r2rml-${domain}-mappings.csv`);
  const exportPng = () => {
    const blob = cyRef.current?.png({ output: "blob", full: true, scale: 2, bg: dark ? "#111720" : "#f6f8fb" }) as Blob | undefined;
    if (blob) downloadBlob(blob, `r2rml-${domain}-lineage.png`);
  };
  const exportSvg = () => {
    const cy = cyRef.current;
    if (!cy) return;
    const bounds = cy.elements().boundingBox({ includeLabels: true });
    const pad = 48;
    const offsetX = pad - bounds.x1;
    const offsetY = pad - bounds.y1;
    const width = Math.max(640, Math.ceil(bounds.w + pad * 2));
    const height = Math.max(420, Math.ceil(bounds.h + pad * 2));
    const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] || char);
    const lines = cy.edges().map((edge) => {
      const source = edge.source().position();
      const target = edge.target().position();
      return `<line x1="${source.x + offsetX}" y1="${source.y + offsetY}" x2="${target.x + offsetX}" y2="${target.y + offsetY}" stroke="#8390a8" stroke-width="1.4"/>`;
    }).join("");
    const boxes = cy.nodes().map((node) => {
      const position = node.position();
      return `<g><rect x="${position.x + offsetX - 74}" y="${position.y + offsetY - 21}" width="148" height="42" rx="9" fill="#ffffff" stroke="#5876d8"/><text x="${position.x + offsetX}" y="${position.y + offsetY + 4}" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#1f2a44">${escape(String(node.data("label")))}</text></g>`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f6f8fb"/>${lines}${boxes}</svg>`;
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `r2rml-${domain}-lineage.svg`);
  };

  const currentList = browseMode === "overview" ? filteredMappings : mappingsInGroup;

  return (
    <section className="r2-workbench" aria-label="R2RML 数据映射工作台">
      <header className="r2-header">
        <div className="r2-title">
          <div className="r2-title-icon"><GitMerge size={21} /></div>
          <div><small>PROGRESSIVE OFFLINE MAPPING</small><h2>R2RML 数据映射工作台</h2></div>
        </div>
        <div className="r2-safety-badge"><ShieldCheck size={15} /><span><strong>离线只读</strong>未连接数据库 · 未执行 SQL</span></div>
        <div className="r2-header-metrics">
          <Metric value={analysis?.meta.total_triples_maps || 0} label="TriplesMap" />
          <Metric value={analysis?.meta.total_tables || 0} label="逻辑表" />
          <Metric value={analysis?.meta.total_columns || 0} label="字段" />
          <Metric value={analysis?.meta.total_joins || 0} label="Join" />
        </div>
        <button className="r2-close" onClick={onClose} aria-label="关闭映射工作台"><X size={19} /></button>
      </header>

      <div className="r2-toolbar">
        <label><span>领域</span><select value={domain} onChange={(event) => setDomain(event.target.value)}><option value="all">全部领域</option><option value="cloud-demo">Cloud Demo</option><option value="service-demo">Service Demo</option></select></label>
        <label className="r2-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 TriplesMap、表、本体类或属性…" /><em>{filteredMappings.length} / {analysis?.meta.total_triples_maps || 0}</em></label>
        <label className="r2-check"><input type="checkbox" checked={includeDrafts} onChange={(event) => setIncludeDrafts(event.target.checked)} />包含 Draft</label>
        <label className="r2-compact-select"><span>类型</span><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as MappingKindFilter)}><option value="all">全部</option><option value="regular">常规映射</option><option value="canonical">Canonical</option></select></label>
        <button className={joinsOnly ? "active" : ""} onClick={() => setJoinsOnly((value) => !value)}><GitMerge size={14} />有 Join</button>
        <button className={issuesOnly ? "active" : ""} onClick={() => setIssuesOnly((value) => !value)}><AlertTriangle size={14} />有质量问题</button>
        <button onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? "is-spinning" : ""} />刷新</button>
        <div className="r2-export"><button onClick={exportJson}><Braces size={13} />JSON</button><button onClick={exportCsv}><Download size={13} />CSV</button><button onClick={exportSvg}><FileCode2 size={13} />SVG</button><button onClick={exportPng}><Image size={13} />PNG</button></div>
      </div>

      <div className="r2-body">
        <aside className="r2-left">
          <div className="r2-panel-title"><span>映射文件</span><em>{analysis?.files.length || 0}</em></div>
          <button className={`r2-file ${fileId === "all" ? "active" : ""}`} onClick={() => setFileId("all")}><Network size={15} /><div><strong>全部映射</strong><small>跨文件联合视图</small></div><b>{analysis?.meta.total_triples_maps || 0}</b></button>
          <div className="r2-file-list">
            {analysis?.files.map((file) => <button key={file.id} className={`r2-file ${fileId === file.id ? "active" : ""}`} onClick={() => setFileId(file.id)}><FileCode2 size={15} /><div><strong>{file.domain}</strong><small title={file.path}>{file.draft ? "draft / " : ""}{file.name}</small></div><b>{file.triples_maps}</b>{file.draft && <i>DRAFT</i>}</button>)}
          </div>
          {browseMode === "overview" ? <>
            <div className="r2-panel-title r2-map-heading"><span>映射分组</span><em>{groups.length}</em></div>
            <div className="r2-group-list">
              {groups.map((group) => <button key={group.id} onClick={() => enterGroup(group.id)}><span className="r2-group-glyph"><Layers3 size={14} /></span><div><strong>{group.label}</strong><small>{group.mappingCount} 映射 · {group.classCount} 类 · {group.propertyCount} 属性</small></div>{group.issueCount > 0 && <i title="质量问题">{group.issueCount}</i>}<ArrowRight size={13} /></button>)}
            </div>
          </> : <>
            <div className="r2-panel-title r2-map-heading"><span>{selectedGroup ? selectedGroup.label : "TriplesMap"}</span><em>{currentList.length}</em></div>
            <div className="r2-map-list">
              {currentList.map((mapping) => <button key={mapping.id} className={selectedMappingId === mapping.id ? "active" : ""} onClick={() => enterMapping(mapping.id)}><span className="r2-map-glyph">TM</span><div><strong>{mapping.name}</strong><small>{mapping.logical_table.table_name || "SQL logical table"}</small></div><ArrowRight size={13} /></button>)}
            </div>
          </>}
          {analysis?.files.find((file) => file.id === fileId) && <div className="r2-file-meta"><span>文件校验</span><code>{formatBytes(analysis.files.find((file) => file.id === fileId)!.size_bytes)} · SHA-256</code><small>{analysis.files.find((file) => file.id === fileId)!.sha256}</small></div>}
        </aside>

        <main className="r2-canvas-wrap">
          <div className="r2-viewbar">
            <button onClick={goBack} disabled={browseMode === "overview"} aria-label="返回上一级"><ChevronLeft size={14} /></button>
            <div className="r2-breadcrumb"><button onClick={resetView}>全部映射</button>{selectedGroup && <><span>/</span><button onClick={() => enterGroup(selectedGroup.id)}>{selectedGroup.label}</button></>}{selectedMapping && <><span>/</span><strong>{selectedMapping.name}</strong></>}</div>
            <span className="r2-mode-badge">{MODE_LABELS[browseMode]}</span>
            <label><span>聚合</span><select value={groupBy} onChange={(event) => setGroupBy(event.target.value as MappingGroupBy)}>{Object.entries(GROUP_BY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            {(browseMode === "detail" || browseMode === "expanded") && <button className={showColumns ? "active" : ""} onClick={toggleColumns}><Columns3 size={13} />字段</button>}
            {(browseMode !== "overview") && <button className={showJoins ? "active" : ""} onClick={() => setShowJoins((value) => !value)}><GitMerge size={13} />Join</button>}
            <button onClick={expandFiltered}><Focus size={13} />展开当前筛选</button>
            <em>{new Set(graph.mappingIds).size} 映射 · {graph.nodes.length} 节点 · {graph.edges.length} 关系</em>
          </div>
          <div className="r2-lane-heads"><span><Database size={14} />数据源层</span><span><GitMerge size={14} />映射规则层</span><span><Network size={14} />本体语义层</span></div>
          <div ref={canvasRef} className="r2-canvas" />
          {notice && <button className="r2-notice" onClick={() => setNotice(null)}><AlertTriangle size={14} /><span>{notice}</span><X size={13} /></button>}
          {loading && <div className="r2-overlay"><RefreshCw size={24} className="is-spinning" /><strong>正在解析映射文件…</strong></div>}
          {error && <div className="r2-overlay error"><AlertTriangle size={28} /><strong>{error}</strong><span>请确认后端读取到 ontology-visualization-platform\ontologies\**\mappings。</span></div>}
          {!loading && !error && graph.nodes.length === 0 && <div className="r2-overlay"><FileWarning size={28} /><strong>没有符合条件的映射</strong><span>清除筛选或启用 Draft 后重试。</span></div>}
          {browseMode === "overview" && groupPageCount > 1 && <div className="r2-pager"><button disabled={groupPage === 0} onClick={() => setGroupPage((page) => Math.max(0, page - 1))}><ChevronLeft size={13} /></button><span>{groupPage + 1} / {groupPageCount}</span><button disabled={groupPage + 1 >= groupPageCount} onClick={() => setGroupPage((page) => Math.min(groupPageCount - 1, page + 1))}><ChevronRight size={13} /></button></div>}
          <div className="r2-legend"><span><i className="table" />表 / 分组</span><span><i className="map" />TriplesMap</span><span><i className="ontology" />本体语义</span><span><i className="draft" />Draft</span></div>
        </main>

        <aside className="r2-right">
          <div className="r2-tabs"><button className={detailTab === "mapping" ? "active" : ""} onClick={() => setDetailTab("mapping")}>映射详情</button><button className={detailTab === "impact" ? "active" : ""} onClick={() => setDetailTab("impact")}>上下游</button><button className={detailTab === "quality" ? "active" : ""} onClick={() => setDetailTab("quality")}>质量 <em>{analysis?.meta.total_issues || 0}</em></button></div>
          <div className="r2-detail-scroll">
            {detailTab === "mapping" && (selectedMapping
              ? <MappingDetail mapping={selectedMapping} selectedNode={selectedNode} onOpenOntologyEntity={onOpenOntologyEntity} />
              : selectedGroup
                ? <GroupDetail group={selectedGroup} mappings={mappingsInGroup} onSelectMapping={enterMapping} />
                : <OverviewDetail groups={groups} mappings={filteredMappings} />)}
            {detailTab === "impact" ? selectedMapping && mappingImpact ? <ImpactDetail mapping={selectedMapping} impact={mappingImpact} /> : <EmptyDetail /> : null}
            {detailTab === "quality" && <QualityDetail analysis={analysis} issues={filteredIssues} filter={qualityFilter} onFilter={setQualityFilter} onSelect={(issue) => { if (issue.mapping_id) { setSelectedGroupId(undefined); enterMapping(issue.mapping_id); } }} />}
          </div>
        </aside>
      </div>
    </section>
  );
}

function OverviewDetail({ groups, mappings }: { groups: MappingGroup[]; mappings: TriplesMap[] }) {
  const classes = new Set(mappings.flatMap((mapping) => mapping.class_uris));
  const properties = new Set(mappings.flatMap((mapping) => mapping.predicate_object_maps.map((pom) => pom.predicate_uri || pom.predicate)));
  return <><div className="r2-section-intro"><Layers3 size={22} /><h3>映射概览</h3><p>首屏只显示聚合关系；点击一个分组后再展开 TriplesMap。</p></div>
    <section className="r2-overview-stats"><div><strong>{groups.length}</strong><span>分组</span></div><div><strong>{mappings.length}</strong><span>映射</span></div><div><strong>{classes.size}</strong><span>本体类</span></div><div><strong>{properties.size}</strong><span>属性</span></div></section>
    <section className="r2-card"><h4><Filter size={14} />渐进式浏览</h4><ol className="r2-steps"><li><b>1</b><span>按逻辑表、本体类、文件或类型聚合</span></li><li><b>2</b><span>选择分组，只看相关 TriplesMap</span></li><li><b>3</b><span>选择单条映射，再按需展开字段和 Join</span></li></ol></section>
    <section className="r2-card"><h4>大图保护</h4><p className="r2-card-copy">41～100 个节点保持字段折叠；超过 100 个节点阻止全量展开，并要求先筛选。Draft 始终由用户主动开启。</p></section>
  </>;
}

function GroupDetail({ group, mappings, onSelectMapping }: { group: MappingGroup; mappings: TriplesMap[]; onSelectMapping: (id: string) => void }) {
  return <><div className="r2-section-intro"><Layers3 size={22} /><h3>{group.label}</h3><p>{group.subtitle} · 当前只显示该分组的一跳关系。</p></div>
    <section className="r2-overview-stats"><div><strong>{group.mappingCount}</strong><span>映射</span></div><div><strong>{group.classCount}</strong><span>类</span></div><div><strong>{group.propertyCount}</strong><span>属性</span></div><div><strong>{group.joinCount}</strong><span>Join</span></div></section>
    <section className="r2-card"><h4>TriplesMap</h4><div className="r2-mini-map-list">{mappings.map((mapping) => <button key={mapping.id} onClick={() => onSelectMapping(mapping.id)}><span>TM</span><div><strong>{mapping.name}</strong><small>{mapping.predicate_object_maps.length} 个 POM{mapping.canonical_iri_of ? " · Canonical" : ""}</small></div><ArrowRight size={12} /></button>)}</div></section>
    {group.issueCount > 0 && <section className="r2-card r2-group-warning"><h4><AlertTriangle size={14} />质量提示</h4><p>该分组关联 {group.issueCount} 条质量问题，可在“质量”页签定位。</p></section>}
  </>;
}

function MappingDetail({ mapping, selectedNode, onOpenOntologyEntity }: { mapping: TriplesMap; selectedNode: LineageNode | null; onOpenOntologyEntity: (uri: string) => void }) {
  return <>
    <div className="r2-entity-head"><span>TM</span><div><small>{mapping.draft ? "DRAFT TRIPLESMAP" : "TRIPLESMAP"}</small><h3>{mapping.name}</h3><code>{mapping.qname}</code></div></div>
    {selectedNode && <section className="r2-card selected-node"><h4>当前图节点</h4><div className="r2-node-kind">{TYPE_LABELS[selectedNode.type] || selectedNode.type}</div><strong>{selectedNode.label}</strong>{selectedNode.uri && <button onClick={() => onOpenOntologyEntity(selectedNode.uri!)}><ExternalLink size={13} />在本体图定位</button>}</section>}
    <section className="r2-card"><h4><Table2 size={14} />逻辑表</h4><dl><div><dt>方式</dt><dd>{mapping.logical_table.kind === "table" ? "rr:tableName" : "rr:sqlQuery"}</dd></div><div><dt>表 / 查询</dt><dd><code>{mapping.logical_table.table_name || mapping.logical_table.sql_query || "未声明"}</code></dd></div><div><dt>源文件</dt><dd title={mapping.source_file}>{mapping.source_file}</dd></div></dl></section>
    <section className="r2-card"><h4><Braces size={14} />SubjectMap</h4><dl><div><dt>模板</dt><dd><code>{mapping.subject_map.template || mapping.subject_map.column || "—"}</code></dd></div><div><dt>本体类</dt><dd>{mapping.classes.map((item, index) => <button className="r2-link" key={item} onClick={() => mapping.class_uris[index] && onOpenOntologyEntity(mapping.class_uris[index])}>{item}<ExternalLink size={11} /></button>)}</dd></div>{mapping.canonical_iri_of && <div><dt>Canonical IRI</dt><dd><code>{mapping.canonical_iri_of}</code></dd></div>}</dl></section>
    <section className="r2-card"><h4><Columns3 size={14} />PredicateObjectMap <em>{mapping.predicate_object_maps.length}</em></h4><div className="r2-pom-list">{mapping.predicate_object_maps.length ? mapping.predicate_object_maps.map((pom) => <article key={pom.id}><div><strong>{pom.predicate_local_name || pom.predicate}</strong><small>{pom.object_map.kind}</small></div><code>{pom.object_map.value || "—"}</code>{pom.object_map.datatype && <span>{pom.object_map.datatype}</span>}{pom.object_map.joins.map((join, index) => <p key={index}><GitMerge size={11} />{join.child} = {join.parent}</p>)}</article>) : <div className="r2-canonical-note"><CheckCircle2 size={16} />Canonical IRI 声明允许 0 个 POM</div>}</div></section>
  </>;
}

function ImpactDetail({ mapping, impact }: { mapping: TriplesMap; impact: { columns: string[]; templates: string[]; parents: string[]; joins: { predicate: string; child?: string; parent?: string }[]; referencedBy: TriplesMap[] } }) {
  return <><div className="r2-section-intro"><GitMerge size={20} /><h3>{mapping.name}</h3><p>静态上下游影响，不查询数据库中的真实数据。</p></div>
    <section className="r2-card"><h4>上游数据依赖</h4><div className="r2-chip-group"><span className="table-chip">{mapping.logical_table.table_name || "SQL query"}</span>{impact.columns.map((item) => <span key={item}>{item}</span>)}</div></section>
    <section className="r2-card"><h4>下游本体输出</h4><div className="r2-chip-group ontology">{mapping.classes.map((item) => <span key={item}>{item}</span>)}{mapping.predicate_object_maps.map((pom) => <span key={pom.id}>{pom.predicate_local_name}</span>)}</div></section>
    <section className="r2-card"><h4>映射关联</h4><dl><div><dt>引用父映射</dt><dd>{impact.parents.join("、") || "无"}</dd></div><div><dt>被其他映射引用</dt><dd>{impact.referencedBy.map((item) => item.name).join("、") || "无"}</dd></div><div><dt>IRI 模板</dt><dd>{impact.templates.join("、") || "无"}</dd></div></dl>{impact.joins.map((join, index) => <div className="r2-join" key={index}><GitMerge size={14} /><div><strong>{join.predicate}</strong><code>{join.child} = {join.parent}</code></div></div>)}</section>
  </>;
}

function QualityDetail({ analysis, issues, filter, onFilter, onSelect }: { analysis: R2RMLAnalysis | null; issues: MappingIssue[]; filter: "all" | MappingIssue["severity"]; onFilter: (value: "all" | MappingIssue["severity"]) => void; onSelect: (issue: MappingIssue) => void }) {
  const quality = analysis?.meta.quality || { errors: 0, warnings: 0, info: 0 };
  return <><div className="r2-quality-summary"><div className={quality.errors ? "bad" : "good"}>{quality.errors ? <FileWarning size={22} /> : <CheckCircle2 size={22} />}<strong>{quality.errors ? "存在阻断问题" : "结构可解析"}</strong><span>只读检查不会自动修改映射文件</span></div><div className="r2-quality-counts"><button className={filter === "error" ? "active error" : ""} onClick={() => onFilter(filter === "error" ? "all" : "error")}><b>{quality.errors}</b>错误</button><button className={filter === "warning" ? "active warning" : ""} onClick={() => onFilter(filter === "warning" ? "all" : "warning")}><b>{quality.warnings}</b>警告</button><button className={filter === "info" ? "active info" : ""} onClick={() => onFilter(filter === "info" ? "all" : "info")}><b>{quality.info}</b>提示</button></div></div>
    <div className="r2-issue-list">{issues.map((issue) => <button key={issue.id} className={issue.severity} onClick={() => onSelect(issue)}><SeverityIcon severity={issue.severity} /><div><strong>{issue.code}</strong><p>{issue.message}</p><small>{issue.mapping_name || issue.source_file}</small></div><ArrowRight size={13} /></button>)}{!issues.length && <div className="r2-no-issues"><CheckCircle2 size={24} /><strong>当前筛选下没有问题</strong></div>}</div>
  </>;
}

function EmptyDetail() {
  return <div className="r2-empty-detail"><Network size={28} /><strong>选择一个 TriplesMap</strong><span>查看逻辑表、SubjectMap、字段映射、Join 与上下游影响。</span></div>;
}
