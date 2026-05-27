// ─────────────────────────────────────────────────────────────────────────────
// TreeLayoutService — Provides HierarchyConfig for horizontal tree layout
// P2 — Étapes 5+6
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable } from "@angular/core";
import {
  tree,
  type HierarchyNode,
  type HierarchyPointNode,
} from "d3-hierarchy";
import { type HierarchyDatum } from "../../models/graph.model";
import { type HierarchyConfig } from "../../models/hierarchy-config";

@Injectable({ providedIn: "root" })
export class TreeLayoutService {
  getConfig(width: number, height: number): HierarchyConfig {
    return {
      layout: "tree",

      // Tree layout: horizontal, left to right
      // D3 tree gives x = vertical position, y = horizontal depth
      xMapping: (d: HierarchyPointNode<HierarchyDatum>) => d.y + 150,
      yMapping: (d: HierarchyPointNode<HierarchyDatum>) => d.x + 40,

      // Horizontal Bézier curves (control points at midX)
      linkCurve: (sx: number, sy: number, tx: number, ty: number) => {
        const midX = (sx + tx) / 2;
        return `M${sx},${sy}C${midX},${sy} ${midX},${ty} ${tx},${ty}`;
      },

      labelPosition: "right",
      indicatorPosition: "right",

      // Collapse indicator: positioned to the right of the branch rectangle
      collapseIndicatorOffset: (rectWidth: number, _rectHeight: number) => ({
        x: rectWidth / 2 + 10,
        y: 0,
      }),

      // Apply d3.tree() layout
      applyLayout: (
        root: HierarchyNode<HierarchyDatum>,
        _width: number,
        height: number,
      ): HierarchyPointNode<HierarchyDatum> => {
        const treeLayout = tree<HierarchyDatum>()
          .size([height - 80, width - 300])
          .separation((a, b) => (a.parent === b.parent ? 1 : 1.5));
        return treeLayout(root);
      },
    };
  }
}
