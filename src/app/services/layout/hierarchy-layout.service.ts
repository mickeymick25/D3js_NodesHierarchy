// ─────────────────────────────────────────────────────────────────────────────
// HierarchyLayoutService — Shared rendering logic for Tree & Dendrogram layouts
// P2 — Étapes 5+6
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable } from "@angular/core";
import "d3-transition";
import {
  hierarchy,
  type HierarchyNode,
  type HierarchyPointNode,
} from "d3-hierarchy";
import {
  forceSimulation,
  forceX,
  forceY,
  forceCollide,
  type Simulation,
} from "d3-force";
import { select, pointer, type Selection } from "d3-selection";
import { type ZoomBehavior } from "d3-zoom";
import { drag, type D3DragEvent } from "d3-drag";

import {
  type GraphData,
  type SimNode,
  type SimLink,
  type HierarchyDatum,
  type NodeType,
} from "../../models/graph.model";
import { type HierarchyConfig } from "../../models/hierarchy-config";
import { SvgBuilderService } from "../svg-builder.service";
import {
  COLOR_TERTIARY,
  COLOR_PRIMARY,
  COLOR_ON_PRIMARY,
  COLOR_ON_PRIMARY_CONTAINER,
  COLOR_ON_SECONDARY_CONTAINER,
  COLOR_ELECTRIC,
  COLOR_ON_ELECTRIC_CONTAINER,
  NODE_COLORS,
  NODE_STROKE_COLORS,
  NODE_TEXT_COLORS,
  NODE_RADIUS,
  NODE_LABELS,
} from "../../models/colors";

// ─────────────────────────────────────────────────────────────────────────────
// Type aliases for D3 hierarchy links
// ─────────────────────────────────────────────────────────────────────────────
type HierarchyLink = {
  source: HierarchyPointNode<HierarchyDatum>;
  target: HierarchyPointNode<HierarchyDatum>;
};

// Collapsible node type for D3 hierarchy collapse/expand
type CollapsibleNode = HierarchyNode<HierarchyDatum> & {
  _children?: HierarchyNode<HierarchyDatum>[] | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Render context
// ─────────────────────────────────────────────────────────────────────────────

export interface HierarchyRenderContext {
  svg: Selection<SVGSVGElement, unknown, null, undefined>;
  g: Selection<SVGGElement, unknown, null, undefined>;
  zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;
  graphData: GraphData;
  containerEl: HTMLDivElement;
  savedPositions: Map<string, { x: number; y: number }>;
  selectedNodeId: string | null;
  collapsedBranches: Set<string>;
  onNodeSelect: (nodeId: string | null) => void;
  onApplyNodeSelection: () => void;
  buildHierarchy: () => HierarchyDatum;
  onStopSimulation: () => void;
  onRenderGraph: () => void;
}

@Injectable({ providedIn: "root" })
export class HierarchyLayoutService {
  constructor(private svgBuilder: SvgBuilderService) {}

  /**
   * Unified render method for Tree & Dendrogram layouts.
   * Returns the simulation so the component can manage its lifecycle.
   */
  render(
    ctx: HierarchyRenderContext,
    config: HierarchyConfig,
  ): Simulation<SimNode, SimLink> {
    const {
      svg,
      g,
      graphData,
      containerEl,
      savedPositions,
      collapsedBranches,
    } = ctx;
    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    // Build hierarchy
    const hierarchyData = ctx.buildHierarchy();
    const rootNode = hierarchy(hierarchyData);

    // Apply collapsed state
    rootNode.each((node: HierarchyNode<HierarchyDatum>) => {
      if (collapsedBranches.has(node.data.id) && node.children) {
        (node as CollapsibleNode)._children = node.children;
        node.children = undefined;
      }
    });

    // Apply D3 layout (tree or cluster) — transforms HierarchyNode to HierarchyPointNode
    const root = config.applyLayout(rootNode, width, height);

    const allNodes = root.descendants();

    // Compute target positions
    const targetPositions = new Map<string, { x: number; y: number }>();
    allNodes.forEach((d: HierarchyPointNode<HierarchyDatum>) => {
      targetPositions.set(d.data.id, {
        x: config.xMapping(d),
        y: config.yMapping(d),
      });
    });

    // Build parent position map
    const parentPositions = new Map<string, { x: number; y: number }>();
    allNodes.forEach((d: HierarchyPointNode<HierarchyDatum>) => {
      if (d.parent) {
        const parentPos = targetPositions.get(d.parent.data.id);
        if (parentPos) {
          parentPositions.set(d.data.id, parentPos);
        }
      }
    });

    // Center position for default transitions
    const centerTarget = targetPositions.get(graphData.center.id);
    const defaultX = centerTarget ? centerTarget.x : width / 2;
    const defaultY = centerTarget ? centerTarget.y : height / 2;

    // ── Draw links ──
    const treeLinks = g.append("g").attr("class", "tree-links");
    treeLinks
      .selectAll("path")
      .data(root.links())
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", (d: HierarchyLink) => {
        const childData = d.target.data as HierarchyDatum;
        if (childData.edgeType === "ANIMATION") return COLOR_TERTIARY;
        return COLOR_PRIMARY;
      })
      .attr("stroke-width", 1.5)
      .attr("opacity", 1)
      .attr("d", (d: HierarchyLink) => {
        const sourcePos = targetPositions.get(d.source.data.id);
        const targetPos = targetPositions.get(d.target.data.id);
        const sx = sourcePos!.x;
        const sy = sourcePos!.y;
        const tx = targetPos!.x;
        const ty = targetPos!.y;
        return config.linkCurve(sx, sy, tx, ty);
      })
      .attr("data-source-id", (d: HierarchyLink) => d.source.data.id)
      .attr("data-target-id", (d: HierarchyLink) => d.target.data.id)
      .attr("data-edge-type", (d: HierarchyLink) => {
        const childData = d.target.data as HierarchyDatum;
        return childData.edgeType || "LOGISTICS";
      });

    // ── Draw link badges ──
    const linkBadges = g.append("g").attr("class", "link-badges");
    this.drawLinkBadges(linkBadges, root, targetPositions, config);

    // ── Draw nodes ──
    const nodeGroups = g
      .append("g")
      .attr("class", "tree-nodes")
      .selectAll("g")
      .data(allNodes)
      .enter()
      .append("g")
      .attr(
        "data-node-id",
        (d: HierarchyPointNode<HierarchyDatum>) => d.data.id,
      )
      .attr(
        "data-real-id",
        (d: HierarchyPointNode<HierarchyDatum>) => d.data.realId || null,
      )
      .attr("transform", (d: HierarchyPointNode<HierarchyDatum>) => {
        const saved =
          savedPositions.get(d.data.id) ||
          (d.data.realId ? savedPositions.get(d.data.realId) : null);
        if (saved) return `translate(${saved.x},${saved.y})`;
        const target = targetPositions.get(d.data.id);
        return target
          ? `translate(${target.x},${target.y})`
          : `translate(${defaultX},${defaultY})`;
      })
      .attr("cursor", "pointer");

    this.drawNodes(nodeGroups, collapsedBranches, config);

    // ── Hover interactions ──
    const tooltipGroup = g.append("g").attr("class", "link-labels");
    this.addHoverInteractions(
      nodeGroups,
      treeLinks.selectAll("path"),
      linkBadges,
      graphData.center.id,
      root,
      tooltipGroup,
      targetPositions,
      ctx,
    );

    // ── Click handlers ──
    nodeGroups.on(
      "click",
      (_event: MouseEvent, d: HierarchyPointNode<HierarchyDatum>) => {
        const data = d.data as HierarchyDatum;
        if (
          data.id === "__animation__" ||
          data.id === "__logistics__" ||
          data.id === "__logistics_r1__" ||
          data.id === "__logistics_r2__"
        ) {
          if (collapsedBranches.has(data.id)) {
            collapsedBranches.delete(data.id);
          } else {
            collapsedBranches.add(data.id);
          }
          ctx.onStopSimulation();
          ctx.onRenderGraph();
        } else if (data.type === "R1" || data.type === "R2") {
          const selectId = data.realId || data.id;
          ctx.onNodeSelect(selectId);
        }
      },
    );

    // ── Simulation ──
    const { simNodes, simNodeMap, centerSimNode, parentMap } =
      this.buildSimNodes(
        root,
        allNodes,
        targetPositions,
        savedPositions,
        graphData,
        width,
        height,
      );

    // Position lookup
    const getPosition = (id: string): { x: number; y: number } => {
      const sn = simNodeMap.get(id);
      if (sn && sn.x !== undefined && sn.y !== undefined) {
        return { x: sn.x, y: sn.y };
      }
      const t = targetPositions.get(id);
      if (t) return t;
      return { x: width / 2, y: height / 2 };
    };

    // Drag behavior on leaf nodes
    const leafNodeIds = new Set<string>();
    const compositeToRealId = new Map<string, string>();
    allNodes.forEach((d: HierarchyPointNode<HierarchyDatum>) => {
      const data = d.data as HierarchyDatum;
      if (
        (data.type === "R1" || data.type === "R2") &&
        data.id !== graphData.center.id &&
        data.realId
      ) {
        leafNodeIds.add(data.id);
        compositeToRealId.set(data.id, data.realId);
      }
    });

    const leafNodeGroups = nodeGroups.filter(
      (d: HierarchyPointNode<HierarchyDatum>) => leafNodeIds.has(d.data.id),
    );
    const svgEl = svg.node()!;

    const simulation = forceSimulation<SimNode>(simNodes)
      .force(
        "x",
        forceX<SimNode>((d) => {
          const t = targetPositions.get(d.id);
          return t ? t.x : width / 2;
        }).strength(0.5),
      )
      .force(
        "y",
        forceY<SimNode>((d) => {
          const t = targetPositions.get(d.id);
          return t ? t.y : height / 2;
        }).strength(0.5),
      )
      .force("collision", forceCollide().radius(30).strength(0.3));

    leafNodeGroups.call(
      drag<SVGGElement, HierarchyPointNode<HierarchyDatum>>()
        .container(svgEl)
        .on(
          "start",
          (
            event: D3DragEvent<
              SVGGElement,
              HierarchyPointNode<HierarchyDatum>,
              HierarchyPointNode<HierarchyDatum>
            >,
            d: HierarchyPointNode<HierarchyDatum>,
          ) => {
            const sn = simNodeMap.get(d.data.id);
            if (!sn) return;
            if (!event.active) simulation.alphaTarget(0.3).restart();
            sn.fx = sn.x;
            sn.fy = sn.y;
          },
        )
        .on(
          "drag",
          (
            event: D3DragEvent<
              SVGGElement,
              HierarchyPointNode<HierarchyDatum>,
              HierarchyPointNode<HierarchyDatum>
            >,
            d: HierarchyPointNode<HierarchyDatum>,
          ) => {
            const sn = simNodeMap.get(d.data.id);
            if (!sn) return;
            const [mx, my] = pointer(event, svgEl);
            sn.fx = mx;
            sn.fy = my;
          },
        )
        .on(
          "end",
          (
            event: D3DragEvent<
              SVGGElement,
              HierarchyPointNode<HierarchyDatum>,
              HierarchyPointNode<HierarchyDatum>
            >,
            d: HierarchyPointNode<HierarchyDatum>,
          ) => {
            const sn = simNodeMap.get(d.data.id);
            if (!sn) return;
            if (!event.active) simulation.alphaTarget(0);
            sn.fx = null;
            sn.fy = null;
          },
        ),
    );

    simulation.on("tick", () => {
      // Update node positions
      nodeGroups.attr("transform", (d: HierarchyPointNode<HierarchyDatum>) => {
        const pos = getPosition(d.data.id);
        return `translate(${pos.x},${pos.y})`;
      });

      // Update link paths
      treeLinks.selectAll("path").each(function () {
        const d = select(this).datum() as HierarchyLink;
        const sourcePos = getPosition(d.source.data.id);
        const targetPos = getPosition(d.target.data.id);
        select(this).attr(
          "d",
          config.linkCurve(sourcePos.x, sourcePos.y, targetPos.x, targetPos.y),
        );
      });

      // Update badge positions
      linkBadges.selectAll("g").attr("transform", function () {
        const targetId = select(this).attr("data-target-id");
        if (!targetId) return select(this).attr("transform");
        const tPos = getPosition(targetId);
        const sourceId = parentMap.get(targetId);
        if (!sourceId) return select(this).attr("transform");
        const sPos = getPosition(sourceId);
        const midX = (sPos.x + tPos.x) / 2;
        const midY = (sPos.y + tPos.y) / 2;
        return `translate(${midX},${midY})`;
      });
    });

    this.svgBuilder.setSimulation(simulation);
    this.svgBuilder.setupAutoZoomAndResize({
      svg,
      g,
      zoomBehavior: ctx.zoomBehavior,
      containerEl,
      centerNode: centerSimNode,
      useSimulationEnd: true,
      recenterOnResize: false,
    });

    return simulation;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Link badges
  // ─────────────────────────────────────────────────────────────────────────

  private drawLinkBadges(
    linkBadges: Selection<SVGGElement, unknown, null, undefined>,
    root: HierarchyPointNode<HierarchyDatum>,
    targetPositions: Map<string, { x: number; y: number }>,
    _config: HierarchyConfig,
  ): void {
    root.links().forEach((link: HierarchyLink) => {
      const childData = link.target.data as HierarchyDatum;
      if (
        childData.id === "__animation__" ||
        childData.id === "__logistics__" ||
        childData.id === "__logistics_r1__" ||
        childData.id === "__logistics_r2__"
      )
        return;

      const sourcePos = targetPositions.get(link.source.data.id);
      const targetPos = targetPositions.get(link.target.data.id);
      const midX = (sourcePos!.x + targetPos!.x) / 2;
      const midY = (sourcePos!.y + targetPos!.y) / 2;

      const color =
        childData.edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY;
      const badgeText =
        childData.edgeType === "ANIMATION"
          ? "A"
          : childData.dmsId
            ? `DMS:${childData.dmsId}`
            : "L";

      const badgeG = linkBadges
        .append("g")
        .attr("data-target-id", childData.id)
        .attr("data-edge-type", childData.edgeType || "LOGISTICS")
        .attr("transform", `translate(${midX},${midY})`);

      badgeG.append("rect").attr("rx", 6).attr("ry", 6).attr("fill", "white");

      badgeG
        .append("rect")
        .attr("rx", 6)
        .attr("ry", 6)
        .attr("fill", color)
        .attr("fill-opacity", 0.15)
        .attr("stroke", color)
        .attr("stroke-width", 1.5);

      const textEl = badgeG
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .attr("font-size", childData.dmsId ? "7px" : "9px")
        .attr("font-weight", "700")
        .attr("fill", color)
        .text(badgeText);

      const bbox = (textEl.node() as SVGTextElement).getBBox();
      badgeG
        .selectAll("rect")
        .attr("x", bbox.x - 4)
        .attr("y", bbox.y - 2)
        .attr("width", bbox.width + 8)
        .attr("height", bbox.height + 4);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Node rendering (shared for tree & dendrogram)
  // ─────────────────────────────────────────────────────────────────────────

  private drawNodes(
    nodeGroups: Selection<
      SVGGElement,
      HierarchyPointNode<HierarchyDatum>,
      SVGGElement,
      unknown
    >,
    collapsedBranches: Set<string>,
    config: HierarchyConfig,
  ): void {
    nodeGroups.each(function (d: HierarchyPointNode<HierarchyDatum>) {
      const data = d.data as HierarchyDatum;
      const g = select(this);

      // Branch nodes
      if (
        data.id === "__animation__" ||
        data.id === "__logistics__" ||
        data.id === "__logistics_r1__" ||
        data.id === "__logistics_r2__"
      ) {
        const isAnimation = data.id === "__animation__";
        const isLogisticsMain = data.id === "__logistics__";
        const isR1Group = data.id === "__logistics_r1__";
        const label = isAnimation
          ? "Animation"
          : isLogisticsMain
            ? "Logistique"
            : isR1Group
              ? "R1"
              : "R2";
        const color = isAnimation ? COLOR_TERTIARY : COLOR_PRIMARY;
        const rectWidth = isLogisticsMain ? 100 : 60;
        const rectHeight = isLogisticsMain ? 28 : 22;
        const fontSize = isLogisticsMain ? "11px" : "10px";
        const fontWeight = isLogisticsMain ? "600" : "700";

        g.append("rect")
          .attr("rx", 6)
          .attr("ry", 6)
          .attr("width", rectWidth)
          .attr("height", rectHeight)
          .attr("x", -rectWidth / 2)
          .attr("y", -rectHeight / 2)
          .attr("fill", "white");

        g.append("rect")
          .attr("rx", 6)
          .attr("ry", 6)
          .attr("width", rectWidth)
          .attr("height", rectHeight)
          .attr("x", -rectWidth / 2)
          .attr("y", -rectHeight / 2)
          .attr("fill", color)
          .attr("fill-opacity", 0.15)
          .attr("stroke", color)
          .attr("stroke-width", 1.5);

        g.append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "0.35em")
          .attr("font-size", fontSize)
          .attr("font-weight", fontWeight)
          .attr("fill", color)
          .text(label);

        // Collapse/expand indicator
        const isCollapsed = collapsedBranches.has(data.id);
        const indicatorSymbol = isCollapsed ? "\u25B6" : "\u25BC";
        const offset = config.collapseIndicatorOffset(rectWidth, rectHeight);

        g.append("circle")
          .attr("cx", offset.x)
          .attr("cy", offset.y)
          .attr("r", 8)
          .attr("fill", "white")
          .attr("stroke", color)
          .attr("stroke-width", 1.5);

        g.append("text")
          .attr("x", offset.x)
          .attr("y", offset.y)
          .attr("dy", "0.35em")
          .attr("text-anchor", "middle")
          .attr("font-size", "9px")
          .attr("font-weight", "700")
          .attr("fill", color)
          .text(indicatorSymbol);

        g.style("cursor", "pointer");
        return;
      }

      // Root node (SITE)
      if (d.depth === 0) {
        g.append("circle")
          .attr("r", NODE_RADIUS.SITE)
          .attr("fill", NODE_COLORS.SITE)
          .attr("stroke", COLOR_ELECTRIC)
          .attr("stroke-width", 1.5);

        g.append("text")
          .text("R3")
          .attr("dy", "0.35em")
          .attr("text-anchor", "middle")
          .attr("font-size", "9px")
          .attr("font-weight", "700")
          .attr("fill", COLOR_ON_ELECTRIC_CONTAINER);

        g.append("text")
          .text(data.label)
          .attr("dy", NODE_RADIUS.SITE + 16)
          .attr("text-anchor", "middle")
          .attr("font-size", "13px")
          .attr("font-weight", "700")
          .attr("fill", COLOR_ON_ELECTRIC_CONTAINER);
        return;
      }

      // Leaf nodes (R1/R2)
      const radius = NODE_RADIUS[data.type] || 22;
      const fillColor = NODE_COLORS[data.type] || COLOR_PRIMARY;
      const strokeColor = NODE_STROKE_COLORS[data.type] || COLOR_ON_PRIMARY;

      g.append("circle")
        .attr("r", radius + 4)
        .attr("fill", "none")
        .attr("stroke", strokeColor)
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.4);

      g.append("circle")
        .attr("r", radius)
        .attr("fill", fillColor)
        .attr("stroke", strokeColor)
        .attr("stroke-width", 2.5);

      g.append("text")
        .text(NODE_LABELS[data.type] || "")
        .attr("dy", "0.35em")
        .attr("text-anchor", "middle")
        .attr("font-size", "10px")
        .attr("font-weight", "700")
        .attr("fill", NODE_TEXT_COLORS[data.type]);

      // Label positioning depends on layout type
      if (config.labelPosition === "right") {
        g.append("text")
          .text(data.label)
          .attr("dy", "0.35em")
          .attr("text-anchor", "start")
          .attr("x", radius + 8)
          .attr("font-size", "12px")
          .attr("font-weight", "500")
          .attr("fill", COLOR_ON_SECONDARY_CONTAINER);
      } else {
        // bottom (dendrogram)
        g.append("text")
          .text(data.label)
          .attr("dy", radius + 16)
          .attr("text-anchor", "middle")
          .attr("font-size", "11px")
          .attr("font-weight", "500")
          .attr("fill", COLOR_ON_SECONDARY_CONTAINER);
      }

      // SIGMPR mini-tag for R1 leaf nodes
      if (data.type === "R1" && data.sigmpr) {
        const sigmprText = `SIGMPR:${data.sigmpr}`;
        const sigmprG = g.append("g");
        const sigmprColor = NODE_STROKE_COLORS[data.type] || COLOR_PRIMARY;

        sigmprG
          .append("rect")
          .attr("rx", 6)
          .attr("ry", 6)
          .attr("fill", "white");

        sigmprG
          .append("rect")
          .attr("rx", 6)
          .attr("ry", 6)
          .attr("fill", sigmprColor)
          .attr("fill-opacity", 0.15)
          .attr("stroke", sigmprColor)
          .attr("stroke-width", 1.5);

        if (config.labelPosition === "right") {
          // Tree: tag to the right of the label
          const sigmprTextEl = sigmprG
            .append("text")
            .text(sigmprText)
            .attr("x", radius + 8)
            .attr("y", 18)
            .attr("text-anchor", "start")
            .attr("font-size", "7px")
            .attr("font-weight", "700")
            .attr("fill", sigmprColor)
            .attr("pointer-events", "none");

          const sigmprBbox = (sigmprTextEl.node() as SVGTextElement).getBBox();
          sigmprG
            .selectAll("rect")
            .attr("x", sigmprBbox.x - 3)
            .attr("y", sigmprBbox.y - 1.5)
            .attr("width", sigmprBbox.width + 6)
            .attr("height", sigmprBbox.height + 3);
        } else {
          // Dendrogram: tag below the label
          const sigmprTextEl = sigmprG
            .append("text")
            .text(sigmprText)
            .attr("x", 0)
            .attr("y", radius + 30)
            .attr("text-anchor", "middle")
            .attr("font-size", "7px")
            .attr("font-weight", "700")
            .attr("fill", sigmprColor)
            .attr("pointer-events", "none");

          const sigmprBbox = (sigmprTextEl.node() as SVGTextElement).getBBox();
          sigmprG
            .selectAll("rect")
            .attr("x", sigmprBbox.x - 3)
            .attr("y", sigmprBbox.y - 1.5)
            .attr("width", sigmprBbox.width + 6)
            .attr("height", sigmprBbox.height + 3);
        }
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Hover interactions
  // ─────────────────────────────────────────────────────────────────────────

  private addHoverInteractions(
    nodeGroups: Selection<
      SVGGElement,
      HierarchyPointNode<HierarchyDatum>,
      SVGGElement,
      unknown
    >,
    linkPathSelection: Selection<
      SVGPathElement,
      HierarchyLink,
      SVGGElement,
      unknown
    >,
    badgeGroup: Selection<SVGGElement, unknown, null, undefined>,
    centerId: string,
    hierarchyRoot: HierarchyPointNode<HierarchyDatum>,
    tooltipGroup: Selection<SVGGElement, unknown, null, undefined>,
    targetPositions: Map<string, { x: number; y: number }>,
    ctx: HierarchyRenderContext,
  ): void {
    // Build ancestor and descendant maps
    const ancestorMap = new Map<string, Set<string>>();
    const descendantMap = new Map<string, Set<string>>();
    hierarchyRoot
      .descendants()
      .forEach((d: HierarchyPointNode<HierarchyDatum>) => {
        const id = d.data.id;

        const ancestorIds = new Set<string>();
        d.ancestors().forEach((a: HierarchyPointNode<HierarchyDatum>) =>
          ancestorIds.add(a.data.id),
        );
        const existingAncestors = ancestorMap.get(id);
        if (existingAncestors) {
          ancestorIds.forEach((a) => existingAncestors.add(a));
        } else {
          ancestorMap.set(id, ancestorIds);
        }

        const descendantIds = new Set<string>();
        d.descendants().forEach((a: HierarchyPointNode<HierarchyDatum>) =>
          descendantIds.add(a.data.id),
        );
        const existingDescendants = descendantMap.get(id);
        if (existingDescendants) {
          descendantIds.forEach((a) => existingDescendants.add(a));
        } else {
          descendantMap.set(id, descendantIds);
        }
      });

    // Node hover
    nodeGroups
      .on(
        "mouseenter",
        (_event: MouseEvent, d: HierarchyPointNode<HierarchyDatum>) => {
          const nodeId = d.data.id;

          nodeGroups.interrupt();
          linkPathSelection.interrupt();
          badgeGroup.selectAll("g").interrupt();

          if (nodeId === centerId) {
            nodeGroups.attr(
              "opacity",
              (n: HierarchyPointNode<HierarchyDatum>) =>
                n.data.id === centerId ? 1 : 0.25,
            );
            linkPathSelection.attr("opacity", 1);
            badgeGroup.selectAll("g").attr("opacity", 1);
          } else {
            const ancestors = ancestorMap.get(nodeId) || new Set<string>();
            const descendants = descendantMap.get(nodeId) || new Set<string>();
            const highlighted = new Set([...ancestors, ...descendants]);

            nodeGroups.attr(
              "opacity",
              (n: HierarchyPointNode<HierarchyDatum>) =>
                highlighted.has(n.data.id) ? 1 : 0.25,
            );
            linkPathSelection.attr("opacity", (l: HierarchyLink) => {
              const sourceId = l.source.data.id;
              const targetId = l.target.data.id;
              return highlighted.has(sourceId) && highlighted.has(targetId)
                ? 1
                : 0.12;
            });
            badgeGroup.selectAll("g").each(function () {
              const el = select(this);
              const targetId = el.attr("data-target-id");
              el.attr(
                "opacity",
                targetId && highlighted.has(targetId) ? 1 : 0.12,
              );
            });
          }
        },
      )
      .on("mouseleave", () => {
        if (ctx.selectedNodeId) {
          ctx.onApplyNodeSelection();
        } else {
          nodeGroups.interrupt();
          linkPathSelection.interrupt();
          badgeGroup.selectAll("g").interrupt();

          nodeGroups.attr("opacity", 1);
          linkPathSelection.attr("opacity", 1);
          badgeGroup.selectAll("g").attr("opacity", 1);
        }
      });

    // Edge tooltip
    linkPathSelection
      .on("mouseenter", (_event: MouseEvent, d: HierarchyLink) => {
        const childData = d.target.data as HierarchyDatum;
        let text: string;

        if (childData.id === "__animation__") {
          text = "Animation (Ventes)";
        } else if (childData.id === "__logistics__") {
          text = "Logistique";
        } else if (childData.id === "__logistics_r1__") {
          text = "Logistique — R1";
        } else if (childData.id === "__logistics_r2__") {
          text = "Logistique — R2";
        } else {
          const typeLabel =
            childData.edgeType === "ANIMATION"
              ? "Animation (Ventes)"
              : "Logistique";
          if (childData.edgeType === "LOGISTICS") {
            text = `${typeLabel}: ${childData.label} → ${ctx.graphData.center.label}`;
          } else {
            text = `${typeLabel}: ${ctx.graphData.center.label} → ${childData.label}`;
          }
        }

        const sourcePos = targetPositions.get(d.source.data.id);
        const targetPos = targetPositions.get(d.target.data.id);
        if (!sourcePos || !targetPos) return;

        const midX = (sourcePos.x + targetPos.x) / 2;
        const midY = (sourcePos.y + targetPos.y) / 2;

        tooltipGroup
          .append("rect")
          .attr("class", "tooltip-rect")
          .attr("x", midX - 10)
          .attr("y", midY - 14)
          .attr("width", 10)
          .attr("height", 22)
          .attr("fill", COLOR_ON_PRIMARY_CONTAINER)
          .attr("rx", 4)
          .attr("opacity", 0);

        tooltipGroup
          .append("text")
          .attr("class", "tooltip-text")
          .attr("x", midX)
          .attr("y", midY)
          .attr("text-anchor", "middle")
          .attr("dy", "0.35em")
          .attr("font-size", "11px")
          .attr("font-weight", "600")
          .attr("fill", COLOR_ON_PRIMARY)
          .text(text);

        const textBBox = tooltipGroup
          .select(".tooltip-text")
          .node() as SVGTextElement;
        if (textBBox) {
          const bbox = textBBox.getBBox();
          tooltipGroup
            .select(".tooltip-rect")
            .attr("x", bbox.x - 8)
            .attr("y", bbox.y - 4)
            .attr("width", bbox.width + 16)
            .attr("height", bbox.height + 8)
            .attr("opacity", 0.92);
        }
      })
      .on("mouseleave", () => {
        tooltipGroup.selectAll(".tooltip-rect, .tooltip-text").remove();
      });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Build simulation nodes from hierarchy
  // ─────────────────────────────────────────────────────────────────────────

  private buildSimNodes(
    root: HierarchyPointNode<HierarchyDatum>,
    allNodes: HierarchyPointNode<HierarchyDatum>[],
    targetPositions: Map<string, { x: number; y: number }>,
    savedPositions: Map<string, { x: number; y: number }>,
    graphData: GraphData,
    width: number,
    height: number,
  ): {
    simNodes: SimNode[];
    simNodeMap: Map<string, SimNode>;
    centerSimNode: SimNode;
    parentMap: Map<string, string>;
  } {
    const leafNodeIds = new Set<string>();
    const compositeToRealId = new Map<string, string>();

    allNodes.forEach((d: HierarchyPointNode<HierarchyDatum>) => {
      const data = d.data as HierarchyDatum;
      if (
        (data.type === "R1" || data.type === "R2") &&
        data.id !== graphData.center.id &&
        data.realId
      ) {
        leafNodeIds.add(data.id);
        compositeToRealId.set(data.id, data.realId);
      }
    });

    const simNodes: SimNode[] = [];
    const simNodeMap = new Map<string, SimNode>();

    // Center node
    const centerSimNode: SimNode = {
      id: graphData.center.id,
      label: graphData.center.label,
      type: graphData.center.type,
    };
    const centerSimTarget = targetPositions.get(graphData.center.id);
    const savedCenterPos = savedPositions.get(graphData.center.id);
    centerSimNode.fx = centerSimTarget ? centerSimTarget.x : width / 2;
    centerSimNode.fy = centerSimTarget ? centerSimTarget.y : height / 2;
    centerSimNode.x = savedCenterPos ? savedCenterPos.x : centerSimNode.fx;
    centerSimNode.y = savedCenterPos ? savedCenterPos.y : centerSimNode.fy;
    simNodes.push(centerSimNode);
    simNodeMap.set(centerSimNode.id, centerSimNode);

    // Parent map for badge updates
    const parentMap = new Map<string, string>();
    root.links().forEach((link: HierarchyLink) => {
      parentMap.set(link.target.data.id, link.source.data.id);
    });

    // Leaf nodes
    for (const compositeId of leafNodeIds) {
      const realId = compositeToRealId.get(compositeId)!;
      const node = graphData.nodes.find((n) => n.id === realId);
      if (!node) continue;
      const simNode: SimNode = {
        id: compositeId,
        label: node.label,
        type: node.type as NodeType,
        sigmpr: node.sigmpr,
      };
      const target = targetPositions.get(compositeId);
      const saved =
        savedPositions.get(compositeId) || savedPositions.get(realId);
      const parentPos = parentMap.get(compositeId)
        ? targetPositions.get(parentMap.get(compositeId)!)
        : undefined;

      simNode.x = saved
        ? saved.x
        : parentPos
          ? parentPos.x
          : target
            ? target.x
            : width / 2;
      simNode.y = saved
        ? saved.y
        : parentPos
          ? parentPos.y
          : target
            ? target.y
            : height / 2;
      simNodes.push(simNode);
      simNodeMap.set(simNode.id, simNode);
    }

    return { simNodes, simNodeMap, centerSimNode, parentMap };
  }
}
