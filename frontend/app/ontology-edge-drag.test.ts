import { describe, expect, it } from "vitest";
import { edgeBendFromPoint, edgeControlPoint } from "./ontology-edge-drag";

describe("ontology edge dragging", () => {
  it("converts a dragged point into a reusable bezier bend", () => {
    const source = { x: 0, y: 0 };
    const target = { x: 100, y: 0 };
    const bend = edgeBendFromPoint(source, target, { x: 35, y: 28 });

    expect(bend.weight).toBeCloseTo(0.35);
    expect(bend.distance).toBeCloseTo(28);
    expect(edgeControlPoint(source, target, bend)).toEqual({ x: 35, y: 28 });
  });

  it("clamps control points away from unstable endpoints", () => {
    const bend = edgeBendFromPoint(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 150, y: -20 },
    );

    expect(bend.weight).toBe(0.92);
    expect(bend.distance).toBe(-20);
  });

  it("handles coincident endpoints safely", () => {
    expect(edgeBendFromPoint({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 8, y: 9 }))
      .toEqual({ distance: 0, weight: 0.5 });
  });
});
