// ─────────────────────────────────────────────────────────────────────────────
// HierarchyConfig — Parameterizes differences between Tree and Dendrogram layouts
// P2 — Étapes 5+6
// ─────────────────────────────────────────────────────────────────────────────

import { type HierarchyPointNode, type HierarchyNode } from "d3-hierarchy";
import { type HierarchyDatum } from "./graph.model";

export interface HierarchyConfig {
  layout: "tree" | "dendrogram";

  /** Map D3 hierarchy node to screen x coordinate */
  xMapping: (d: HierarchyPointNode<HierarchyDatum>) => number;

  /** Map D3 hierarchy node to screen y coordinate */
  yMapping: (d: HierarchyPointNode<HierarchyDatum>) => number;

  /** Generate the SVG path string for a link between two points */
  linkCurve: (sx: number, sy: number, tx: number, ty: number) => string;

  /** Where leaf labels are positioned relative to the node circle */
  labelPosition: "right" | "bottom";

  /** Where collapse/expand indicators are positioned relative to the branch rectangle */
  indicatorPosition: "right" | "bottom";

  /** Offset for the collapse indicator circle */
  collapseIndicatorOffset: (
    rectWidth: number,
    rectHeight: number,
  ) => { x: number; y: number };

  /**
   * Apply the D3 layout to the hierarchy root.
   * Takes a HierarchyNode, applies tree/cluster, and returns HierarchyPointNode
   * with positions computed.
   */
  applyLayout: (
    root: HierarchyNode<HierarchyDatum>,
    width: number,
    height: number,
  ) => HierarchyPointNode<HierarchyDatum>;
}
