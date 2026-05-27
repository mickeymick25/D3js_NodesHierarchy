// ─────────────────────────────────────────────────────────────────────────────
// DendrogramLayoutService — Provides HierarchyConfig for vertical dendrogram layout
// P2 — Étapes 5+6
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable } from "@angular/core";
import {
  cluster,
  type HierarchyNode,
  type HierarchyPointNode,
} from "d3-hierarchy";
import { type HierarchyDatum } from "../../models/graph.model";
import { type HierarchyConfig } from "../../models/hierarchy-config";

@Injectable({ providedIn: "root" })
export class DendrogramLayoutService {
  getConfig(width: number, height: number): HierarchyConfig {
    return {
      layout: "dendrogram",

      // Dendrogram: vertical, top to bottom
      // D3 cluster gives x = horizontal spread, y = depth (0 = root)
      // We flip vertically: root at bottom, leaves at top
      xMapping: (d: HierarchyPointNode<HierarchyDatum>) => d.x + 150,
      yMapping: (d: HierarchyPointNode<HierarchyDatum>) => height - d.y - 40,

      // Vertical Bézier curves (control points at midY)
      linkCurve: (sx: number, sy: number, tx: number, ty: number) => {
        const midY = (sy + ty) / 2;
        return `M${sx},${sy}C${sx},${midY} ${tx},${midY} ${tx},${ty}`;
      },

      labelPosition: "bottom",
      indicatorPosition: "bottom",

      // Collapse indicator: positioned below the branch rectangle
      collapseIndicatorOffset: (_rectWidth: number, rectHeight: number) => ({
        x: 0,
        y: rectHeight / 2 + 10,
      }),

      // Apply d3.cluster() layout
      applyLayout: (
        root: HierarchyNode<HierarchyDatum>,
        width: number,
        height: number,
      ): HierarchyPointNode<HierarchyDatum> => {
        const clusterLayout = cluster<HierarchyDatum>()
          .size([width - 300, height - 80])
          .separation((a, b) => (a.parent === b.parent ? 1 : 1.5));
        return clusterLayout(root);
      },
    };
  }
}
