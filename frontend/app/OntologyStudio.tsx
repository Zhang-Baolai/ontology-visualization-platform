"use client";

import cytoscape, {
  type Core,
  type ElementDefinition,
  type StylesheetJson,
} from "cytoscape";
import fcose from "cytoscape-fcose";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Copy,
  Database,
  Focus,
  FlaskConical,
  GitBranch,
  KeyRound,
  Layers3,
  Link2,
  Maximize,
  Moon,
  Network,
  PanelTop,
  PanelRight,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ScanSearch,
  Sun,
  Tag,
  Trash2,
  Unplug,
  Wrench,
  Waypoints,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  collapseInverseEdges,
  compactUri,
  loadOntologyCatalog,
  loadOntologyGraph,
  nodeDisplayName,
  type DisplayEdge,
} from "./ontology-data";
import type {
  DataSourceMode,
  OntologyCatalog,
  GraphNode,
  InspectorTab,
  LayoutName,
  OntologyGraph,
} from "./ontology-types";
import MaintenanceDrawer from "./MaintenanceDrawer";
import { downloadBlob } from "./ontology-maintenance";
import { loadSemanticGraph } from "./semantic-analysis";
import { collectNeighborhood, graphNodeColor, graphNodeGlyph } from "./ontology-visual";
import {
  loadNodeAliases,
  nodeMatchesPresentation,
  nodePresentationName,
  persistNodeAliases,
  updateNodeAlias,
  type NodeAliasMap,
} from "./ontology-aliases";
import {
  edgeBendFromPoint,
  type EdgeBend,
  type GraphPoint,
} from "./ontology-edge-drag";

cytoscape.use(fcose);

const SemanticAnalysisDrawer = lazy(() => import("./SemanticAnalysisDrawer"));
const R2RMLExplorer = lazy(() => import("./R2RMLExplorer"));
const OntologyGraph3D = lazy(() => import("./OntologyGraph3D"));

type LeftTab = "hierarchy" | "classes" | "warnings";
type ThemeName = "light" | "dark";
type ViewScope = "module" | "domain";
type LabelDensity = "focus" | "all" | "none";
type GraphDimension = "2d" | "3d";

const viteEnv = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env;

const DEFAULT_API_BASE_URL =
  viteEnv?.VITE_API_BASE_URL ||
  "http://127.0.0.1:8000";

const LAYOUT_LABELS: Record<LayoutName, string> = {
  hierarchy: "层次",
  force: "智能",
  circle: "环形",
};

function graphStyles(theme: ThemeName): StylesheetJson {
  const dark = theme === "dark";
  return [
    {
      selector: "node",
      style: {
        width: 126,
        height: 42,
        shape: "round-rectangle",
        label: "data(label)",
        "font-size": 12,
        "font-family": "Segoe UI, Inter, ui-sans-serif, system-ui, sans-serif",
        "font-weight": 600,
        color: dark ? "#e8edf7" : "#1f2a44",
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "ellipsis",
        "text-max-width": "106px",
        "text-margin-y": 0,
        "background-color": dark ? "#20283a" : "#ffffff",
        "background-opacity": 1,
        "border-color": dark ? "#46516a" : "#aeb9cc",
        "border-opacity": 1,
        "border-width": 1.4,
        "transition-property": "border-width, border-color, background-color, opacity",
        "transition-duration": 180,
        "overlay-opacity": 0,
      },
    },
    {
      selector: "node.root-class",
      style: {
        "background-color": dark ? "#273356" : "#edf2ff",
        "border-color": "#5876d8",
        "border-width": 2,
      },
    },
    {
      selector: "node.search-match",
      style: {
        "background-color": dark ? "#433c25" : "#fff6cf",
        "border-color": "#d39b19",
        "border-width": 2.5,
      },
    },
    {
      selector: "node.module-dimension",
      style: { "border-color": "#4f7fd8" },
    },
    {
      selector: "node.module-metric",
      style: { "border-color": "#24a278" },
    },
    {
      selector: "node.module-capability",
      style: { "border-color": "#c4802f" },
    },
    {
      selector: "node.module-scenario",
      style: { "border-color": "#b45a87" },
    },
    {
      selector: "node.path-node",
      style: {
        "background-color": dark ? "#59451e" : "#fff0b8",
        "border-color": "#e89b18",
        "border-width": 3.5,
      },
    },
    {
      selector: "node:selected",
      style: {
        "background-color": dark ? "#283f75" : "#e6edff",
        "border-color": "#365fca",
        "border-width": 3,
      },
    },
    {
      selector: "edge",
      style: {
        width: 2,
        "line-color": dark ? "#6e778b" : "#7d8798",
        "target-arrow-color": dark ? "#6e778b" : "#7d8798",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.82,
        "curve-style": "unbundled-bezier",
        "control-point-step-size": 58,
        "edge-distances": "node-position",
        label: "",
        "font-size": 10,
        "min-zoomed-font-size": 0,
        color: dark ? "#b5bfd2" : "#58647a",
        "text-background-color": dark ? "#161c28" : "#f8f9fc",
        "text-background-opacity": 0.94,
        "text-background-padding": "3px",
        "text-background-shape": "roundrectangle",
        "text-rotation": "autorotate",
        "text-margin-y": -8,
        "text-wrap": "ellipsis",
        "text-max-width": "120px",
        "transition-property": "width, line-color, target-arrow-color, opacity",
        "transition-duration": 180,
        "overlay-opacity": 0,
      },
    },
    {
      selector: "edge.show-label, edge:selected",
      style: { label: "data(displayLabel)" },
    },
    {
      selector: "edge.manual-bend",
      style: {
        "curve-style": "unbundled-bezier",
        "control-point-distances": "data(controlPointDistance)",
        "control-point-weights": "data(controlPointWeight)",
      },
    },
    {
      selector: "edge.subclass",
      style: {
        "line-color": "#8a64b8",
        "target-arrow-color": "#8a64b8",
        "line-style": "dashed",
        width: 2,
      },
    },
    {
      selector: "edge.object-property",
      style: { opacity: 0.46 },
    },
    {
      selector: "edge.inferred",
      style: {
        "line-color": "#d77b55",
        "target-arrow-color": "#d77b55",
        "line-style": "dotted",
        opacity: 0.3,
      },
    },
    {
      selector: "edge.cross-module",
      style: {
        "line-color": "#2f9a8b",
        "target-arrow-color": "#2f9a8b",
        width: 2,
      },
    },
    {
      selector: "edge.path-edge",
      style: {
        "line-color": "#e89b18",
        "source-arrow-color": "#e89b18",
        "target-arrow-color": "#e89b18",
        width: 4,
        "line-style": "solid",
        opacity: 1,
      },
    },
    {
      selector: "edge.bidirectional",
      style: {
        "source-arrow-shape": "triangle",
        "source-arrow-color": dark ? "#62708c" : "#8390a8",
      },
    },
    {
      selector: "edge:selected",
      style: {
        width: 5,
        "line-color": "#0078d4",
        "source-arrow-color": "#0078d4",
        "target-arrow-color": "#0078d4",
        color: dark ? "#e9efff" : "#214da8",
      },
    },
    {
      selector: "node.context-dimmed",
      style: { opacity: 0.16 },
    },
    {
      selector: "edge.context-dimmed",
      style: { opacity: 0.055 },
    },
    {
      selector: "node.context-visible",
      style: { opacity: 1 },
    },
    {
      selector: "edge.context-visible",
      style: { opacity: 1, width: 3 },
    },
  ];
}

function layoutOptions(layout: LayoutName) {
  if (layout === "hierarchy") {
    return {
      name: "breadthfirst",
      directed: true,
      padding: 48,
      spacingFactor: 1.45,
      animate: false,
    };
  }
  if (layout === "circle") {
    return { name: "circle", padding: 56, spacingFactor: 1.15, animate: false };
  }
  return {
    name: "fcose",
    quality: "proof",
    randomize: true,
    padding: 70,
    animate: false,
    fit: true,
    nodeDimensionsIncludeLabels: true,
    nodeRepulsion: () => 18000,
    idealEdgeLength: () => 215,
    edgeElasticity: () => 0.38,
    nestingFactor: 0.1,
    gravity: 0.18,
    gravityRange: 4.5,
    numIter: 2500,
    tile: true,
    tilingPaddingVertical: 55,
    tilingPaddingHorizontal: 55,
    nodeSeparation: 120,
  };
}

function applyStoredEdgeBend(
  cy: Core,
  edgeId: string,
  bend: EdgeBend,
): boolean {
  const edge = cy.getElementById(edgeId);
  if (!edge.length || !edge.isEdge()) return false;
  edge.data("controlPointDistance", bend.distance);
  edge.data("controlPointWeight", bend.weight);
  edge.addClass("manual-bend");
  return true;
}

function dragEdgeToPoint(
  cy: Core,
  edgeId: string,
  point: GraphPoint,
  bends: Map<string, EdgeBend>,
): boolean {
  const edge = cy.getElementById(edgeId);
  if (!edge.length || !edge.isEdge()) return false;
  const bend = edgeBendFromPoint(
    edge.source().position(),
    edge.target().position(),
    point,
  );
  bends.set(edgeId, bend);
  return applyStoredEdgeBend(cy, edgeId, bend);
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="header-metric">
      <span>{value}</span>
      <small>{label}</small>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  tone,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  tone: "purple" | "blue" | "orange";
}) {
  return (
    <label className={`filter-toggle ${checked ? "is-on" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={`filter-mark ${tone}`} />
      {label}
    </label>
  );
}

function Accordion({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="inspector-section">
      <button
        className="section-heading"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="section-heading-right">
          {typeof count === "number" && <em>{count}</em>}
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

function SidebarHierarchy({
  graph,
  aliases,
  selectedId,
  onSelect,
}: {
  graph: OntologyGraph | null;
  aliases: NodeAliasMap;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const hierarchy = useMemo(() => {
    const children = new Map<string, string[]>();
    const parentIds = new Set<string>();
    const nodeIds = new Set(graph?.nodes.map((node) => node.id) || []);
    for (const edge of graph?.edges || []) {
      if (edge.edge_type !== "subClassOf") continue;
      const current = children.get(edge.target) || [];
      current.push(edge.source);
      children.set(edge.target, current);
      parentIds.add(edge.source);
    }
    const roots = [...nodeIds].filter((id) => !parentIds.has(id));
    return { children, roots };
  }, [graph]);

  if (!graph?.nodes.length) return <div className="zero-state compact">暂无类层次</div>;
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  return (
    <div className="sidebar-tree">
      {hierarchy.roots.map((id) => (
        <SidebarHierarchyNode
          key={id}
          id={id}
          depth={0}
          trail={new Set()}
          children={hierarchy.children}
          nodeMap={nodeMap}
          aliases={aliases}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function SidebarHierarchyNode({
  id,
  depth,
  trail,
  children,
  nodeMap,
  aliases,
  selectedId,
  onSelect,
}: {
  id: string;
  depth: number;
  trail: Set<string>;
  children: Map<string, string[]>;
  nodeMap: Map<string, GraphNode>;
  aliases: NodeAliasMap;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const node = nodeMap.get(id);
  if (!node || trail.has(id)) return null;
  const childIds = children.get(id) || [];
  const nextTrail = new Set(trail).add(id);
  return (
    <div className="sidebar-tree-node">
      <div style={{ paddingLeft: `${depth * 13 + 8}px` }}>
        <button
          className="sidebar-tree-toggle"
          disabled={!childIds.length}
          onClick={() => setOpen((current) => !current)}
          aria-label={open ? "折叠子类" : "展开子类"}
        >
          {childIds.length ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <i />}
        </button>
        <button
          className={`sidebar-tree-label ${selectedId === id ? "active" : ""}`}
          onClick={() => onSelect(id)}
        >
          <i className={`module-dot module-${node.module || "external"}`} />
          <span>
            <strong>{nodePresentationName(node, aliases)}</strong>
            <small>{aliases[node.id] ? `${nodeDisplayName(node)} · ` : ""}{childIds.length} 子类 · {node.datatype_properties.length + node.object_properties.length} 属性</small>
          </span>
        </button>
      </div>
      {open && childIds.map((childId) => (
        <SidebarHierarchyNode
          key={childId}
          id={childId}
          depth={depth + 1}
          trail={nextTrail}
          children={children}
          nodeMap={nodeMap}
          aliases={aliases}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function nodeNameById(graph: OntologyGraph | null, aliases: NodeAliasMap, id: string): string {
  const node = graph?.nodes.find((item) => item.id === id);
  return node ? nodePresentationName(node, aliases) : compactUri(id);
}

function searchRank(node: GraphNode, aliases: NodeAliasMap, query: string): number {
  const normalized = query.trim().toLocaleLowerCase();
  const names = [aliases[node.id], node.label, node.local_name, node.qname]
    .filter(Boolean)
    .map((value) => String(value).toLocaleLowerCase());
  if (names.some((value) => value === normalized)) return 0;
  if (names.some((value) => value.startsWith(normalized))) return 1;
  if (names.some((value) => value.includes(normalized))) return 2;
  return 3;
}

export default function OntologyStudio({
  initialSource = "api",
}: {
  initialSource?: DataSourceMode;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const catalogAbortRef = useRef<AbortController | null>(null);
  const edgeBendsRef = useRef(new Map<string, EdgeBend>());

  const [theme, setTheme] = useState<ThemeName>(() => {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  const [sourceMode, setSourceMode] = useState<DataSourceMode>(initialSource);
  const [viewScope, setViewScope] = useState<ViewScope>("module");
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [domain, setDomain] = useState("cloud-demo");
  const [module, setModule] = useState("dimension");
  const [catalog, setCatalog] = useState<OntologyCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [graph, setGraph] = useState<OntologyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [edgeHandlePosition, setEdgeHandlePosition] = useState<GraphPoint | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("hierarchy");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [layout, setLayout] = useState<LayoutName>("force");
  const [graphDimension, setGraphDimension] = useState<GraphDimension>("2d");
  const [labelDensity, setLabelDensity] = useState<LabelDensity>("focus");
  const [showSubclass, setShowSubclass] = useState(true);
  const [showObjectRelationships, setShowObjectRelationships] = useState(true);
  const [showInferred, setShowInferred] = useState(true);
  const [collapseInverse, setCollapseInverse] = useState(true);
  const [neighborhoodDepth, setNeighborhoodDepth] = useState<0 | 1 | 2>(0);
  const [activeModules, setActiveModules] = useState<string[]>([]);
  const [pathNodeIds, setPathNodeIds] = useState<string[]>([]);
  const [pathEdgeIds, setPathEdgeIds] = useState<string[]>([]);
  const [nodeAliases, setNodeAliases] = useState<NodeAliasMap>(() =>
    loadNodeAliases(typeof window === "undefined" ? undefined : window.localStorage),
  );
  const [aliasDraft, setAliasDraft] = useState("");
  const [aliasSaved, setAliasSaved] = useState(false);
  const [viewHistory, setViewHistory] = useState<
    { selectedNodeId: string | null; depth: 0 | 1 | 2; modules: string[] }[]
  >([]);
  const [copied, setCopied] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const interactionRef = useRef({
    selectedNodeId: null as string | null,
    selectedEdgeId: null as string | null,
    neighborhoodDepth: 0 as 0 | 1 | 2,
    labelDensity: "focus" as LabelDensity,
  });

  useEffect(() => {
    interactionRef.current = {
      selectedNodeId,
      selectedEdgeId,
      neighborhoodDepth,
      labelDensity,
    };
  }, [labelDensity, neighborhoodDepth, selectedEdgeId, selectedNodeId]);

  useEffect(() => {
    persistNodeAliases(
      typeof window === "undefined" ? undefined : window.localStorage,
      nodeAliases,
    );
  }, [nodeAliases]);

  useEffect(() => {
    setAliasDraft(selectedNodeId ? nodeAliases[selectedNodeId] || "" : "");
    setAliasSaved(false);
    // Alias edits update the draft directly; this effect only initializes the next selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  const fetchGraph = useCallback(
    async (nextSource = sourceMode, nextScope = viewScope) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      edgeBendsRef.current.clear();
      setEdgeHandlePosition(null);
      setNeighborhoodDepth(0);
      setPathNodeIds([]);
      setPathEdgeIds([]);
      try {
        const data =
          nextSource === "api" && nextScope === "domain"
            ? await loadSemanticGraph(apiBaseUrl, domain, controller.signal)
            : await loadOntologyGraph({
                source: nextSource,
                baseUrl: apiBaseUrl,
                domain,
                module,
                signal: controller.signal,
              });
        setGraph(data);
        setActiveModules(Object.keys(data.meta.module_counts || {}));
        setViewHistory([]);
        setLabelDensity(data.edges.length <= 24 ? "all" : "focus");
        if (data.meta.recommended_render_mode === "filtered") {
          setLayout("hierarchy");
        }
        if (data.meta.recommended_render_mode === "neighborhood" && data.nodes[0]) {
          const center = data.nodes.find((node) => node.sub_class_of.length === 0) || data.nodes[0];
          setSelectedNodeId(center.id);
          setNeighborhoodDepth(1);
          setLayout("hierarchy");
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : "本体数据加载失败。",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [apiBaseUrl, domain, module, sourceMode, viewScope],
  );

  const refreshCatalog = useCallback(async () => {
    catalogAbortRef.current?.abort();
    const controller = new AbortController();
    catalogAbortRef.current = controller;
    setCatalogLoading(true);
    try {
      const data = await loadOntologyCatalog(apiBaseUrl, controller.signal);
      setCatalog(data);
      const selectedDomain =
        data.domains.find((item) => item.id === domain) || data.domains[0];
      if (selectedDomain) {
        setDomain(selectedDomain.id);
        const selectedModule =
          selectedDomain.modules.find((item) => item.id === module) ||
          selectedDomain.modules[0];
        if (selectedModule) setModule(selectedModule.id);
      }
    } catch (catalogError) {
      if (catalogError instanceof DOMException && catalogError.name === "AbortError") {
        return;
      }
      setCatalog(null);
    } finally {
      if (!controller.signal.aborted) setCatalogLoading(false);
    }
  }, [apiBaseUrl, domain, module]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      if (initialSource === "api") refreshCatalog();
      fetchGraph(initialSource);
    }, 0);
    return () => {
      window.clearTimeout(initialLoad);
      abortRef.current?.abort();
      catalogAbortRef.current?.abort();
    };
    // Initial connection intentionally runs only once; later reloads are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canvasRef.current || cyRef.current) return;
    const cy = cytoscape({
      container: canvasRef.current,
      elements: [],
      style: graphStyles("light"),
      minZoom: 0.22,
      maxZoom: 2.8,
      boxSelectionEnabled: false,
    });

    cy.on("tap", "node", (event) => {
      setSelectedNodeId(event.target.id());
      setSelectedEdgeId(null);
      setInspectorTab("overview");
    });
    cy.on("dbltap", "node", (event) => {
      setSelectedNodeId(event.target.id());
      setSelectedEdgeId(null);
      setNeighborhoodDepth((current) => (current === 0 ? 1 : current === 1 ? 2 : 0));
    });
    let draggedEdgeId: string | null = null;
    cy.on("tapstart", "edge", (event) => {
      draggedEdgeId = event.target.id();
      setSelectedEdgeId(draggedEdgeId);
      setSelectedNodeId(null);
      cy.userPanningEnabled(false);
    });
    cy.on("tapdrag", (event) => {
      if (!draggedEdgeId || !event.position) return;
      dragEdgeToPoint(cy, draggedEdgeId, event.position, edgeBendsRef.current);
    });
    cy.on("tapend", () => {
      draggedEdgeId = null;
      cy.userPanningEnabled(true);
    });
    cy.on("tap", "edge", (event) => {
      setSelectedEdgeId(event.target.id());
      setSelectedNodeId(null);
    });
    cy.on("tap", (event) => {
      if (event.target === cy) {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setNeighborhoodDepth(0);
      }
    });
    cy.on("mouseover", "node", (event) => {
      const current = interactionRef.current;
      if (current.selectedNodeId || current.selectedEdgeId || current.neighborhoodDepth) return;
      const neighborhood = event.target.closedNeighborhood();
      cy.elements().addClass("context-dimmed");
      neighborhood.removeClass("context-dimmed").addClass("context-visible");
      neighborhood.edges().addClass("show-label");
    });
    cy.on("mouseout", "node", () => {
      const current = interactionRef.current;
      if (current.selectedNodeId || current.selectedEdgeId || current.neighborhoodDepth) return;
      cy.elements().removeClass("context-dimmed context-visible");
      if (current.labelDensity !== "all") cy.edges().removeClass("show-label");
    });
    cy.on("mouseover", "edge", (event) => {
      if (interactionRef.current.labelDensity !== "none") event.target.addClass("show-label");
    });
    cy.on("mouseout", "edge", (event) => {
      if (interactionRef.current.labelDensity === "focus" && !event.target.selected()) {
        event.target.removeClass("show-label");
      }
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    cyRef.current?.style(graphStyles(theme));
  }, [theme]);

  useEffect(() => {
    if (graphDimension !== "2d") return;
    window.requestAnimationFrame(() => cyRef.current?.resize());
  }, [graphDimension]);

  const searchResults = useMemo(() => {
    if (!graph || !searchQuery.trim()) return [];
    return graph.nodes
      .filter((node) => nodeMatchesPresentation(node, nodeAliases, searchQuery))
      .sort(
        (left, right) =>
          searchRank(left, nodeAliases, searchQuery) -
          searchRank(right, nodeAliases, searchQuery),
      );
  }, [graph, nodeAliases, searchQuery]);

  const displayEdges = useMemo<DisplayEdge[]>(() => {
    if (!graph) return [];
    const filtered = graph.edges.filter((edge) => {
      if (edge.inferred && !showInferred) return false;
      if (edge.edge_type === "subClassOf") return showSubclass;
      if (edge.edge_type === "objectProperty") return showObjectRelationships;
      return false;
    });
    return collapseInverse ? collapseInverseEdges(filtered) : filtered;
  }, [collapseInverse, graph, showInferred, showObjectRelationships, showSubclass]);

  const visibleGraph = useMemo(() => {
    if (!graph) return { nodes: [] as GraphNode[], edges: [] as DisplayEdge[] };
    const moduleFilteredNodes =
      viewScope === "domain" && activeModules.length
        ? graph.nodes.filter((node) => activeModules.includes(node.module || "external"))
        : graph.nodes;
    const moduleIds = new Set(moduleFilteredNodes.map((node) => node.id));
    const moduleFilteredEdges = displayEdges.filter(
      (edge) => moduleIds.has(edge.source) && moduleIds.has(edge.target),
    );

    return { nodes: moduleFilteredNodes, edges: moduleFilteredEdges };
  }, [activeModules, displayEdges, graph, viewScope]);

  const elements = useMemo<ElementDefinition[]>(() => {
    const nodeElements: ElementDefinition[] = visibleGraph.nodes.map((node) => ({
      group: "nodes",
      data: {
        id: node.id,
        label: `${graphNodeGlyph(node)} ${nodePresentationName(node, nodeAliases)}`,
        qname: node.qname,
        color: graphNodeColor(node),
      },
      classes: [
        node.sub_class_of.length === 0 ? "root-class" : "",
        nodeMatchesPresentation(node, nodeAliases, searchQuery) ? "search-match" : "",
        node.module ? `module-${node.module}` : "",
        pathNodeIds.includes(node.id) ? "path-node" : "",
      ]
        .filter(Boolean)
        .join(" "),
    }));

    const edgeElements: ElementDefinition[] = visibleGraph.edges.map((edge) => ({
      group: "edges",
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        displayLabel:
          edge.edge_type === "subClassOf"
            ? "is a"
            : edge.bidirectional
              ? `${edge.label} ↔ ${edge.reverse_label || "反向关系"}`
              : edge.label,
      },
      classes: [
        edge.edge_type === "subClassOf" ? "subclass" : "object-property",
        edge.inferred ? "inferred" : "",
        edge.bidirectional ? "bidirectional" : "",
        edge.cross_module ? "cross-module" : "",
        pathEdgeIds.includes(edge.id) ||
        edge.original_edge_ids?.some((id) => pathEdgeIds.includes(id))
          ? "path-edge"
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    }));
    return [...nodeElements, ...edgeElements];
  }, [nodeAliases, pathEdgeIds, pathNodeIds, searchQuery, visibleGraph]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().remove();
    if (elements.length === 0) return;
    cy.add(elements);
    const graphLayout = cy.layout(layoutOptions(layout));
    graphLayout.one("layoutstop", () => {
      edgeBendsRef.current.forEach((bend, edgeId) => {
        applyStoredEdgeBend(cy, edgeId, bend);
      });
    });
    graphLayout.run();
  }, [elements, layout]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || graphDimension !== "2d" || !selectedEdgeId) {
      setEdgeHandlePosition(null);
      return;
    }

    const refreshHandle = () => {
      const edge = cy.getElementById(selectedEdgeId);
      if (!edge.length || !edge.isEdge()) {
        setEdgeHandlePosition(null);
        return;
      }
      const point = edge.renderedControlPoints()[0] || edge.renderedMidpoint();
      setEdgeHandlePosition({ x: point.x, y: point.y });
    };

    const frame = window.requestAnimationFrame(refreshHandle);
    cy.on("pan zoom resize", refreshHandle);
    cy.on("position", "node", refreshHandle);
    cy.on("style", "edge", refreshHandle);
    return () => {
      window.cancelAnimationFrame(frame);
      cy.off("pan zoom resize", refreshHandle);
      cy.off("position", "node", refreshHandle);
      cy.off("style", "edge", refreshHandle);
    };
  }, [elements, graphDimension, selectedEdgeId]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().unselect().removeClass("context-dimmed context-visible");
    if (labelDensity !== "all") cy.edges().removeClass("show-label");
    if (labelDensity === "all") cy.edges().addClass("show-label");

    if (selectedEdgeId) {
      const edge = cy.getElementById(selectedEdgeId);
      if (edge.length) {
        cy.elements().addClass("context-dimmed");
        edge.select().removeClass("context-dimmed").addClass("context-visible show-label");
        edge.connectedNodes().removeClass("context-dimmed").addClass("context-visible");
      }
      return;
    }

    if (!selectedNodeId) return;
    const node = cy.getElementById(selectedNodeId);
    if (!node.length) return;
    node.select();
    const context = collectNeighborhood(selectedNodeId, visibleGraph.edges, neighborhoodDepth || 1);
    cy.elements().addClass("context-dimmed");
    for (const nodeId of context.nodeIds) {
      cy.getElementById(nodeId).removeClass("context-dimmed").addClass("context-visible");
    }
    for (const edgeId of context.edgeIds) {
      const edge = cy.getElementById(edgeId);
      edge.removeClass("context-dimmed").addClass("context-visible");
      if (labelDensity !== "none") edge.addClass("show-label");
    }
  }, [labelDensity, neighborhoodDepth, selectedEdgeId, selectedNodeId, visibleGraph.edges]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || pathNodeIds.length === 0) return;
    cy.nodes(".path-node").removeClass("context-dimmed").addClass("context-visible");
    cy.edges(".path-edge")
      .removeClass("context-dimmed")
      .addClass("context-visible show-label");
  }, [elements, pathEdgeIds, pathNodeIds]);

  const selectedNode = useMemo(
    () => graph?.nodes.find((node) => node.id === selectedNodeId) || null,
    [graph, selectedNodeId],
  );

  const selectedEdge = useMemo(
    () => displayEdges.find((edge) => edge.id === selectedEdgeId) || null,
    [displayEdges, selectedEdgeId],
  );

  const catalogDomains = catalog?.domains || [];
  const selectedCatalogDomain = catalogDomains.find((item) => item.id === domain);
  const catalogModules = selectedCatalogDomain?.modules || [];

  const incomingEdges = useMemo(
    () =>
      selectedNode && graph
        ? graph.edges.filter(
            (edge) =>
              edge.edge_type === "objectProperty" && edge.target === selectedNode.id,
          )
        : [],
    [graph, selectedNode],
  );

  function selectNode(id: string) {
    const target = graph?.nodes.find((node) => node.id === id);
    if (
      viewScope === "domain" &&
      target?.module &&
      activeModules.length &&
      !activeModules.includes(target.module)
    ) {
      setActiveModules((current) => [...current, target.module as string]);
    }
    if (selectedNodeId && selectedNodeId !== id) {
      setViewHistory((current) => [
        ...current.slice(-19),
        { selectedNodeId, depth: neighborhoodDepth, modules: [...activeModules] },
      ]);
    }
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setSearchOpen(false);
    setInspectorTab("overview");
    window.requestAnimationFrame(() => {
      const node = cyRef.current?.getElementById(id);
      if (node?.length) {
        cyRef.current?.animate({ center: { eles: node }, duration: 260 });
      }
    });
  }

  function changeSource(mode: DataSourceMode) {
    setSourceMode(mode);
    setError(null);
    if (mode === "mock") setViewScope("module");
    if (mode === "api") refreshCatalog();
  }

  function switchToMock() {
    setSourceMode("mock");
    setViewScope("module");
    fetchGraph("mock");
  }

  function changeScope(nextScope: ViewScope) {
    setViewScope(nextScope);
    setError(null);
    if (nextScope === "domain") setLeftTab("hierarchy");
    fetchGraph(sourceMode, nextScope);
  }

  function toggleModule(moduleId: string) {
    setActiveModules((current) =>
      current.includes(moduleId)
        ? current.filter((item) => item !== moduleId)
        : [...current, moduleId],
    );
  }

  function restorePreviousView() {
    setViewHistory((current) => {
      const previous = current[current.length - 1];
      if (!previous) return current;
      setSelectedNodeId(previous.selectedNodeId);
      setSelectedEdgeId(null);
      setNeighborhoodDepth(previous.depth);
      setActiveModules(previous.modules);
      return current.slice(0, -1);
    });
  }

  function applyLayout(nextLayout: LayoutName) {
    setLayout(nextLayout);
    const cy = cyRef.current;
    if (cy && cy.nodes().length) cy.layout(layoutOptions(nextLayout)).run();
  }

  function copyText(value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }

  function saveSelectedAlias() {
    if (!selectedNode) return;
    setNodeAliases((current) => updateNodeAlias(current, selectedNode.id, aliasDraft));
    setAliasSaved(true);
    window.setTimeout(() => setAliasSaved(false), 1600);
  }

  function clearSelectedAlias() {
    if (!selectedNode) return;
    setAliasDraft("");
    setNodeAliases((current) => updateNodeAlias(current, selectedNode.id, ""));
    setAliasSaved(false);
  }

  function beginEdgeHandleDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const cy = cyRef.current;
    const edgeId = selectedEdgeId;
    const canvas = canvasRef.current;
    if (!cy || !edgeId || !canvas) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    cy.userPanningEnabled(false);

    const move = (pointerEvent: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const pan = cy.pan();
      const zoom = cy.zoom();
      const rendered = {
        x: pointerEvent.clientX - bounds.left,
        y: pointerEvent.clientY - bounds.top,
      };
      const model = {
        x: (rendered.x - pan.x) / zoom,
        y: (rendered.y - pan.y) / zoom,
      };
      if (dragEdgeToPoint(cy, edgeId, model, edgeBendsRef.current)) {
        setEdgeHandlePosition(rendered);
      }
    };
    const finish = () => {
      cy.userPanningEnabled(true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function resetView() {
    setSearchQuery("");
    setSearchOpen(false);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setNeighborhoodDepth(0);
    setPathNodeIds([]);
    setPathEdgeIds([]);
    setActiveModules(Object.keys(graph?.meta.module_counts || {}));
    setViewHistory([]);
    setShowSubclass(true);
    setShowObjectRelationships(true);
    setShowInferred(true);
    setCollapseInverse(true);
    setLabelDensity((graph?.edges.length || 0) <= 24 ? "all" : "focus");
    setLayout("force");
    edgeBendsRef.current.clear();
    cyRef.current?.edges().removeClass("manual-bend");
    window.requestAnimationFrame(() => {
      const cy = cyRef.current;
      if (cy?.nodes().length) cy.layout(layoutOptions("force")).run();
    });
  }

  function changeDomain(nextDomain: string) {
    setDomain(nextDomain);
    const next = catalogDomains.find((item) => item.id === nextDomain);
    if (next?.modules[0]) setModule(next.modules[0].id);
  }

  function exportCurrentView(format: "png" | "svg" | "json") {
    const cy = cyRef.current;
    if (!cy || !graph) return;
    const filename = `${domain}-${module}-view`;
    if (format === "png") {
      const blob = cy.png({
        output: "blob",
        full: true,
        scale: 2,
        bg: theme === "dark" ? "#101521" : "#f8f9fc",
      }) as Blob;
      downloadBlob(blob, `${filename}.png`);
      return;
    }
    if (format === "json") {
      downloadBlob(
        new Blob(
          [
            JSON.stringify(
              { meta: graph.meta, nodes: visibleGraph.nodes, edges: visibleGraph.edges },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
        `${filename}.json`,
      );
      return;
    }

    const escapeXml = (value: string) =>
      value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] || character);
    const bounds = cy.elements().boundingBox({ includeLabels: true });
    const pad = 48;
    const width = Math.max(320, Math.ceil(bounds.w + pad * 2));
    const height = Math.max(240, Math.ceil(bounds.h + pad * 2));
    const offsetX = pad - bounds.x1;
    const offsetY = pad - bounds.y1;
    const edgeSvg = cy.edges().map((edge) => {
      const source = edge.source().position();
      const target = edge.target().position();
      const color = edge.hasClass("subclass")
        ? "#8a64b8"
        : edge.hasClass("inferred")
          ? "#d77b55"
          : "#6680aa";
      return `<line x1="${source.x + offsetX}" y1="${source.y + offsetY}" x2="${target.x + offsetX}" y2="${target.y + offsetY}" stroke="${color}" stroke-width="1.5" opacity="0.82"/>`;
    }).join("");
    const nodeSvg = cy.nodes().map((node) => {
      const position = node.position();
      const x = position.x + offsetX - 63;
      const y = position.y + offsetY - 21;
      return `<g><rect x="${x}" y="${y}" width="126" height="42" rx="10" fill="${theme === "dark" ? "#20283a" : "#ffffff"}" stroke="#5876d8" stroke-width="1.5"/><text x="${position.x + offsetX}" y="${position.y + offsetY + 4}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="12" font-weight="600" fill="${theme === "dark" ? "#e8edf7" : "#1f2a44"}">${escapeXml(String(node.data("label")))}</text></g>`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${theme === "dark" ? "#101521" : "#f8f9fc"}"/>${edgeSvg}${nodeSvg}</svg>`;
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${filename}.svg`);
  }

  async function handleMaintenanceSaved() {
    await refreshCatalog();
    await fetchGraph("api");
  }

  const sourceLabel =
    sourceMode === "mock" ? "示例数据" : viewScope === "domain" ? "领域分析" : "Graph API";

  return (
    <main className="ontology-shell" data-theme={theme}>
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <Network size={22} strokeWidth={1.8} />
          </div>
          <div>
            <div className="eyebrow">ONTOLOGY WORKBENCH</div>
            <h1>本体可视化平台</h1>
          </div>
        </div>

        <div className="ontology-title-block">
          <span className="ontology-kicker">当前本体</span>
          <strong>{graph?.meta.ontology_label || "正在读取本体…"}</strong>
          <span>{graph?.meta.ontology_comment || "TTL 语义结构浏览与校验"}</span>
        </div>

        <div className="header-stats" aria-label="本体统计">
          <Metric value={graph?.meta.total_classes || 0} label="类" />
          <Metric value={graph?.meta.total_datatype_properties || 0} label="数据属性" />
          <Metric value={graph?.meta.total_object_properties || 0} label="对象属性" />
          <Metric value={graph?.meta.total_warnings || 0} label="警告" />
        </div>

        <div className="header-actions">
          <button
            className="mapping-entry"
            onClick={() => setMappingOpen(true)}
            disabled={sourceMode !== "api"}
            title={sourceMode === "api" ? "打开离线 R2RML 数据映射工作台" : "请先切换到真实 API"}
          >
            <Waypoints size={15} />
            数据映射
          </button>
          <button
            className="analysis-entry"
            onClick={() => {
              setAnalysisOpen(true);
              if (sourceMode === "api" && viewScope !== "domain") changeScope("domain");
            }}
            disabled={Boolean(error)}
            title={sourceMode === "mock" ? "打开示例数据分析演示" : "打开跨模块语义分析中心"}
          >
            <ScanSearch size={15} />
            语义分析
          </button>
          <button
            className="maintenance-entry"
            onClick={() => setMaintenanceOpen(true)}
            disabled={sourceMode !== "api" || Boolean(error) || viewScope === "domain" || module === "all"}
            title={viewScope === "domain" ? "请切换到单模块视图后维护" : sourceMode === "api" ? "打开本体维护中心" : "请先切换到真实 API"}
          >
            <Wrench size={15} />
            维护本体
          </button>
          <span className={`connection-status ${error ? "has-error" : ""}`}>
            <i />
            {error ? "连接异常" : sourceLabel}
          </span>
          <button
            className="icon-button"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"}
            title={theme === "light" ? "深色主题" : "浅色主题"}
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <section className="connection-panel">
            <div className="panel-label">数据连接</div>
            <div className="source-switch" role="group" aria-label="数据来源">
              <button
                className={sourceMode === "mock" ? "active" : ""}
                onClick={() => changeSource("mock")}
              >
                <FlaskConical size={14} /> 示例
              </button>
              <button
                className={sourceMode === "api" ? "active" : ""}
                onClick={() => changeSource("api")}
              >
                <Database size={14} /> API
              </button>
            </div>

            {sourceMode === "api" && (
              <div className="scope-switch" role="group" aria-label="图谱范围">
                <button className={viewScope === "module" ? "active" : ""} onClick={() => changeScope("module")}>
                  <Layers3 size={13} /> 单模块
                </button>
                <button className={viewScope === "domain" ? "active" : ""} onClick={() => changeScope("domain")}>
                  <GitBranch size={13} /> 跨模块
                </button>
              </div>
            )}

            {sourceMode === "api" && (
              <label className="field-group wide-field">
                <span>服务地址</span>
                <input
                  value={apiBaseUrl}
                  onChange={(event) => setApiBaseUrl(event.target.value)}
                  placeholder="http://127.0.0.1:8000"
                />
              </label>
            )}

            <div className="field-row">
              <label className="field-group">
                <span>Domain</span>
                <select
                  value={domain}
                  onChange={(event) => changeDomain(event.target.value)}
                  aria-label="本体领域"
                >
                  {catalogDomains.length ? (
                    catalogDomains.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))
                  ) : (
                    <option value={domain}>{domain}</option>
                  )}
                </select>
              </label>
              <label className="field-group">
                <span>Module</span>
                <select
                  value={module}
                  onChange={(event) => setModule(event.target.value)}
                  aria-label="本体模块"
                  disabled={viewScope === "domain"}
                >
                  {catalogModules.length ? (
                    catalogModules.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))
                  ) : (
                    <option value={module}>{module}</option>
                  )}
                </select>
              </label>
            </div>
            {viewScope === "domain" && graph?.meta.module_counts && (
              <div className="module-filter-panel">
                <span>显示模块</span>
                <div>
                  {Object.keys(graph.meta.module_counts).map((moduleId) => (
                    <button
                      key={moduleId}
                      className={activeModules.includes(moduleId) ? `active module-${moduleId}` : ""}
                      onClick={() => toggleModule(moduleId)}
                    >
                      <i />{moduleId} <em>{graph.meta.module_counts?.[moduleId]}</em>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {sourceMode === "api" && (
              <div className="catalog-status">
                {catalogLoading
                  ? "正在同步本体目录…"
                  : catalog
                    ? `已发现 ${catalog.domains.length} 个领域`
                    : "目录未连接，可直接重试或使用示例数据"}
              </div>
            )}
            <button
              className="load-button"
              onClick={() => {
                if (sourceMode === "api") refreshCatalog();
                fetchGraph();
              }}
              disabled={loading || catalogLoading}
            >
              <RefreshCw
                size={14}
                className={loading || catalogLoading ? "is-spinning" : ""}
              />
              {loading || catalogLoading ? "加载中" : "加载本体"}
            </button>
          </section>

          <div className="sidebar-tabs" role="tablist">
            <button
              className={leftTab === "hierarchy" ? "active" : ""}
              onClick={() => setLeftTab("hierarchy")}
              role="tab"
            >
              层次 <span>{graph?.nodes.filter((node) => !node.sub_class_of.length).length || 0}</span>
            </button>
            <button
              className={leftTab === "classes" ? "active" : ""}
              onClick={() => setLeftTab("classes")}
              role="tab"
            >
              实体类型 <span>{graph?.nodes.length || 0}</span>
            </button>
            <button
              className={leftTab === "warnings" ? "active" : ""}
              onClick={() => setLeftTab("warnings")}
              role="tab"
            >
              警告 <span>{graph?.warnings.length || 0}</span>
            </button>
          </div>

          <div className="sidebar-content">
            {leftTab === "hierarchy" ? (
              <SidebarHierarchy graph={graph} aliases={nodeAliases} selectedId={selectedNodeId} onSelect={selectNode} />
            ) : leftTab === "classes" ? (
              <div className="class-list">
                {graph?.nodes.map((node) => (
                  <button
                    key={node.id}
                    className={selectedNodeId === node.id ? "active" : ""}
                    onClick={() => selectNode(node.id)}
                  >
                    <span className="class-icon">
                      <CircleDot size={13} />
                    </span>
                    <span className="class-copy">
                      <strong>{nodePresentationName(node, nodeAliases)}</strong>
                      <small>{node.qname}</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            ) : graph?.warnings.length ? (
              <div className="warning-list">
                {graph.warnings.map((warning, index) => (
                  <article key={`${warning.code}-${index}`}>
                    <AlertTriangle size={15} />
                    <div>
                      <strong>{warning.code}</strong>
                      <p>{warning.message}</p>
                      <code>{compactUri(warning.subject)}</code>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="zero-state compact">
                <Check size={22} />
                <strong>没有解析警告</strong>
                <span>当前本体结构通过基础校验</span>
              </div>
            )}
          </div>

          <div className="source-file">
            <span>源文件</span>
            <code title={graph?.meta.source_file}>{graph?.meta.source_file || "—"}</code>
          </div>
        </aside>

        <section className="graph-stage">
          <div className="graph-toolbar">
            <div className="search-box">
              <Search size={16} />
              <input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchQuery("");
                    setSearchOpen(false);
                  }
                  if (event.key === "Enter" && searchResults[0]) {
                    selectNode(searchResults[0].id);
                  }
                }}
                placeholder="搜索实体、QName 或描述…"
                aria-label="搜索本体实体"
              />
              {searchQuery && (
                <span className="result-count">{searchResults.length} 个结果</span>
              )}
              {searchOpen && searchQuery && searchResults.length > 0 && (
                <div className="search-popover">
                  {searchResults.slice(0, 7).map((node) => (
                    <button key={node.id} onClick={() => selectNode(node.id)}>
                      <span>{nodePresentationName(node, nodeAliases)}</span>
                      <small>{node.qname}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="toolbar-divider" />
            <Toggle
              checked={showSubclass}
              onChange={setShowSubclass}
              label="继承"
              tone="purple"
            />
            <Toggle
              checked={showObjectRelationships}
              onChange={setShowObjectRelationships}
              label="对象关系"
              tone="blue"
            />
            <Toggle
              checked={showInferred}
              onChange={setShowInferred}
              label="推断"
              tone="orange"
            />

            <label className="collapse-toggle">
              <input
                type="checkbox"
                checked={collapseInverse}
                onChange={(event) => setCollapseInverse(event.target.checked)}
              />
              合并反向关系
            </label>

            <label className="neighborhood-picker">
              <Focus size={14} />
              <select
                value={neighborhoodDepth}
                disabled={!selectedNodeId}
                onChange={(event) => setNeighborhoodDepth(Number(event.target.value) as 0 | 1 | 2)}
                aria-label="邻域浏览深度"
              >
                <option value={0}>选择聚焦</option>
                <option value={1}>一跳上下文</option>
                <option value={2}>两跳上下文</option>
              </select>
            </label>

            {graphDimension === "2d" && (
              <label className="neighborhood-picker label-density-picker">
                <Link2 size={14} />
                <select
                  value={labelDensity}
                  onChange={(event) => setLabelDensity(event.target.value as LabelDensity)}
                  aria-label="关系标签密度"
                >
                  <option value="focus">按需标签</option>
                  <option value="all">全部标签</option>
                  <option value="none">隐藏标签</option>
                </select>
              </label>
            )}

            <div className="toolbar-spacer" />
            <div className="dimension-switch" role="group" aria-label="图谱维度">
              <button className={graphDimension === "2d" ? "active" : ""} onClick={() => setGraphDimension("2d")}>
                <PanelTop size={14} />二维
              </button>
              <button className={graphDimension === "3d" ? "active" : ""} onClick={() => setGraphDimension("3d")}>
                <Box size={14} />立体
              </button>
            </div>
            {graphDimension === "2d" && (
              <div className="layout-picker">
                <Layers3 size={15} />
                <select
                  value={layout}
                  onChange={(event) => applyLayout(event.target.value as LayoutName)}
                  aria-label="图布局"
                >
                  {Object.entries(LAYOUT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}布局
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="canvas-wrap">
            <div
              ref={canvasRef}
              className={`cy-canvas ${graphDimension === "3d" ? "is-hidden" : ""}`}
              role="application"
              aria-label="本体关系交互图"
            />

            {graphDimension === "3d" && !loading && !error && visibleGraph.nodes.length > 0 && (
              <Suspense fallback={<div className="graph-3d-loading"><RefreshCw size={20} className="is-spinning" />正在加载立体视图</div>}>
                <OntologyGraph3D
                  nodes={visibleGraph.nodes}
                  edges={visibleGraph.edges}
                  aliases={nodeAliases}
                  theme={theme}
                  defaultModule={viewScope === "module" ? module : undefined}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  neighborhoodDepth={neighborhoodDepth}
                  pathNodeIds={pathNodeIds}
                  pathEdgeIds={pathEdgeIds}
                  canGoBack={Boolean(viewHistory.length)}
                  onSelectNode={selectNode}
                  onSelectEdge={(id) => {
                    setSelectedEdgeId(id);
                    setSelectedNodeId(null);
                  }}
                  onClearSelection={() => {
                    setSelectedNodeId(null);
                    setSelectedEdgeId(null);
                    setNeighborhoodDepth(0);
                  }}
                  onGoBack={restorePreviousView}
                />
              </Suspense>
            )}

            {graphDimension === "2d" && (
              <div className="playground-controls" aria-label="画布控制">
                <button onClick={restorePreviousView} disabled={!viewHistory.length} title="返回上一步视图" aria-label="返回上一步视图"><ArrowLeft size={17} /></button>
                <button onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 1.22)} title="放大" aria-label="放大"><ZoomIn size={17} /></button>
                <button onClick={() => cyRef.current?.zoom(cyRef.current.zoom() / 1.22)} title="缩小" aria-label="缩小"><ZoomOut size={17} /></button>
                <button onClick={() => cyRef.current?.fit(undefined, 68)} title="适应画布" aria-label="适应画布"><Maximize size={17} /></button>
                <button onClick={resetView} title="重新排布" aria-label="重新排布"><RotateCcw size={17} /></button>
              </div>
            )}

            {graphDimension === "2d" && selectedEdgeId && edgeHandlePosition && (
              <button
                className="edge-drag-handle"
                style={{ left: edgeHandlePosition.x, top: edgeHandlePosition.y }}
                onPointerDown={beginEdgeHandleDrag}
                title="拖动调整关系线弧度"
                aria-label="拖动调整关系线弧度"
              />
            )}

            {neighborhoodDepth > 0 && selectedNode && (
              <div className="playground-focus-badge">
                <Focus size={14} />
                聚焦 · {nodePresentationName(selectedNode, nodeAliases)} · {neighborhoodDepth} 跳上下文
                <button onClick={() => { setNeighborhoodDepth(0); setSelectedNodeId(null); }}>退出聚焦</button>
              </div>
            )}

            {graphDimension === "2d" && !loading && !error && !selectedNodeId && !selectedEdgeId && (
              <div className="playground-hint">
                <Focus size={13} />
                拖动节点调整位置 · 拖动关系线调整弧度 · 双击节点进入聚焦
              </div>
            )}

            {graphDimension === "2d" && !loading && !error && selectedEdgeId && (
              <div className="playground-hint edge-drag-hint">
                <Link2 size={13} />
                按住关系线拖动，或拖动蓝色控制点调整走向
              </div>
            )}

            {loading && (
              <div className="canvas-state">
                <RefreshCw size={24} className="is-spinning" />
                <strong>正在加载本体图</strong>
                <span>解析实体类型、属性与语义关系</span>
              </div>
            )}

            {!loading && error && (
              <div className="canvas-state error-state">
                <Unplug size={28} />
                <strong>本体服务连接失败</strong>
                <span>{error}</span>
                <div>
                  <button onClick={() => fetchGraph()}>重新连接</button>
                  {sourceMode === "api" && (
                    <button className="secondary" onClick={switchToMock}>
                      使用示例数据
                    </button>
                  )}
                </div>
              </div>
            )}

            {!loading && !error && graph?.nodes.length === 0 && (
              <div className="canvas-state">
                <Network size={28} />
                <strong>本体图为空</strong>
                <span>接口已连接，但没有返回实体类型</span>
              </div>
            )}

            {!loading && !error && (
              <>
                <div className={`graph-legend ${graphDimension === "3d" ? "is-spatial" : ""}`}>
                  <span><i className="class-node" />实体类型</span>
                  <span><i className="inherit-edge" />继承关系</span>
                  <span><i className="object-edge" />对象关系</span>
                  <span><i className="inferred-edge" />推断关系</span>
                  {viewScope === "domain" && <span><i className="cross-edge" />跨模块关系</span>}
                </div>
                <div className={`canvas-summary ${graphDimension === "3d" ? "is-spatial" : ""}`}>
                  显示 {visibleGraph.nodes.length} 个节点 · {visibleGraph.edges.length} 条关系
                  <strong>{graphDimension === "3d" ? "立体视图" : "二维视图"}</strong>
                  {selectedNodeId && <strong>上下文高亮</strong>}
                  {pathNodeIds.length > 0 && <strong>路径高亮</strong>}
                </div>
              </>
            )}
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector-header">
            <div>
              <span>INSPECTOR</span>
              <strong>语义详情</strong>
            </div>
            <PanelRight size={18} />
          </div>

          {selectedNode ? (
            <>
              <div className="entity-heading">
                <div className="entity-glyph">C</div>
                <div>
                  <span>owl:Class</span>
                  <h2>{nodePresentationName(selectedNode, nodeAliases)}</h2>
                  {nodeAliases[selectedNode.id] && (
                    <small className="entity-technical-name">本体名称 · {nodeDisplayName(selectedNode)}</small>
                  )}
                  <code>{selectedNode.qname}</code>
                </div>
              </div>

              <div className="focus-row">
                <button className={neighborhoodDepth === 1 ? "active" : ""} onClick={() => setNeighborhoodDepth(neighborhoodDepth === 1 ? 0 : 1)}><Focus size={14} />一跳</button>
                <button className={neighborhoodDepth === 2 ? "active" : ""} onClick={() => setNeighborhoodDepth(neighborhoodDepth === 2 ? 0 : 2)}><GitBranch size={14} />两跳</button>
                <button onClick={() => setAnalysisOpen(true)}><ScanSearch size={14} />影响分析</button>
              </div>

              <div className="inspector-tabs" role="tablist">
                {(
                  [
                    ["overview", "概览"],
                    ["properties", "属性"],
                    ["relations", "关系"],
                  ] as [InspectorTab, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={inspectorTab === value ? "active" : ""}
                    onClick={() => setInspectorTab(value)}
                    role="tab"
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="inspector-scroll">
                {inspectorTab === "overview" && (
                  <>
                    <Accordion title="展示别名（仅界面）">
                      <form
                        className="alias-editor"
                        onSubmit={(event) => {
                          event.preventDefault();
                          saveSelectedAlias();
                        }}
                      >
                        <div className="alias-explainer">
                          <Tag size={15} />
                          <p>
                            <strong>给业务人员设置易懂名称</strong>
                            <span>只保存在当前浏览器，不写入或修改本体 TTL。</span>
                          </p>
                        </div>
                        <label>
                          <span>节点展示名称</span>
                          <input
                            value={aliasDraft}
                            onChange={(event) => {
                              setAliasDraft(event.target.value);
                              setAliasSaved(false);
                            }}
                            maxLength={60}
                            placeholder={`例如：${nodeDisplayName(selectedNode)} 的业务名称`}
                            aria-label="节点展示别名"
                          />
                        </label>
                        <small>原始名称 · {nodeDisplayName(selectedNode)}</small>
                        <div className="alias-actions">
                          <button type="submit" className="primary" disabled={!aliasDraft.trim()}>
                            {aliasSaved ? <Check size={13} /> : <Save size={13} />}
                            {aliasSaved ? "已保存" : "保存别名"}
                          </button>
                          {nodeAliases[selectedNode.id] && (
                            <button type="button" onClick={clearSelectedAlias}>
                              <Trash2 size={13} />恢复本体名称
                            </button>
                          )}
                        </div>
                      </form>
                    </Accordion>
                    <Accordion title="业务定义">
                      <p className="definition-copy">
                        {selectedNode.comment || selectedNode.class_description || "暂无描述"}
                      </p>
                      {selectedNode.class_description &&
                        selectedNode.class_description !== selectedNode.comment && (
                          <p className="secondary-copy">{selectedNode.class_description}</p>
                        )}
                    </Accordion>
                    <Accordion title="标识信息">
                      <dl className="detail-grid">
                        <div><dt>Label</dt><dd>{selectedNode.label || "—"}</dd></div>
                        <div><dt>Local name</dt><dd>{selectedNode.local_name}</dd></div>
                        <div><dt>QName</dt><dd><code>{selectedNode.qname}</code></dd></div>
                      </dl>
                      <div className="uri-block">
                        <span>URI</span>
                        <code>{selectedNode.id}</code>
                        <button onClick={() => copyText(selectedNode.id)}>
                          {copied ? <Check size={14} /> : <Copy size={14} />}
                          {copied ? "已复制" : "复制"}
                        </button>
                      </div>
                    </Accordion>
                    <Accordion title="父类" count={selectedNode.sub_class_of.length}>
                      {selectedNode.sub_class_of.length ? (
                        <div className="reference-list">
                          {selectedNode.sub_class_of.map((parent) => (
                            <button key={parent} onClick={() => selectNode(parent)}>
                              <Layers3 size={14} />
                              <span>{nodeNameById(graph, nodeAliases, parent)}</span>
                              <code>{compactUri(parent)}</code>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="empty-line">根类，无显式父类</span>
                      )}
                    </Accordion>
                    <Accordion title="唯一键约束" count={selectedNode.has_key.length}>
                      {selectedNode.has_key.length ? (
                        <div className="key-list">
                          {selectedNode.has_key.map((key) => (
                            <span key={key}><KeyRound size={13} />{compactUri(key)}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="empty-line">未声明 owl:hasKey</span>
                      )}
                    </Accordion>
                  </>
                )}

                {inspectorTab === "properties" && (
                  <Accordion
                    title="DatatypeProperty"
                    count={selectedNode.datatype_properties.length}
                  >
                    {selectedNode.datatype_properties.length ? (
                      <div className="property-list">
                        {selectedNode.datatype_properties.map((property) => (
                          <article key={property.uri}>
                            <div>
                              <strong>{property.label || property.local_name}</strong>
                              {property.is_functional && <span>functional</span>}
                            </div>
                            <code>{property.qname}</code>
                            <p>{property.comment || "暂无说明"}</p>
                            <small>Range · {property.range.map(compactUri).join(", ")}</small>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <span className="empty-line">没有数据属性</span>
                    )}
                  </Accordion>
                )}

                {inspectorTab === "relations" && (
                  <>
                    <Accordion
                      title="Outgoing ObjectProperty"
                      count={selectedNode.object_properties.length}
                    >
                      {selectedNode.object_properties.length ? (
                        <div className="relation-list">
                          {selectedNode.object_properties.map((property) => (
                            <article key={property.uri}>
                              <Link2 size={14} />
                              <div>
                                <strong>{property.label || property.local_name}</strong>
                                <code>{property.qname}</code>
                                <p>→ {property.range.map((id) => nodeNameById(graph, nodeAliases, id)).join(", ")}</p>
                                {property.inverse_of && (
                                  <small>inverseOf · {compactUri(property.inverse_of)}</small>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <span className="empty-line">没有出向对象关系</span>
                      )}
                    </Accordion>
                    <Accordion title="Incoming ObjectProperty" count={incomingEdges.length}>
                      {incomingEdges.length ? (
                        <div className="relation-list">
                          {incomingEdges.map((edge) => (
                            <article key={edge.id}>
                              <ArrowLeftRight size={14} />
                              <div>
                                <strong>{edge.label}</strong>
                                <p>← {nodeNameById(graph, nodeAliases, edge.source)}</p>
                                {edge.predicate && <code>{compactUri(edge.predicate)}</code>}
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <span className="empty-line">没有入向对象关系</span>
                      )}
                    </Accordion>
                  </>
                )}
              </div>
            </>
          ) : selectedEdge ? (
            <EdgeInspector edge={selectedEdge} graph={graph} aliases={nodeAliases} copied={copied} copyText={copyText} />
          ) : (
            <div className="inspector-empty">
              <div className="empty-graphic">
                <Network size={28} />
              </div>
              <strong>选择图中的实体或关系</strong>
              <p>查看语义定义、属性约束、父类与双向关系。</p>
              <div className="empty-tips">
                <span><i>1</i> 点击节点查看实体详情</span>
                <span><i>2</i> 搜索并定位目标概念</span>
                <span><i>3</i> 聚焦节点的一跳关系</span>
              </div>
            </div>
          )}
        </aside>
      </div>
      <MaintenanceDrawer
        open={maintenanceOpen}
        onClose={() => setMaintenanceOpen(false)}
        baseUrl={apiBaseUrl}
        domain={domain}
        module={module}
        graph={graph}
        selectedNode={selectedNode}
        onSaved={handleMaintenanceSaved}
        onExportView={exportCurrentView}
      />
      <Suspense fallback={null}>
        <R2RMLExplorer
          open={mappingOpen}
          onClose={() => setMappingOpen(false)}
          baseUrl={apiBaseUrl}
          initialDomain={domain}
          onOpenOntologyEntity={(uri) => {
            setMappingOpen(false);
            if (graph?.nodes.some((node) => node.id === uri)) {
              selectNode(uri);
            } else {
              setSearchQuery(compactUri(uri));
              setSearchOpen(true);
            }
          }}
        />
        <SemanticAnalysisDrawer
          open={analysisOpen}
          onClose={() => setAnalysisOpen(false)}
          baseUrl={apiBaseUrl}
          domain={domain}
          graph={graph}
          selectedNode={selectedNode}
          onSelectEntity={selectNode}
          onHighlightPath={(nodeIds, edgeIds) => {
            setPathNodeIds(nodeIds);
            setPathEdgeIds(edgeIds);
            setNeighborhoodDepth(0);
          }}
          offline={sourceMode === "mock"}
        />
      </Suspense>
    </main>
  );
}

function EdgeInspector({
  edge,
  graph,
  aliases,
  copied,
  copyText,
}: {
  edge: DisplayEdge;
  graph: OntologyGraph | null;
  aliases: NodeAliasMap;
  copied: boolean;
  copyText: (value: string) => void;
}) {
  return (
    <div className="edge-inspector">
      <div className="entity-heading edge-heading">
        <div className="entity-glyph relation">R</div>
        <div>
          <span>{edge.edge_type}</span>
          <h2>{edge.label}</h2>
          <code>{edge.predicate ? compactUri(edge.predicate) : "subClassOf"}</code>
        </div>
      </div>
      <div className="inspector-scroll">
        <Accordion title="关系端点">
          <div className="edge-path">
            <span>{nodeNameById(graph, aliases, edge.source)}</span>
            <ArrowLeftRight size={16} />
            <span>{nodeNameById(graph, aliases, edge.target)}</span>
          </div>
        </Accordion>
        <Accordion title="关系定义">
          <dl className="detail-grid">
            <div><dt>类型</dt><dd>{edge.edge_type}</dd></div>
            <div><dt>声明方式</dt><dd>{edge.declared ? "Declared" : "Generated"}</dd></div>
            <div><dt>推断关系</dt><dd>{edge.inferred ? "是" : "否"}</dd></div>
            <div><dt>双向合并</dt><dd>{edge.bidirectional ? "是" : "否"}</dd></div>
          </dl>
          {edge.inverse_of && (
            <div className="info-row"><span>inverseOf</span><code>{compactUri(edge.inverse_of)}</code></div>
          )}
          {edge.reverse_label && (
            <div className="info-row"><span>反向标签</span><strong>{edge.reverse_label}</strong></div>
          )}
          {edge.inference_reason && (
            <p className="definition-copy">{edge.inference_reason}</p>
          )}
        </Accordion>
        {edge.predicate && (
          <Accordion title="Predicate URI">
            <div className="uri-block standalone">
              <code>{edge.predicate}</code>
              <button onClick={() => copyText(edge.predicate || "")}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "已复制" : "复制"}
              </button>
            </div>
          </Accordion>
        )}
      </div>
    </div>
  );
}
