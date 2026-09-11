import { ArrowLeft, Maximize, Orbit, Pause, RotateCcw } from "lucide-react";
import ForceGraph3D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-3d";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import SpriteText from "three-spritetext";
import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  FogExp2,
  GridHelper,
  Group,
  HemisphereLight,
  LinearFilter,
  LineBasicMaterial,
  NormalBlending,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  type Scene,
} from "three";
import type { DisplayEdge } from "./ontology-data";
import {
  buildOntology3DData,
  threeEndpointId,
  type Ontology3DLink,
  type Ontology3DNode,
} from "./ontology-3d";
import type { GraphNode } from "./ontology-types";
import { collectNeighborhood } from "./ontology-visual";
import type { NodeAliasMap } from "./ontology-aliases";

type ThemeName = "light" | "dark";

interface OntologyGraph3DProps {
  nodes: GraphNode[];
  edges: DisplayEdge[];
  aliases: NodeAliasMap;
  theme: ThemeName;
  defaultModule?: string;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  neighborhoodDepth: 0 | 1 | 2;
  pathNodeIds: string[];
  pathEdgeIds: string[];
  canGoBack: boolean;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onClearSelection: () => void;
  onGoBack: () => void;
}

interface SpatialControls {
  autoRotate: boolean;
  autoRotateSpeed: number;
  enableDamping: boolean;
  dampingFactor: number;
  minDistance?: number;
  maxDistance?: number;
  rotateSpeed?: number;
  zoomSpeed?: number;
  update: () => void;
}

const MODULE_LABELS: Record<string, string> = {
  dimension: "维度",
  metric: "指标",
  capability: "能力",
  scenario: "场景",
  external: "外部",
};

const cardTextureCache = new Map<string, CanvasTexture>();
let haloTextureCache: CanvasTexture | null = null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] || character);
}

function visualTextLength(label: string): number {
  return [...label].reduce(
    (length, character) => length + (/[^\u0000-\u00ff]/.test(character) ? 2 : 1),
    0,
  );
}

function cardWidth(label: string): number {
  return Math.max(52, Math.min(104, 25 + visualTextLength(label) * 2.2));
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function cardTexture(
  color: string,
  selected: boolean,
  root: boolean,
  theme: ThemeName,
): CanvasTexture {
  const key = `${theme}:${color}:${selected ? "selected" : "normal"}:${root ? "root" : "node"}`;
  const cached = cardTextureCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");

  const x = 34;
  const y = 39;
  const width = 316;
  const height = 114;
  const radius = 24;
  context.shadowColor = color;
  context.shadowBlur = selected ? 46 : 30;
  roundedRect(context, x, y, width, height, radius);
  const fill = context.createLinearGradient(x, y, x + width, y + height);
  if (theme === "light") {
    fill.addColorStop(0, selected ? "rgba(255, 255, 255, 1)" : "rgba(255, 255, 255, .99)");
    fill.addColorStop(1, selected ? "rgba(222, 239, 252, 1)" : "rgba(237, 246, 253, .99)");
  } else {
    fill.addColorStop(0, selected ? "rgba(38, 72, 108, .99)" : "rgba(25, 48, 75, .99)");
    fill.addColorStop(1, selected ? "rgba(21, 48, 78, .99)" : "rgba(16, 35, 58, .98)");
  }
  context.fillStyle = fill;
  context.fill();

  context.shadowBlur = 0;
  context.strokeStyle = color;
  context.lineWidth = selected ? 6 : root ? 4.5 : 3.2;
  roundedRect(context, x, y, width, height, radius);
  context.stroke();

  context.fillStyle = color;
  roundedRect(context, x + 12, y + 21, selected ? 8 : 6, height - 42, 4);
  context.fill();

  if (root) {
    context.globalAlpha = 0.44;
    context.lineWidth = 1.4;
    roundedRect(context, x + 8, y + 8, width - 16, height - 16, radius - 7);
    context.stroke();
    context.globalAlpha = 1;
  }

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  cardTextureCache.set(key, texture);
  return texture;
}

function haloTexture(): CanvasTexture {
  if (haloTextureCache) return haloTextureCache;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  const glow = context.createRadialGradient(128, 64, 4, 128, 64, 112);
  glow.addColorStop(0, "rgba(255, 255, 255, .95)");
  glow.addColorStop(0.24, "rgba(255, 255, 255, .46)");
  glow.addColorStop(0.58, "rgba(255, 255, 255, .12)");
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);
  haloTextureCache = new CanvasTexture(canvas);
  haloTextureCache.minFilter = LinearFilter;
  haloTextureCache.magFilter = LinearFilter;
  haloTextureCache.needsUpdate = true;
  return haloTextureCache;
}

function createSpatialBackdrop(theme: ThemeName): Group {
  const group = new Group();
  group.name = "ontology-spatial-backdrop";
  const light = theme === "light";

  const grid = new GridHelper(960, 32, light ? "#79a9ca" : "#62c7ea", light ? "#c3d6e5" : "#28536f");
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -250;
  const gridMaterial = grid.material as LineBasicMaterial;
  gridMaterial.transparent = true;
  gridMaterial.opacity = light ? 0.22 : 0.16;
  gridMaterial.depthWrite = false;
  group.add(grid);

  const ground = new GridHelper(960, 32, light ? "#59a9a0" : "#36dec2", light ? "#c8dfe3" : "#214e62");
  ground.position.y = -180;
  const groundMaterial = ground.material as LineBasicMaterial;
  groundMaterial.transparent = true;
  groundMaterial.opacity = light ? 0.2 : 0.22;
  groundMaterial.depthWrite = false;
  group.add(ground);

  const count = 420;
  const positions = new Float32Array(count * 3);
  let seed = 1949;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (next() - 0.5) * 920;
    positions[index * 3 + 1] = (next() - 0.5) * 660;
    positions[index * 3 + 2] = (next() - 0.5) * 360;
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  const stars = new Points(
    starGeometry,
    new PointsMaterial({
      color: light ? "#6f9bb9" : "#b4e9ff",
      size: light ? 0.72 : 0.9,
      transparent: true,
      opacity: light ? 0.34 : 0.56,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  const keyLight = new DirectionalLight(light ? "#ffffff" : "#d8efff", 1.5);
  keyLight.position.set(180, 260, 240);
  group.add(
    stars,
    new AmbientLight(light ? "#ffffff" : "#9fcfff", 1.25),
    new HemisphereLight(light ? "#ffffff" : "#b9e8ff", light ? "#a9c4d8" : "#15344c", 1.1),
    keyLight,
  );
  return group;
}

export default function OntologyGraph3D({
  nodes,
  edges,
  aliases,
  theme,
  defaultModule,
  selectedNodeId,
  selectedEdgeId,
  neighborhoodDepth,
  pathNodeIds,
  pathEdgeIds,
  canGoBack,
  onSelectNode,
  onSelectEdge,
  onClearSelection,
  onGoBack,
}: OntologyGraph3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphMethods<Ontology3DNode, Ontology3DLink> | undefined>(undefined);
  const fittedRef = useRef(false);
  const [size, setSize] = useState({ width: 900, height: 620 });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);
  const [autoOrbit, setAutoOrbit] = useState(false);

  const graphData = useMemo(
    () => buildOntology3DData(nodes, edges, aliases, defaultModule),
    [aliases, defaultModule, edges, nodes],
  );

  const moduleLegend = useMemo(() => {
    const modules = new Map<string, string>();
    graphData.nodes.forEach((node) => {
      if (!modules.has(node.module)) modules.set(node.module, node.color);
    });
    return [...modules.entries()];
  }, [graphData.nodes]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const bounds = host.getBoundingClientRect();
      setSize({
        width: Math.max(320, Math.round(bounds.width)),
        height: Math.max(260, Math.round(bounds.height)),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fittedRef.current = false;
  }, [graphData]);

  useEffect(() => {
    const graph = graphRef.current;
    const charge = graph?.d3Force("charge");
    const link = graph?.d3Force("link");
    charge?.strength?.(-540);
    link?.distance?.(148);
    graph?.d3ReheatSimulation();
  }, [graphData]);

  useEffect(() => {
    const scene = graphRef.current?.scene() as Scene | undefined;
    if (!scene) return;
    const backdrop = createSpatialBackdrop(theme);
    const previousFog = scene.fog;
    const fog = new FogExp2(theme === "light" ? "#edf4fb" : "#132337", theme === "light" ? 0.00012 : 0.00026);
    scene.fog = fog;
    scene.add(backdrop);
    return () => {
      scene.remove(backdrop);
      if (scene.fog === fog) scene.fog = previousFog;
    };
  }, [theme]);

  useEffect(() => {
    const controls = graphRef.current?.controls() as SpatialControls | undefined;
    if (!controls) return;
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.minDistance = 90;
    controls.maxDistance = 1_800;
    controls.rotateSpeed = 0.54;
    controls.zoomSpeed = 0.82;
    controls.autoRotate = autoOrbit;
    controls.autoRotateSpeed = 0.42;
    controls.update();
  }, [autoOrbit]);

  const context = useMemo(() => {
    const centerId = selectedNodeId || (!selectedEdgeId ? hoveredNodeId : null);
    if (centerId) {
      return collectNeighborhood(centerId, edges, selectedNodeId ? neighborhoodDepth || 1 : 1);
    }
    const relationId = selectedEdgeId || hoveredLinkId;
    if (relationId) {
      const link = graphData.links.find((item) => item.id === relationId);
      if (link) {
        return {
          nodeIds: new Set([threeEndpointId(link.source), threeEndpointId(link.target)]),
          edgeIds: new Set([link.id]),
        };
      }
    }
    return null;
  }, [edges, graphData.links, hoveredLinkId, hoveredNodeId, neighborhoodDepth, selectedEdgeId, selectedNodeId]);

  const pathNodes = useMemo(() => new Set(pathNodeIds), [pathNodeIds]);
  const pathEdges = useMemo(() => new Set(pathEdgeIds), [pathEdgeIds]);

  const nodeIsActive = useCallback(
    (nodeId: string) => !context || context.nodeIds.has(nodeId) || pathNodes.has(nodeId),
    [context, pathNodes],
  );

  const linkIsActive = useCallback(
    (link: Ontology3DLink) =>
      !context ||
      context.edgeIds.has(link.id) ||
      link.originalEdgeIds.some((id) => context.edgeIds.has(id)) ||
      pathEdges.has(link.id) ||
      link.originalEdgeIds.some((id) => pathEdges.has(id)),
    [context, pathEdges],
  );

  const buildNodeObject = useCallback(
    (rawNode: NodeObject<Ontology3DNode>) => {
      const node = rawNode as Ontology3DNode;
      const selected = node.id === selectedNodeId;
      const hovered = node.id === hoveredNodeId;
      const active = nodeIsActive(node.id);
      const width = cardWidth(node.label) * (selected ? 1.08 : 1);
      const height = selected ? 22 : 19;

      const haloMaterial = new SpriteMaterial({
        map: haloTexture(),
        color: node.color,
        blending: theme === "light" ? NormalBlending : AdditiveBlending,
        transparent: true,
        opacity: active
          ? selected || hovered
            ? theme === "light" ? 0.28 : 0.58
            : theme === "light" ? 0.12 : 0.3
          : theme === "light" ? 0.035 : 0.09,
        depthWrite: false,
      });
      const halo = new Sprite(haloMaterial);
      halo.scale.set(width * 1.48, height * 2.25, 1);
      halo.position.z = -0.35;
      halo.renderOrder = 2;

      const material = new SpriteMaterial({
        map: cardTexture(node.color, selected || hovered, node.root, theme),
        transparent: true,
        opacity: active ? 1 : theme === "light" ? 0.42 : 0.3,
        depthWrite: false,
      });
      const card = new Sprite(material);
      card.scale.set(width, height, 1);
      card.renderOrder = 3;

      const label = new SpriteText(
        node.label,
        selected ? 6.2 : 5.65,
        theme === "light" ? "#10243a" : "#f7fbff",
      );
      label.fontFace = "Segoe UI, Inter, Arial, sans-serif";
      label.fontWeight = selected ? "700" : "600";
      label.strokeWidth = theme === "light" ? 0.12 : 0.24;
      label.strokeColor = theme === "light" ? "#ffffff" : "#050b15";
      label.position.set(1.6, 0.2, 0.7);
      label.renderOrder = 4;
      const labelMaterial = label.material as SpriteMaterial;
      labelMaterial.transparent = true;
      labelMaterial.opacity = active ? 1 : theme === "light" ? 0.52 : 0.38;
      labelMaterial.depthWrite = false;

      const group = new Group();
      group.add(halo, card, label);

      if (selected || hovered) {
        const technical = new SpriteText(node.qname, 2.7, theme === "light" ? "#314c67" : "#c8dcf1");
        technical.fontFace = "Consolas, ui-monospace, monospace";
        technical.backgroundColor = theme === "light" ? "rgba(255, 255, 255, .96)" : "rgba(9, 21, 36, .94)";
        technical.padding = [1.5, 0.9];
        technical.borderRadius = 2;
        technical.position.set(0, -(height / 2 + 4.6), 0.65);
        technical.renderOrder = 5;
        (technical.material as SpriteMaterial).depthWrite = false;
        group.add(technical);
      }

      return group;
    },
    [hoveredNodeId, nodeIsActive, selectedNodeId, theme],
  );

  const focusCamera = useCallback((node: Ontology3DNode) => {
    const { x = 0, y = 0, z = 0 } = node;
    graphRef.current?.cameraPosition(
      { x: x + 92, y: y + 44, z: z + 148 },
      { x, y, z },
      760,
    );
  }, []);

  const fitReadableView = useCallback((transitionMs = 760) => {
    const graph = graphRef.current;
    if (!graph || !graphData.nodes.length) return;
    graph.zoomToFit(0, 46);
    window.requestAnimationFrame(() => {
      const bounds = graph.getGraphBbox();
      if (!bounds) return;
      const center = {
        x: (bounds.x[0] + bounds.x[1]) / 2,
        y: (bounds.y[0] + bounds.y[1]) / 2,
        z: (bounds.z[0] + bounds.z[1]) / 2,
      };
      const camera = graph.camera();
      const readabilityScale = graphData.nodes.length <= 24 ? 0.68 : 0.78;
      graph.cameraPosition(
        {
          x: center.x + (camera.position.x - center.x) * readabilityScale,
          y: center.y + (camera.position.y - center.y) * readabilityScale,
          z: center.z + (camera.position.z - center.z) * readabilityScale,
        },
        center,
        transitionMs,
      );
    });
  }, [graphData.nodes.length]);

  useEffect(() => {
    if (!selectedNodeId) return;
    const node = graphData.nodes.find((item) => item.id === selectedNodeId);
    if (node && [node.x, node.y, node.z].every((value) => typeof value === "number")) {
      focusCamera(node);
    }
  }, [focusCamera, graphData.nodes, selectedNodeId]);

  const resetSpatialView = () => {
    graphRef.current?.d3ReheatSimulation();
    window.setTimeout(() => fitReadableView(760), 460);
  };

  const linkColor = useCallback((rawLink: LinkObject<Ontology3DNode, Ontology3DLink>) => {
    const link = rawLink as Ontology3DLink;
    if (!linkIsActive(link)) return theme === "light" ? "#c2d1df" : "#2f4661";
    if (selectedEdgeId === link.id || hoveredLinkId === link.id) return theme === "light" ? "#006fbd" : "#8fe7ff";
    if (pathEdges.has(link.id) || link.originalEdgeIds.some((id) => pathEdges.has(id))) return theme === "light" ? "#bd7600" : "#f2d288";
    if (link.inferred) return theme === "light" ? "#c95738" : "#ff8f70";
    if (link.edgeType === "subClassOf") return theme === "light" ? "#7653b8" : "#c995ff";
    if (link.crossModule) return theme === "light" ? "#008b80" : "#43e0c1";
    return theme === "light" ? "#547693" : "#79abd3";
  }, [hoveredLinkId, linkIsActive, pathEdges, selectedEdgeId, theme]);

  return (
    <div ref={hostRef} className={`graph-3d-surface is-${theme}`} role="application" aria-label="本体关系立体交互图">
      <ForceGraph3D<Ontology3DNode, Ontology3DLink>
        ref={graphRef}
        width={size.width}
        height={size.height}
        graphData={graphData}
        nodeId="id"
        linkSource="source"
        linkTarget="target"
        backgroundColor={theme === "light" ? "#edf4fb" : "#132337"}
        showNavInfo={false}
        controlType="orbit"
        enableNavigationControls
        enableNodeDrag
        nodeVal={(rawNode) => (rawNode as Ontology3DNode).root ? 9 : 7}
        nodeRelSize={3.6}
        nodeThreeObject={buildNodeObject}
        nodeLabel={(rawNode) => {
          const node = rawNode as Ontology3DNode;
          const technical = node.label === node.technicalName ? node.qname : `${node.technicalName} · ${node.qname}`;
          return `<strong>${escapeHtml(node.label)}</strong><br/><span>${escapeHtml(technical)}</span>`;
        }}
        linkLabel={(rawLink) => {
          const link = rawLink as Ontology3DLink;
          return `<strong>${escapeHtml(link.label)}</strong><br/><span>${escapeHtml(link.edgeType)}</span>`;
        }}
        linkColor={linkColor}
        linkOpacity={0.82}
        linkWidth={(rawLink) => {
          const link = rawLink as Ontology3DLink;
          if (!linkIsActive(link)) return 0.32;
          if (selectedEdgeId === link.id || hoveredLinkId === link.id) return 3.1;
          return pathEdges.has(link.id) ? 2.45 : 1.12;
        }}
        linkCurvature={(rawLink) => (rawLink as Ontology3DLink).curvature * 0.72}
        linkDirectionalArrowLength={(rawLink) => {
          const link = rawLink as Ontology3DLink;
          return selectedEdgeId === link.id || hoveredLinkId === link.id ? 4.2 : linkIsActive(link) ? 2.1 : 0;
        }}
        linkDirectionalArrowColor={linkColor}
        linkDirectionalArrowRelPos={0.86}
        linkDirectionalParticles={(rawLink) => {
          const link = rawLink as Ontology3DLink;
          if (selectedEdgeId === link.id || hoveredLinkId === link.id) return 4;
          if (pathEdges.has(link.id)) return 3;
          if (link.crossModule || link.edgeType === "objectProperty") return 1;
          return 0;
        }}
        linkDirectionalParticleWidth={2.05}
        linkDirectionalParticleSpeed={0.0038}
        linkDirectionalParticleColor={() => theme === "light" ? "#006fbd" : "#b8ecff"}
        linkHoverPrecision={5}
        warmupTicks={150}
        cooldownTicks={260}
        d3AlphaDecay={0.025}
        d3VelocityDecay={0.34}
        onEngineStop={() => {
          if (fittedRef.current) return;
          fittedRef.current = true;
          fitReadableView(760);
        }}
        onNodeClick={(rawNode) => {
          const node = rawNode as Ontology3DNode;
          onSelectNode(node.id);
          focusCamera(node);
        }}
        onNodeHover={(rawNode) => {
          setHoveredNodeId(rawNode ? (rawNode as Ontology3DNode).id : null);
          if (rawNode) setHoveredLinkId(null);
        }}
        onLinkClick={(rawLink) => onSelectEdge((rawLink as Ontology3DLink).id)}
        onLinkHover={(rawLink) => {
          setHoveredLinkId(rawLink ? (rawLink as Ontology3DLink).id : null);
          if (rawLink) setHoveredNodeId(null);
        }}
        onBackgroundClick={onClearSelection}
      />

      <div className="graph-3d-mode">
        <div>
          <strong>明亮语义空间</strong>
          <span>v1.5.3 · 模块分层 · 关系聚焦 · 立体导航</span>
        </div>
        <div className="graph-3d-module-legend">
          {moduleLegend.map(([module, color]) => (
            <span key={module}><i style={{ background: color, color }} />{MODULE_LABELS[module] || module}</span>
          ))}
        </div>
      </div>

      <div className="graph-3d-controls" aria-label="立体画布控制">
        <button onClick={onGoBack} disabled={!canGoBack} title="返回上一步视图" aria-label="返回上一步视图"><ArrowLeft size={16} /></button>
        <button onClick={() => fitReadableView(760)} title="适应立体画布" aria-label="适应立体画布"><Maximize size={16} /></button>
        <button onClick={resetSpatialView} title="重新计算空间布局" aria-label="重新计算空间布局"><RotateCcw size={16} /></button>
        <button className={autoOrbit ? "active" : ""} onClick={() => setAutoOrbit((value) => !value)} title={autoOrbit ? "暂停自动巡航" : "自动巡航"} aria-label={autoOrbit ? "暂停自动巡航" : "自动巡航"}>
          {autoOrbit ? <Pause size={15} /> : <Orbit size={16} />}
        </button>
      </div>
      <div className="graph-3d-hint">拖动卡片调整位置 · 拖动画布旋转 · 滚轮缩放 · 单击聚焦</div>
    </div>
  );
}
