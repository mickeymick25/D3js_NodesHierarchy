// ─────────────────────────────────────────────────────────────────────────────
// SelectionService — Node selection + electric current animation
// Extracted from graph.component.ts (P2 — Étape 3)
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable } from "@angular/core";
import { select, type Selection } from "d3-selection";
import { timer, type Timer } from "d3-timer";
import { hierarchy, type HierarchyNode } from "d3-hierarchy";
import { interpolateRgb } from "d3-interpolate";

import {
  type GraphData,
  type LayoutMode,
  type HierarchyDatum,
} from "../models/graph.model";
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
}

@Injectable({ providedIn: "root" })
export class SelectionService {
  private selectionAnimTimer: Timer | null = null;

  // Transition duration for selection animations (ms)
  private readonly SELECTION_TRANSITION_MS = 250;

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
      g,
      graphData,
      layoutMode,
      selectedNodeId,
      collapsedBranches,
      buildHierarchy,
    } = ctx;
    const allNodes = g.selectAll("[data-node-id]");
    const t = this.SELECTION_TRANSITION_MS;

    if (!selectedNodeId) {
      // Stop electric current animation and clean up attributes
      this.stopElectricAnimation(g);

      // Reset all opacity to 1 with transition
      allNodes.interrupt().transition().duration(t).attr("opacity", 1);
      g.selectAll(".link-badges g, .edge-labels g")
        .interrupt()
        .transition()
        .duration(t)
        .attr("opacity", 1);

      // Reset link opacity AND stroke colors in a single transition per element
      g.selectAll(".edges path, .tree-links path").each(function () {
        const el = select(this);
        el.classed("electric-current", false);
        const edgeType = el.attr("data-edge-type");
        el.interrupt()
          .transition()
          .duration(t)
          .attr("opacity", 1)
          .attr(
            "stroke",
            edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY,
          );
      });

      // Reset node colors to default with transition
      allNodes.each(function () {
        const nodeGroup = select(this);
        const nodeId = nodeGroup.attr("data-node-id");
        if (!nodeId) return;
        const isCenter = nodeId === graphData.center.id;
        if (isCenter) return;

        const realId = nodeGroup.attr("data-real-id") || nodeId;
        const nodeType = graphData.nodes.find((n) => n.id === realId)?.type;

        if (nodeType) {
          const circles = nodeGroup.selectAll("circle");
          const innerCircle = circles.filter(function () {
            const r = select(this).attr("r");
            return r === "30" || r === "22";
          });

          innerCircle
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", NODE_COLORS[nodeType])
            .attr("stroke", NODE_STROKE_COLORS[nodeType]);
          circles
            .filter(function () {
              const r = select(this).attr("r");
              return r === "34" || r === "26";
            })
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
      });

      // Reset edge labels to default colors with transition
      g.selectAll(".edge-labels g").each(function () {
        const el = select(this);
        const edgeType = el.attr("data-edge-type");
        const color = edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY;
        el.select("rect:first-of-type")
          .interrupt()
          .transition()
          .duration(t)
          .attr("fill", "white");
        el.select(".label-bg")
          .interrupt()
          .transition()
          .duration(t)
          .attr("fill", color)
          .attr("fill-opacity", "0.15")
          .attr("stroke", color);
        el.selectAll("text")
          .interrupt()
          .transition()
          .duration(t)
          .attr("fill", color);
      });

      // Reset tree link badges to default colors with transition
      g.selectAll(".link-badges g").each(function () {
        const badgeG = select(this);
        const edgeType = badgeG.attr("data-edge-type");
        const color = edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY;
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
      });

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

      allNodes
        .interrupt()
        .transition()
        .duration(t)
        .attr("opacity", function () {
          const nodeId = select(this).attr("data-node-id");
          return nodeId && highlighted.has(nodeId) ? 1 : 0.25;
        });

      g.selectAll(".tree-links path").each(function () {
        const el = select(this);
        const sourceId = el.attr("data-source-id");
        const targetId = el.attr("data-target-id");
        const connected =
          sourceId &&
          targetId &&
          highlighted.has(sourceId) &&
          highlighted.has(targetId);
        const edgeType = el.attr("data-edge-type");

        if (connected) {
          el.classed("electric-current", true);
          el.interrupt().transition().duration(t).attr("opacity", 1);
        } else {
          el.classed("electric-current", false);
          el.interrupt()
            .transition()
            .duration(t)
            .attr("opacity", 0.12)
            .attr(
              "stroke",
              edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY,
            );
        }
      });

      g.selectAll(".link-badges g").each(function () {
        const badgeG = select(this);
        const targetId = badgeG.attr("data-target-id");
        const connected = targetId && highlighted.has(targetId);
        const isOnSelectedPath =
          connected && (ancestors.has(targetId) || descendants.has(targetId));
        badgeG
          .interrupt()
          .transition()
          .duration(t)
          .attr("opacity", connected ? 1 : 0.12);
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
          const edgeType = badgeG.attr("data-edge-type");
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
      });
    } else {
      // Force mode: highlight connected edges
      const connectedNodeIds = new Set<string>([selectedId, centerId]);
      graphData.edges.forEach((edge) => {
        if (edge.source === selectedId || edge.target === selectedId) {
          connectedNodeIds.add(edge.source);
          connectedNodeIds.add(edge.target);
        }
      });

      allNodes
        .interrupt()
        .transition()
        .duration(t)
        .attr("opacity", function () {
          const nodeId = select(this).attr("data-node-id");
          return nodeId && connectedNodeIds.has(nodeId) ? 1 : 0.25;
        });

      g.selectAll(".edges path").each(function () {
        const el = select(this);
        const sourceId = el.attr("data-source-id");
        const targetId = el.attr("data-target-id");
        const connected = isConnected(sourceId, targetId);
        const edgeType = el.attr("data-edge-type");

        if (connected) {
          el.classed("electric-current", true);
          el.interrupt().transition().duration(t).attr("opacity", 1);
        } else {
          el.classed("electric-current", false);
          el.interrupt()
            .transition()
            .duration(t)
            .attr("opacity", 0.12)
            .attr(
              "stroke",
              edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY,
            );
        }
      });

      g.selectAll(".edge-labels g").each(function () {
        const el = select(this);
        const sourceId = el.attr("data-source-id");
        const targetId = el.attr("data-target-id");
        const connected = isConnected(sourceId, targetId);
        el.interrupt()
          .transition()
          .duration(t)
          .attr("opacity", connected ? 1 : 0.12);
        if (connected) {
          el.select("rect:first-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", "white");
          el.select(".label-bg")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", COLOR_ELECTRIC)
            .attr("fill-opacity", "0.15")
            .attr("stroke", COLOR_ELECTRIC);
          el.selectAll("text")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", COLOR_ELECTRIC);
        } else {
          const edgeType = el.attr("data-edge-type");
          const color =
            edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY;
          el.select("rect:first-of-type")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", "white");
          el.select(".label-bg")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", color)
            .attr("fill-opacity", "0.15")
            .attr("stroke", color);
          el.selectAll("text")
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", color);
        }
      });
    }

    // Change colors of selected node to Electric colors with transition
    allNodes.each(function () {
      const nodeGroup = select(this);
      const nodeId = nodeGroup.attr("data-node-id");
      if (!nodeId) return;

      const realId = nodeGroup.attr("data-real-id") || nodeId;
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
        return; // branch nodes don't have circles
      }

      // Find the inner circle (r = NODE_RADIUS)
      const circles = nodeGroup.selectAll("circle");
      const innerCircle = circles.filter(function () {
        const r = select(this).attr("r");
        return r === "30" || r === "22";
      });

      if (isSelected && !isCenter) {
        innerCircle
          .interrupt()
          .transition()
          .duration(t)
          .attr("fill", COLOR_ELECTRIC_CONTAINER)
          .attr("stroke", COLOR_ELECTRIC);
        circles
          .filter(function () {
            const r = select(this).attr("r");
            return r === "34" || r === "26";
          })
          .interrupt()
          .transition()
          .duration(t)
          .attr("stroke", COLOR_ELECTRIC)
          .attr("stroke-opacity", 0.4);
      } else if (!isCenter) {
        const nodeType = graphData.nodes.find((n) => n.id === realId)?.type;
        if (nodeType) {
          innerCircle
            .interrupt()
            .transition()
            .duration(t)
            .attr("fill", NODE_COLORS[nodeType])
            .attr("stroke", NODE_STROKE_COLORS[nodeType]);
          circles
            .filter(function () {
              const r = select(this).attr("r");
              return r === "34" || r === "26";
            })
            .interrupt()
            .transition()
            .duration(t)
            .attr("stroke", NODE_STROKE_COLORS[nodeType])
            .attr("stroke-opacity", 0.4);
        }
      }
    });

    // Start electric current animation on selected link paths
    this.startElectricAnimation(g);
  }

  startElectricAnimation(
    g: Selection<SVGGElement, unknown, null, undefined>,
  ): void {
    this.stopElectricAnimation(g);

    const animatedPaths = g
      .selectAll(".edges path, .tree-links path")
      .filter(function () {
        return select(this).classed("electric-current");
      });

    if (animatedPaths.empty()) return;

    animatedPaths
      .attr("stroke-dasharray", this.ELECTRIC_DASH)
      .attr("stroke-linecap", "round")
      .attr("filter", "url(#electric-glow)");

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

      animatedPaths
        .attr("stroke-dashoffset", dashOffset)
        .attr("stroke", color)
        .attr("stroke-opacity", strokeOpacity);
    });
  }

  stopElectricAnimation(
    g: Selection<SVGGElement, unknown, null, undefined> | null,
  ): void {
    if (this.selectionAnimTimer) {
      this.selectionAnimTimer.stop();
      this.selectionAnimTimer = null;
    }
    if (!g) return;

    g.selectAll(".edges path, .tree-links path")
      .attr("stroke-dasharray", null)
      .attr("stroke-dashoffset", null)
      .attr("stroke-linecap", null)
      .attr("filter", null)
      .attr("stroke-opacity", null);
  }

  /** Stop timer without touching SVG (for ngOnDestroy) */
  destroy(): void {
    if (this.selectionAnimTimer) {
      this.selectionAnimTimer.stop();
      this.selectionAnimTimer = null;
    }
  }
}
