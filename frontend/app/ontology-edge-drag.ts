export interface GraphPoint {
  x: number;
  y: number;
}

export interface EdgeBend {
  distance: number;
  weight: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Converts a dragged point into Cytoscape's relative unbundled-bezier values.
 * Keeping the bend relative to the two endpoint nodes means it remains useful
 * after nodes are moved or the graph is laid out again.
 */
export function edgeBendFromPoint(
  source: GraphPoint,
  target: GraphPoint,
  point: GraphPoint,
): EdgeBend {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 0.0001) return { distance: 0, weight: 0.5 };

  const weight = clamp(
    ((point.x - source.x) * dx + (point.y - source.y) * dy) / lengthSquared,
    0.08,
    0.92,
  );
  const base = {
    x: source.x + dx * weight,
    y: source.y + dy * weight,
  };
  const length = Math.sqrt(lengthSquared);
  const normal = { x: -dy / length, y: dx / length };
  const distance =
    (point.x - base.x) * normal.x + (point.y - base.y) * normal.y;

  return { distance, weight };
}

export function edgeControlPoint(
  source: GraphPoint,
  target: GraphPoint,
  bend: EdgeBend,
): GraphPoint {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return { ...source };
  const base = {
    x: source.x + dx * bend.weight,
    y: source.y + dy * bend.weight,
  };
  return {
    x: base.x + (-dy / length) * bend.distance,
    y: base.y + (dx / length) * bend.distance,
  };
}
