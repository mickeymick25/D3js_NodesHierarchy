// ─────────────────────────────────────────────────────────────────────────────
// SelectionService — Node selection + electric current animation
// P4: ElementRefs maps for O(1) lookups
// P5: CSS transitions for opacity (class toggles), D3 transitions for colors
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable } from "@angular/core";
import { type Selection } from "d3-selection";
import { timer, type Timer } from "d3-timer";
import { hierarchy, type HierarchyNode } from "d3-hierarchy";
import { interpolateRgb } from "d3-interpolate";

import {
  type GraphData,
  type LayoutMode,
  type HierarchyDatum,
} from "../models/graph.model";
import { type ElementRefs } from "../models/element-refs";
import {
  COLOR_PRIMARY,
  COLOR_TERTIARY,
  COLOR_ELECTRIC,
  COLOR_ELECTRIC_CONTAINER,
  NODE_COLORS,
  NODE_STROKE_COLORS,
} from "../models/colors";

type CollapsibleNode = HierarchyNode<HierarchyDatum> & {
  _children?: HierarchyNode<HierarchyDatum>[] | null;
};

export interface SelectionContext {
  g: Selection<SVGGElement, unknown, null, undefined>;
  graphData: GraphData;
  layoutMode: LayoutMode;
  selectedNodeId: string | null;
  collapsedBranches: Set<string>;
  buildHierarchy: () => HierarchyDatum;
  elementRefs: ElementRefs;
}

@Injectable({ providedIn: "root" })
export class SelectionService {
  private selectionAnimTimer: Timer | null = null;

  // Transition duration for color animations (ms)
  // Opacity transitions are handled by CSS (250ms ease on .g-node, .g-edge, .g-badge)
  private readonly COLOR_TRANSITION_MS = 250;

  // Electric animation constants
  private readonly ELECTRIC_DASH = "10 4 4 4"; // dasharray pattern
  private readonly ELECTRIC_DASH_PERIOD = 22; // total period of dasharray
  private readonly ELECTRIC_FLOW_DURATION = 800; // ms for one full cycle
  private readonly ELECTRIC_COLOR_WAVE_DURATION = 2000; // ms for color oscillation

  // P8: Pre-computed electric color interpolation (30 steps)
  private readonly ELECTRIC_COLORS: string[] = Array.from(
    { length: 30 },
    (_, i) => {
      const colorT = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 30);
      return interpolateRgb(COLOR_ELECTRIC, COLOR_TERTIARY)(colorT);
    },
  );
  private readonly ELECTRIC_COLOR_COUNT = this.ELECTRIC_COLORS.length;
  private readonly ANIM_FRAME_MS = 1000 / 30; // ~30 fps for electric animation

  applyNodeSelection(ctx: SelectionContext): void {
    const {
      graphData,
      layoutMode,
      selectedNodeId,
      collapsedBranches,
      buildHierarchy,
      elementRefs,
    } = ctx;
    const t = this.COLOR_TRANSITION_MS;

    if (!selectedNodeId) {
      // Stop electric current animation and clean up attributes
      this.stopElectricAnimation(ctx.g, elementRefs);

      // P5: Opacity reset via CSS class — remove "dimmed" from all elements
      for (const [, nodeGroup] of elementRefs.nodeGroupMap) {
        nodeGroup.classed("dimmed", false);
      }
      for (const [, pathEl] of elementRefs.edgePathMap) {
        pathEl.classed("dimmed", false);
      }
      for (const [, badgeEl] of elementRefs.badgeGroupMap) {
        badgeEl.classed("dimmed", false);
      }

      // Reset node colors with D3 transition
      for (const [nodeId, nodeGroup] of elementRefs.nodeGroupMap) {
        const isCenter = nodeId === graphData.center.id;
        if (isCenter) continue;

        const realId = elementRefs.nodeRealIdMap.get(nodeId) || nodeId;
        const nodeType = graphData.nodes.find((n) => n.id === realId)?.type;

        if (nodeType) {
          nodeGroup
            .select("circle.inner-circle")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", NODE_COLORS[nodeType])
            .attr("stroke", NODE_STROKE_COLORS[nodeType]);
          nodeGroup
            .select("circle.halo-circle")
            .interrupt()
            .transition()
            .duration(t)
            .attr("stroke", NODE_STROKE_COLORS[nodeType])
            .attr("stroke-opacity", 0.4);
        }

        // Reset branch grouping nodes' rect styling
        const isBranch =
          nodeId === "__animation__" ||
          nodeId === "__logistics__" ||
          nodeId === "__logistics_r1__" ||
          nodeId === "__logistics_r2__";
        if (isBranch) {
          const color =
            nodeId === "__animation__" ? COLOR_TERTIARY : COLOR_PRIMARY;
          nodeGroup
            .select("rect:first-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", "white");
          nodeGroup
            .select("rect:last-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", color)
            .attr("fill-opacity", 0.15)
            .attr("stroke", color)
            .attr("stroke-width", 1.5);
          nodeGroup
            .select("text")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", color);
        }
      }

      // Reset edge stroke colors with D3 transition
      for (const [key, pathEl] of elementRefs.edgePathMap) {
        const edgeType = key.split("|")[2] || "LOGISTICS";
        pathEl
          .classed("electric-current", false)
          .interrupt()
          .transition()
          .duration(t)
          .attr(
            "stroke",
            edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY,
          );
      }

      // Reset badge colors with D3 transition
      if (layoutMode === "force") {
        for (const [key, badgeEl] of elementRefs.badgeGroupMap) {
          const edgeType = key.split("|")[2] || "LOGISTICS";
          const color =
            edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY;
          badgeEl
            .select("rect:first-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", "white");
          badgeEl
            .select(".label-bg")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", color)
            .attr("fill-opacity", "0.15")
            .attr("stroke", color);
          badgeEl
            .selectAll("text")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", color);
        }
      } else {
        // Tree / Dendrogram: badges keyed by targetId
        for (const [targetId, badgeG] of elementRefs.badgeGroupMap) {
          const edgeType =
            elementRefs.badgeEdgeTypeMap.get(targetId) || "LOGISTICS";
          const color =
            edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY;
          badgeG
            .select("rect:first-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", "white");
          badgeG
            .select("rect:last-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", color)
            .attr("fill-opacity", "0.15")
            .attr("stroke", color);
          badgeG
            .select("text")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", color);
        }
      }

      return;
    }

    const selectedId = selectedNodeId;
    const centerId = graphData.center.id;

    let highlighted = new Set<string>();

    const isConnected = (
      sourceId: string | null,
      targetId: string | null,
    ): boolean =>
      !!sourceId &&
      !!targetId &&
      (sourceId === selectedId || targetId === selectedId);

    if (layoutMode === "tree" || layoutMode === "dendrogram") {
      // Hierarchy modes: highlight ancestors + descendants
      const hierarchyData = buildHierarchy();
      const root = hierarchy(hierarchyData);

      // Apply collapsed state
      root.each((node: HierarchyNode<HierarchyDatum>) => {
        if (collapsedBranches.has(node.data.id) && node.children) {
          (node as CollapsibleNode)._children = node.children;
          node.children = undefined;
        }
      });

      // Build ancestor and descendant maps
      const ancestorMap = new Map<string, Set<string>>();
      const descendantMap = new Map<string, Set<string>>();
      root.descendants().forEach((d: HierarchyNode<HierarchyDatum>) => {
        const id = d.data.id;

        const ancestorIds = new Set<string>();
        d.ancestors().forEach((a: HierarchyNode<HierarchyDatum>) =>
          ancestorIds.add(a.data.id),
        );
        const existingAncestors = ancestorMap.get(id);
        if (existingAncestors) {
          ancestorIds.forEach((a) => existingAncestors.add(a));
        } else {
          ancestorMap.set(id, ancestorIds);
        }

        const descendantIds = new Set<string>();
        d.descendants().forEach((a: HierarchyNode<HierarchyDatum>) =>
          descendantIds.add(a.data.id),
        );
        const existingDescendants = descendantMap.get(id);
        if (existingDescendants) {
          descendantIds.forEach((a) => existingDescendants.add(a));
        } else {
          descendantMap.set(id, descendantIds);
        }
      });

      // Build merged ancestors set by looking up ALL composite IDs matching selectedId
      let ancestors = new Set<string>();
      let descendants = new Set<string>();
      root.descendants().forEach((d: HierarchyNode<HierarchyDatum>) => {
        const data = d.data as HierarchyDatum;
        if ((data.realId || data.id) === selectedId) {
          const a = ancestorMap.get(d.data.id);
          const desc = descendantMap.get(d.data.id);
          if (a) a.forEach((x) => ancestors.add(x));
          if (desc) desc.forEach((x) => descendants.add(x));
        }
      });
      let highlightedTree = new Set([...ancestors, ...descendants]);

      // With composite IDs, the selectedId won't match directly.
      // Find all nodes whose realId or id matches and merge their paths.
      root.descendants().forEach((d: HierarchyNode<HierarchyDatum>) => {
        const data = d.data as HierarchyDatum;
        if ((data.realId || data.id) === selectedId) {
          const a = ancestorMap.get(d.data.id);
          const desc = descendantMap.get(d.data.id);
          if (a) a.forEach((x) => highlightedTree.add(x));
          if (desc) desc.forEach((x) => highlightedTree.add(x));
        }
      });
      highlighted = highlightedTree;

      // P5: Nodes — opacity via CSS class
      for (const [nodeId, nodeGroup] of elementRefs.nodeGroupMap) {
        nodeGroup.classed("dimmed", !highlighted.has(nodeId));
      }

      // Edges: opacity via CSS class, stroke color via D3
      for (const [key, pathEl] of elementRefs.edgePathMap) {
        const parts = key.split("|");
        const sourceId = parts[0];
        const targetId = parts[1];
        const edgeType = parts[2] || "LOGISTICS";
        const connected =
          sourceId &&
          targetId &&
          highlighted.has(sourceId) &&
          highlighted.has(targetId);

        if (connected) {
          pathEl.classed("dimmed", false).classed("electric-current", true);
        } else {
          pathEl
            .classed("dimmed", true)
            .classed("electric-current", false)
            .interrupt()
            .transition()
            .duration(t)
            .attr(
              "stroke",
              edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY,
            );
        }
      }

      // Badges: opacity via CSS class
      for (const [targetId, badgeG] of elementRefs.badgeGroupMap) {
        const connected = targetId && highlighted.has(targetId);
        const isOnSelectedPath =
          connected && (ancestors.has(targetId) || descendants.has(targetId));
        badgeG.classed("dimmed", !connected);

        if (isOnSelectedPath) {
          badgeG
            .select("rect:first-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", "white");
          badgeG
            .select("rect:last-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", COLOR_ELECTRIC)
            .attr("fill-opacity", "0.15")
            .attr("stroke", COLOR_ELECTRIC);
          badgeG
            .select("text")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", COLOR_ELECTRIC);
        } else {
          const edgeType =
            elementRefs.badgeEdgeTypeMap.get(targetId) || "LOGISTICS";
          const color =
            edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY;
          badgeG
            .select("rect:first-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", "white");
          badgeG
            .select("rect:last-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", color)
            .attr("fill-opacity", "0.15")
            .attr("stroke", color);
          badgeG
            .select("text")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", color);
        }
      }
    } else {
      // Force mode: highlight connected edges
      const connectedNodeIds = new Set<string>([selectedId, centerId]);
      graphData.edges.forEach((edge) => {
        if (edge.source === selectedId || edge.target === selectedId) {
          connectedNodeIds.add(edge.source);
          connectedNodeIds.add(edge.target);
        }
      });

      // P5: Nodes — opacity via CSS class
      for (const [nodeId, nodeGroup] of elementRefs.nodeGroupMap) {
        nodeGroup.classed("dimmed", !connectedNodeIds.has(nodeId));
      }

      // Edges: opacity via CSS class, stroke color via D3
      for (const [key, pathEl] of elementRefs.edgePathMap) {
        const parts = key.split("|");
        const sourceId = parts[0];
        const targetId = parts[1];
        const edgeType = parts[2] || "LOGISTICS";
        const connected = isConnected(sourceId, targetId);

        if (connected) {
          pathEl.classed("dimmed", false).classed("electric-current", true);
        } else {
          pathEl
            .classed("dimmed", true)
            .classed("electric-current", false)
            .interrupt()
            .transition()
            .duration(t)
            .attr(
              "stroke",
              edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY,
            );
        }
      }

      // Badges (edge-labels): opacity via CSS class
      for (const [key, badgeEl] of elementRefs.badgeGroupMap) {
        const parts = key.split("|");
        const sourceId = parts[0];
        const targetId = parts[1];
        const edgeType = parts[2] || "LOGISTICS";
        const connected = isConnected(sourceId, targetId);
        const color = edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY;

        badgeEl.classed("dimmed", !connected);

        if (connected) {
          badgeEl
            .select("rect:first-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", "white");
          badgeEl
            .select(".label-bg")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", COLOR_ELECTRIC)
            .attr("fill-opacity", "0.15")
            .attr("stroke", COLOR_ELECTRIC);
          badgeEl
            .selectAll("text")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", COLOR_ELECTRIC);
        } else {
          badgeEl
            .select("rect:first-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", "white");
          badgeEl
            .select(".label-bg")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", color)
            .attr("fill-opacity", "0.15")
            .attr("stroke", color);
          badgeEl
            .selectAll("text")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", color);
        }
      }
    }

    // Change colors of selected node to Electric colors with transition
    for (const [nodeId, nodeGroup] of elementRefs.nodeGroupMap) {
      const realId = elementRefs.nodeRealIdMap.get(nodeId) || nodeId;
      const isSelected = realId === selectedId;
      const isCenter = nodeId === centerId;

      // Branch grouping nodes
      const isBranch =
        nodeId === "__animation__" ||
        nodeId === "__logistics__" ||
        nodeId === "__logistics_r1__" ||
        nodeId === "__logistics_r2__";

      if (isBranch) {
        const onPath = highlighted.has(nodeId);
        const branchColor =
          nodeId === "__animation__" ? COLOR_TERTIARY : COLOR_PRIMARY;
        if (onPath) {
          nodeGroup
            .select("rect:first-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", "transparent");
          nodeGroup
            .select("rect:last-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", COLOR_ELECTRIC)
            .attr("fill-opacity", 0.15)
            .attr("stroke", COLOR_ELECTRIC)
            .attr("stroke-width", 1.5);
          nodeGroup
            .select("text")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", COLOR_ELECTRIC);
        } else {
          nodeGroup
            .select("rect:first-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", "white");
          nodeGroup
            .select("rect:last-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", branchColor)
            .attr("fill-opacity", 0.15)
            .attr("stroke", branchColor)
            .attr("stroke-width", 1.5);
          nodeGroup
            .select("text")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", branchColor);
        }
        continue; // branch nodes don't have circles
      }

      if (isCenter) continue;

      // Leaf nodes: inner-circle and halo-circle
      if (isSelected) {
        nodeGroup
          .select("circle.inner-circle")
          .interrupt()
          .transition()
          .duration(t)
          .attr("fill", COLOR_ELECTRIC_CONTAINER)
          .attr("stroke", COLOR_ELECTRIC);
        nodeGroup
          .select("circle.halo-circle")
          .interrupt()
          .transition()
          .duration(t)
          .attr("stroke", COLOR_ELECTRIC)
          .attr("stroke-opacity", 0.4);
      } else {
        const nodeType = graphData.nodes.find((n) => n.id === realId)?.type;
        if (nodeType) {
          nodeGroup
            .select("circle.inner-circle")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", NODE_COLORS[nodeType])
            .attr("stroke", NODE_STROKE_COLORS[nodeType]);
          nodeGroup
            .select("circle.halo-circle")
            .interrupt()
            .transition()
            .duration(t)
            .attr("stroke", NODE_STROKE_COLORS[nodeType])
            .attr("stroke-opacity", 0.4);
        }
      }
    }

    // Start electric current animation on selected link paths
    this.startElectricAnimation(ctx.g, elementRefs);
  }

  startElectricAnimation(
    g: Selection<SVGGElement, unknown, null, undefined>,
    elementRefs: ElementRefs,
  ): void {
    this.stopElectricAnimation(g, elementRefs);

    // Collect electric-current paths from the edgePathMap
    const electricPaths: Selection<SVGPathElement, unknown, null, undefined>[] =
      [];
    for (const [, pathEl] of elementRefs.edgePathMap) {
      if (pathEl.classed("electric-current")) {
        electricPaths.push(pathEl);
      }
    }

    if (electricPaths.length === 0) return;

    // Store references for the animation timer
    elementRefs.electricPaths.push(...electricPaths);

    for (const pathEl of electricPaths) {
      pathEl
        .attr("stroke-dasharray", this.ELECTRIC_DASH)
        .attr("stroke-linecap", "round")
        .attr("filter", "url(#electric-glow)");
    }

    const period = this.ELECTRIC_DASH_PERIOD;
    const flowMs = this.ELECTRIC_FLOW_DURATION;
    const colorMs = this.ELECTRIC_COLOR_WAVE_DURATION;

    // P8: Throttle to ~30 fps and use pre-computed color array
    let lastTick = 0;
    const frameMs = this.ANIM_FRAME_MS;
    const colors = this.ELECTRIC_COLORS;
    const colorCount = this.ELECTRIC_COLOR_COUNT;

    this.selectionAnimTimer = timer((elapsed) => {
      if (elapsed - lastTick < frameMs) return;
      lastTick = elapsed;

      const dashOffset = ((elapsed / flowMs) * period) % period;
      const colorPhase = (elapsed % colorMs) / colorMs;
      const colorT = 0.5 - 0.5 * Math.cos(2 * Math.PI * colorPhase);
      const colorIndex = Math.round(colorT * (colorCount - 1));
      const color = colors[colorIndex];
      const strokeOpacity = 1 - 0.3 * colorT;

      for (const pathEl of electricPaths) {
        pathEl
          .attr("stroke-dashoffset", dashOffset)
          .attr("stroke", color)
          .attr("stroke-opacity", strokeOpacity);
      }
    });
  }

  stopElectricAnimation(
    g: Selection<SVGGElement, unknown, null, undefined> | null,
    elementRefs: ElementRefs,
  ): void {
    if (this.selectionAnimTimer) {
      this.selectionAnimTimer.stop();
      this.selectionAnimTimer = null;
    }

    // Clean up electric-current attributes using stored references
    for (const pathEl of elementRefs.electricPaths) {
      pathEl
        .attr("stroke-dasharray", null)
        .attr("stroke-dashoffset", null)
        .attr("stroke-linecap", null)
        .attr("filter", null)
        .attr("stroke-opacity", null);
    }
    elementRefs.electricPaths.length = 0;
  }

  /** Stop timer without touching SVG (for ngOnDestroy) */
  destroy(): void {
    if (this.selectionAnimTimer) {
      this.selectionAnimTimer.stop();
      this.selectionAnimTimer = null;
    }
  }
}
