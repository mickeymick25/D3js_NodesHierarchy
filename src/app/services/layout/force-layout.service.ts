// ─────────────────────────────────────────────────────────────────────────────
// ForceLayoutService — Force-directed layout rendering (extracted from graph.component.ts)
// P2 — Étape 4
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable } from "@angular/core";
import "d3-transition";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  type Simulation,
} from "d3-force";
import { select, type Selection, type BaseType } from "d3-selection";
import { type ZoomBehavior } from "d3-zoom";
import { drag } from "d3-drag";

import {
  type GraphData,
  type SimNode,
  type SimLink,
} from "../../models/graph.model";
import { ElementRefs } from "../../models/element-refs";
import { SvgBuilderService } from "../svg-builder.service";
import {
  COLOR_TERTIARY,
  COLOR_PRIMARY,
  COLOR_ON_PRIMARY,
  COLOR_ON_PRIMARY_CONTAINER,
  COLOR_ELECTRIC,
  NODE_COLORS,
  NODE_STROKE_COLORS,
  NODE_TEXT_COLORS,
  NODE_LABEL_COLORS,
  NODE_RADIUS,
  NODE_LABELS,
  LINK_DISTANCE,
} from "../../models/colors";
import {
  computeCenteredTagRect,
  computeCenteredBadgeRect,
} from "../../models/text-measurer";

// ─────────────────────────────────────────────────────────────────────────────
// Render context — everything the service needs from the component
// ─────────────────────────────────────────────────────────────────────────────

export interface ForceRenderContext {
  svg: Selection<SVGSVGElement, unknown, null, undefined>;
  g: Selection<SVGGElement, unknown, null, undefined>;
  zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;
  graphData: GraphData;
  containerEl: HTMLDivElement;
  savedPositions: Map<string, { x: number; y: number }>;
  selectedNodeId: string | null;
  elementRefs: ElementRefs;
  onNodeSelect: (nodeId: string | null) => void;
  onApplyNodeSelection: () => void;
}

@Injectable({ providedIn: "root" })
export class ForceLayoutService {
  constructor(private svgBuilder: SvgBuilderService) {}

  /**
   * Render the force-directed layout.
   * Returns the created simulation so the component can manage its lifecycle.
   */
  render(ctx: ForceRenderContext): Simulation<SimNode, SimLink> {
    const { svg, g, graphData, containerEl, savedPositions, selectedNodeId } =
      ctx;
    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    const simNodes: SimNode[] = graphData.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      sigmpr: n.sigmpr,
    }));

    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

    const simLinks: SimLink[] = graphData.edges.map((e) => ({
      source: nodeMap.get(e.source)!,
      target: nodeMap.get(e.target)!,
      sourceId: e.source,
      targetId: e.target,
      edgeType: e.type,
      dmsId: e.dmsId,
    }));

    const centerNode = simNodes.find((n) => n.id === graphData.center.id);

    if (centerNode) {
      const saved = savedPositions.get(centerNode.id);
      centerNode.fx = saved ? saved.x : width / 2;
      centerNode.fy = saved ? saved.y : height / 2;
      centerNode.x = centerNode.fx;
      centerNode.y = centerNode.fy;
    }

    // Initialize non-center nodes: R1 on the left, R2 on the right
    const centerX = centerNode ? centerNode.x! : width / 2;
    const centerY = centerNode ? centerNode.y! : height / 2;

    const r1Nodes = simNodes.filter(
      (n) => n.id !== graphData.center.id && n.type === "R1",
    );
    const r2Nodes = simNodes.filter(
      (n) => n.id !== graphData.center.id && n.type === "R2",
    );
    const dist = 200;

    // R1: spread across the left side (angles from 2π/3 to 4π/3)
    r1Nodes.forEach((n, i) => {
      const saved = savedPositions.get(n.id);
      if (saved) {
        n.x = saved.x;
        n.y = saved.y;
      } else {
        const spread = r1Nodes.length > 1 ? Math.PI * 0.7 : 0;
        const startAngle = Math.PI - spread / 2;
        const angle =
          r1Nodes.length === 1
            ? Math.PI
            : startAngle + (spread * i) / (r1Nodes.length - 1);
        n.x = centerX + Math.cos(angle) * dist;
        n.y = centerY + Math.sin(angle) * dist;
      }
    });

    // R2: spread across the right side (angles from -π/3 to π/3)
    r2Nodes.forEach((n, i) => {
      const saved = savedPositions.get(n.id);
      if (saved) {
        n.x = saved.x;
        n.y = saved.y;
      } else {
        const spread = r2Nodes.length > 1 ? Math.PI * 0.7 : 0;
        const startAngle = -spread / 2;
        const angle =
          r2Nodes.length === 1
            ? 0
            : startAngle + (spread * i) / (r2Nodes.length - 1);
        n.x = centerX + Math.cos(angle) * dist;
        n.y = centerY + Math.sin(angle) * dist;
      }
    });

    const parallelCounts = this.countParallelEdges(simLinks);
    const groupIndexMap = new Map<string, number>();
    for (const link of simLinks) {
      const key = [link.sourceId, link.targetId].sort().join("|");
      const idx = groupIndexMap.get(key) || 0;
      groupIndexMap.set(key, idx + 1);
      link._parallelIndex = idx;
    }

    // ── Simulation (created early so drag callbacks can reference it) ──
    const simulation = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => LINK_DISTANCE[d.edgeType] || 150),
      )
      .force("charge", forceManyBody().strength(-400))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collision", forceCollide().radius(90).strength(0.8))
      .force(
        "x",
        forceX<SimNode>((d) => {
          if (d.type === "R1") return width / 2 - 120;
          if (d.type === "R2") return width / 2 + 120;
          return width / 2;
        }).strength(0.08),
      );

    // ── Neighbor nodes ──
    const neighborNodes = g
      .append("g")
      .attr("class", "neighbor-nodes")
      .selectAll("g")
      .data(simNodes.filter((n) => n.id !== graphData.center.id))
      .enter()
      .append("g")
      .attr("class", "g-node")
      .attr("data-node-id", (d) => d.id)
      .attr("cursor", "pointer")
      .call(
        drag<SVGGElement, SimNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    // ── Edge paths ──
    const edgeGroup = g.append("g").attr("class", "edges");
    const edgePaths = this.createEdgePaths(edgeGroup, simLinks);

    // ── Edge labels ──
    const labelGroup = g.append("g").attr("class", "edge-labels");
    const edgeLabels = this.createEdgeLabels(labelGroup, simLinks);

    // ── Tooltip ──
    const linkLabelsGroup = g.append("g").attr("class", "link-labels");
    this.addEdgeTooltip(edgePaths, linkLabelsGroup, simLinks);

    // ── Neighbor nodes (rendered after edges so they appear on top) ──
    this.drawNodeCircles(neighborNodes, false);
    neighborNodes.raise();

    // ── Center node ──
    const centerNodeEl = centerNode
      ? g
          .append("g")
          .attr("class", "center-node g-node")
          .attr("data-node-id", centerNode.id)
          .datum(centerNode)
          .attr("transform", `translate(${centerNode.x},${centerNode.y})`)
      : null;

    if (centerNodeEl) {
      this.drawNodeCircles(
        centerNodeEl as Selection<SVGGElement, SimNode, BaseType, unknown>,
        true,
        centerNode!,
      );
    }

    // ── Populate ElementRefs ──
    ctx.elementRefs.clear();
    neighborNodes.each(function (this: SVGGElement, d: SimNode) {
      ctx.elementRefs.nodeGroupMap.set(d.id, select(this));
      ctx.elementRefs.nodeRealIdMap.set(d.id, d.id);
    });
    if (centerNodeEl && centerNode) {
      const centerEl = centerNodeEl.node();
      if (centerEl) {
        ctx.elementRefs.nodeGroupMap.set(centerNode.id, select(centerEl));
        ctx.elementRefs.nodeRealIdMap.set(centerNode.id, centerNode.id);
      }
    }
    edgePaths.each(function (this: SVGPathElement, d: SimLink) {
      const key = `${d.sourceId}|${d.targetId}|${d.edgeType}`;
      ctx.elementRefs.edgePathMap.set(key, select(this));
    });
    edgeLabels.each(function (this: SVGGElement, d: SimLink) {
      const key = `${d.sourceId}|${d.targetId}|${d.edgeType}`;
      ctx.elementRefs.badgeGroupMap.set(key, select(this));
      ctx.elementRefs.badgeEdgeTypeMap.set(key, d.edgeType);
    });

    // ── Hover interactions ──
    this.addCenterHover(
      ctx.elementRefs,
      simLinks,
      graphData.center.id,
      selectedNodeId,
      ctx.onApplyNodeSelection,
    );

    this.addNeighborHover(
      ctx.elementRefs,
      simLinks,
      graphData.center.id,
      selectedNodeId,
      ctx.onApplyNodeSelection,
    );

    // ── Click to select R1/R2 nodes ──
    neighborNodes.on("click", (_event: MouseEvent, d: SimNode) => {
      if (d.type === "R1" || d.type === "R2") {
        ctx.onNodeSelect(d.id);
      }
    });

    // ── Path computation ──
    const targetRadius = (id: string): number => {
      const n = simNodes.find((sn) => sn.id === id);
      return n ? NODE_RADIUS[n.type] : 20;
    };

    const computePath = (d: SimLink): string =>
      this.computeEdgePath(d, parallelCounts, targetRadius);

    // ── Initial positions ──
    edgePaths.attr("d", computePath);
    neighborNodes.attr("transform", (d) => `translate(${d.x},${d.y})`);
    if (centerNodeEl && centerNode) {
      centerNodeEl.attr(
        "transform",
        `translate(${centerNode.x},${centerNode.y})`,
      );
    }

    // ── Simulation tick ──
    simulation.on("tick", () => {
      edgePaths.attr("d", computePath);
      this.updateEdgeLabelsForce(
        edgeLabels,
        simLinks,
        parallelCounts,
        selectedNodeId,
      );
      neighborNodes.attr("transform", (d) => `translate(${d.x},${d.y})`);
      if (centerNodeEl && centerNode) {
        centerNodeEl.attr(
          "transform",
          `translate(${centerNode.x},${centerNode.y})`,
        );
      }
    });

    // ── Auto-zoom and resize ──
    this.svgBuilder.setSimulation(simulation);
    this.svgBuilder.setupAutoZoomAndResize({
      svg,
      g,
      zoomBehavior: ctx.zoomBehavior,
      containerEl,
      centerNode: centerNode ?? null,
      useSimulationEnd: true,
      recenterOnResize: true,
    });

    return simulation;
  }

  /**
   * Incremental update using D3's Enter/Update/Exit pattern.
   * Returns the new simulation, or null if SVG groups don't exist (fallback to full render).
   */
  update(ctx: ForceRenderContext): Simulation<SimNode, SimLink> | null {
    const { svg, g, graphData, containerEl, savedPositions, selectedNodeId } =
      ctx;
    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    // ── 1. Check for existing SVG groups ──
    const neighborNodesGroup = g.select(".neighbor-nodes");
    const edgesGroup = g.select(".edges");
    const edgeLabelsGroup = g.select(".edge-labels");
    if (
      neighborNodesGroup.empty() ||
      edgesGroup.empty() ||
      edgeLabelsGroup.empty()
    ) {
      return null;
    }

    // ── 2. Read current node positions from ElementRefs ──
    const positions = new Map<string, { x: number; y: number }>();
    ctx.elementRefs.nodeGroupMap.forEach((nodeGroup, nodeId) => {
      const transform = nodeGroup.attr("transform");
      if (transform) {
        const match = transform.match(
          /translate\(\s*([^,\s]+)[\s,]+([^)\s]+)\s*\)/,
        );
        if (match) {
          positions.set(nodeId, {
            x: parseFloat(match[1]),
            y: parseFloat(match[2]),
          });
        }
      }
    });

    // ── 3. Compute new simNodes ──
    const simNodes: SimNode[] = graphData.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      sigmpr: n.sigmpr,
    }));
    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

    // ── 4. Compute new simLinks ──
    const simLinks: SimLink[] = graphData.edges.map((e) => ({
      source: nodeMap.get(e.source)!,
      target: nodeMap.get(e.target)!,
      sourceId: e.source,
      targetId: e.target,
      edgeType: e.type,
      dmsId: e.dmsId,
    }));

    const centerNode = simNodes.find((n) => n.id === graphData.center.id);

    // ── 5. Initialize positions for new nodes ──
    const centerX =
      centerNode && positions.has(centerNode.id)
        ? positions.get(centerNode.id)!.x
        : width / 2;
    const centerY =
      centerNode && positions.has(centerNode.id)
        ? positions.get(centerNode.id)!.y
        : height / 2;

    if (centerNode) {
      const pos = positions.get(centerNode.id);
      centerNode.fx = pos ? pos.x : width / 2;
      centerNode.fy = pos ? pos.y : height / 2;
      centerNode.x = centerNode.fx;
      centerNode.y = centerNode.fy;
    }

    const r1Nodes = simNodes.filter(
      (n) => n.id !== graphData.center.id && n.type === "R1",
    );
    const r2Nodes = simNodes.filter(
      (n) => n.id !== graphData.center.id && n.type === "R2",
    );
    const dist = 200;

    // R1: spread across the left side
    r1Nodes.forEach((n, i) => {
      const pos = positions.get(n.id);
      if (pos) {
        n.x = pos.x;
        n.y = pos.y;
      } else {
        const spread = r1Nodes.length > 1 ? Math.PI * 0.7 : 0;
        const startAngle = Math.PI - spread / 2;
        const angle =
          r1Nodes.length === 1
            ? Math.PI
            : startAngle + (spread * i) / (r1Nodes.length - 1);
        n.x = centerX + Math.cos(angle) * dist;
        n.y = centerY + Math.sin(angle) * dist;
      }
    });

    // R2: spread across the right side
    r2Nodes.forEach((n, i) => {
      const pos = positions.get(n.id);
      if (pos) {
        n.x = pos.x;
        n.y = pos.y;
      } else {
        const spread = r2Nodes.length > 1 ? Math.PI * 0.7 : 0;
        const startAngle = -spread / 2;
        const angle =
          r2Nodes.length === 1
            ? 0
            : startAngle + (spread * i) / (r2Nodes.length - 1);
        n.x = centerX + Math.cos(angle) * dist;
        n.y = centerY + Math.sin(angle) * dist;
      }
    });

    // ── 6. Compute parallel edge counts and indices ──
    const parallelCounts = this.countParallelEdges(simLinks);
    const groupIndexMap = new Map<string, number>();
    for (const link of simLinks) {
      const key = [link.sourceId, link.targetId].sort().join("|");
      const idx = groupIndexMap.get(key) || 0;
      groupIndexMap.set(key, idx + 1);
      link._parallelIndex = idx;
    }

    // ── 7. Data-join neighbor nodes ──
    const neighborData = simNodes.filter((n) => n.id !== graphData.center.id);
    const nodeJoin = neighborNodesGroup
      .selectAll<SVGGElement, SimNode>("g[data-node-id]")
      .data(neighborData, (d: SimNode) => d.id);
    nodeJoin.exit().remove();
    const nodeEnter = nodeJoin
      .enter()
      .append("g")
      .attr("class", "g-node")
      .attr("data-node-id", (d) => d.id)
      .attr("cursor", "pointer");
    this.drawNodeCircles(
      nodeEnter as Selection<SVGGElement, SimNode, BaseType, unknown>,
      false,
    );

    // ── 8. Data-join edge paths ──
    const edgeKey = (d: SimLink) => `${d.sourceId}|${d.targetId}|${d.edgeType}`;
    const edgeJoin = edgesGroup
      .selectAll<SVGPathElement, SimLink>("path")
      .data(simLinks, edgeKey);
    edgeJoin.exit().remove();
    const edgeEnter = edgeJoin
      .enter()
      .append("path")
      .attr("class", "g-edge")
      .attr("fill", "none")
      .attr("stroke", (d: SimLink) =>
        d.edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY,
      )
      .attr("stroke-width", 1.5)
      .attr("stroke-linecap", "round")
      .attr("marker-end", (d: SimLink) =>
        d.edgeType === "ANIMATION" ? "url(#arrow-animation)" : null,
      )
      .attr("marker-start", (d: SimLink) =>
        d.edgeType === "LOGISTICS" ? "url(#arrow-logistics-rev)" : null,
      )
      .attr("data-source-id", (d: SimLink) => d.sourceId)
      .attr("data-target-id", (d: SimLink) => d.targetId)
      .attr("data-edge-type", (d: SimLink) => d.edgeType);
    // Update existing paths (in case attributes changed)
    edgeJoin
      .attr("stroke", (d: SimLink) =>
        d.edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY,
      )
      .attr("marker-end", (d: SimLink) =>
        d.edgeType === "ANIMATION" ? "url(#arrow-animation)" : null,
      )
      .attr("marker-start", (d: SimLink) =>
        d.edgeType === "LOGISTICS" ? "url(#arrow-logistics-rev)" : null,
      )
      .attr("data-source-id", (d: SimLink) => d.sourceId)
      .attr("data-target-id", (d: SimLink) => d.targetId)
      .attr("data-edge-type", (d: SimLink) => d.edgeType);
    const allEdgePaths = edgeEnter.merge(edgeJoin);

    // ── 9. Data-join edge labels ──
    const labelKey = (d: SimLink) =>
      `${d.sourceId}|${d.targetId}|${d.edgeType}`;
    const labelJoin = edgeLabelsGroup
      .selectAll<SVGGElement, SimLink>("g.edge-label")
      .data(simLinks, labelKey);
    labelJoin.exit().remove();
    const labelEnter = labelJoin
      .enter()
      .append("g")
      .attr("class", "edge-label g-badge")
      .attr("data-source-id", (d: SimLink) => d.sourceId)
      .attr("data-target-id", (d: SimLink) => d.targetId)
      .attr("data-edge-type", (d: SimLink) => d.edgeType);
    labelEnter.append("rect").attr("rx", 6).attr("ry", 6).attr("fill", "white");
    labelEnter
      .append("rect")
      .attr("rx", 6)
      .attr("ry", 6)
      .attr("class", "label-bg");
    labelEnter
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", "10px")
      .attr("font-weight", "700")
      .attr("fill", (d: SimLink) =>
        d.edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY,
      )
      .text((d: SimLink) =>
        d.edgeType === "ANIMATION" ? "A" : d.dmsId ? `DMS:${d.dmsId}` : "L",
      );
    // Update existing labels
    labelJoin
      .attr("data-source-id", (d: SimLink) => d.sourceId)
      .attr("data-target-id", (d: SimLink) => d.targetId)
      .attr("data-edge-type", (d: SimLink) => d.edgeType);
    labelJoin
      .select("text")
      .text((d: SimLink) =>
        d.edgeType === "ANIMATION" ? "A" : d.dmsId ? `DMS:${d.dmsId}` : "L",
      );
    labelJoin
      .select("text")
      .attr("fill", (d: SimLink) =>
        d.edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY,
      );
    const allEdgeLabels = labelEnter.merge(labelJoin);

    // ── 10. Clear tooltip group ──
    g.select(".link-labels").selectAll("*").remove();
    const linkLabelsGroup = g.select(".link-labels") as unknown as Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    >;

    // ── 11. Handle center node ──
    const centerNodeEl = g.select(".center-node") as unknown as Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    >;
    if (!centerNodeEl.empty() && centerNode) {
      centerNodeEl
        .datum(centerNode)
        .attr("transform", `translate(${centerNode.x},${centerNode.y})`);
    }

    // ── Z-ordering ──
    g.select(".neighbor-nodes").raise();
    g.select(".center-node").raise();

    // ── 12. Apply drag behavior to ALL neighbor nodes ──
    // Simulation created early so drag callbacks can reference it
    const simulation = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => LINK_DISTANCE[d.edgeType] || 150),
      )
      .force("charge", forceManyBody().strength(-400))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collision", forceCollide().radius(90).strength(0.8))
      .force(
        "x",
        forceX<SimNode>((d) => {
          if (d.type === "R1") return width / 2 - 120;
          if (d.type === "R2") return width / 2 + 120;
          return width / 2;
        }).strength(0.08),
      );

    const allNeighborNodes = nodeEnter.merge(nodeJoin);
    allNeighborNodes.call(
      drag<SVGGElement, SimNode>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

    // ── Rebuild ElementRefs ──
    ctx.elementRefs.clear();
    allNeighborNodes.each(function (this: SVGGElement, d: SimNode) {
      ctx.elementRefs.nodeGroupMap.set(d.id, select(this));
      ctx.elementRefs.nodeRealIdMap.set(d.id, d.id);
    });
    if (!centerNodeEl.empty() && centerNode) {
      const centerEl = centerNodeEl.node();
      if (centerEl) {
        ctx.elementRefs.nodeGroupMap.set(centerNode.id, select(centerEl));
        ctx.elementRefs.nodeRealIdMap.set(centerNode.id, centerNode.id);
      }
    }
    allEdgePaths.each(function (this: SVGPathElement, d: SimLink) {
      const key = `${d.sourceId}|${d.targetId}|${d.edgeType}`;
      ctx.elementRefs.edgePathMap.set(key, select(this));
    });
    allEdgeLabels.each(function (this: SVGGElement, d: SimLink) {
      const key = `${d.sourceId}|${d.targetId}|${d.edgeType}`;
      ctx.elementRefs.badgeGroupMap.set(key, select(this));
      ctx.elementRefs.badgeEdgeTypeMap.set(key, d.edgeType);
    });

    // Cast selection to match the type expected by addEdgeTooltip.
    // g.select() returns BaseType; helper expects SVGGElement parent. Double cast via unknown.
    const typedEdgePaths = allEdgePaths as unknown as Selection<
      SVGPathElement,
      SimLink,
      SVGGElement,
      unknown
    >;

    this.addEdgeTooltip(typedEdgePaths, linkLabelsGroup, simLinks);

    this.addNeighborHover(
      ctx.elementRefs,
      simLinks,
      graphData.center.id,
      selectedNodeId,
      ctx.onApplyNodeSelection,
    );

    this.addCenterHover(
      ctx.elementRefs,
      simLinks,
      graphData.center.id,
      selectedNodeId,
      ctx.onApplyNodeSelection,
    );

    allNeighborNodes.on("click", (_event: MouseEvent, d: SimNode) => {
      if (d.type === "R1" || d.type === "R2") {
        ctx.onNodeSelect(d.id);
      }
    });

    // ── 14. Path computation ──
    const targetRadius = (id: string): number => {
      const n = simNodes.find((sn) => sn.id === id);
      return n ? NODE_RADIUS[n.type] : 20;
    };
    const computePath = (d: SimLink): string =>
      this.computeEdgePath(d, parallelCounts, targetRadius);

    // ── 15. Initial positions for data-joined elements ──
    allEdgePaths.attr("d", computePath);
    allNeighborNodes.attr("transform", (d) => `translate(${d.x},${d.y})`);
    if (!centerNodeEl.empty() && centerNode) {
      centerNodeEl.attr(
        "transform",
        `translate(${centerNode.x},${centerNode.y})`,
      );
    }

    // ── 16. Tick handler ──
    simulation.on("tick", () => {
      const currentEdgePaths = g
        .select(".edges")
        .selectAll<SVGPathElement, SimLink>("path");
      const currentEdgeLabels = g
        .select(".edge-labels")
        .selectAll<SVGGElement, SimLink>("g.edge-label");
      const currentNeighborNodes = g
        .select(".neighbor-nodes")
        .selectAll<SVGGElement, SimNode>("[data-node-id]");

      currentEdgePaths.attr("d", computePath);
      this.updateEdgeLabelsForce(
        currentEdgeLabels as Selection<
          SVGGElement,
          SimLink,
          SVGGElement,
          unknown
        >,
        simLinks,
        parallelCounts,
        selectedNodeId,
      );
      currentNeighborNodes.attr(
        "transform",
        (d: SimNode) => `translate(${d.x},${d.y})`,
      );
      if (!centerNodeEl.empty() && centerNode) {
        centerNodeEl.attr(
          "transform",
          `translate(${centerNode.x},${centerNode.y})`,
        );
      }
    });

    // ── 17. Auto-zoom ──
    this.svgBuilder.setSimulation(simulation);
    this.svgBuilder.setupAutoZoomAndResize({
      svg,
      g,
      zoomBehavior: ctx.zoomBehavior,
      containerEl,
      centerNode: centerNode ?? null,
      useSimulationEnd: true,
      recenterOnResize: true,
    });

    return simulation;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Node rendering
  // ─────────────────────────────────────────────────────────────────────────

  private drawNodeCircles(
    selection: Selection<SVGGElement, SimNode, BaseType, unknown>,
    isCenter: boolean,
    centerNode?: SimNode,
  ): void {
    if (isCenter) {
      selection
        .append("circle")
        .attr("class", "inner-circle")
        .attr("r", NODE_RADIUS.SITE)
        .attr("fill", NODE_COLORS.SITE)
        .attr("stroke", COLOR_ELECTRIC)
        .attr("stroke-width", 1.5);

      selection
        .append("text")
        .text("R3")
        .attr("dy", "0.35em")
        .attr("text-anchor", "middle")
        .attr("font-size", "9px")
        .attr("font-weight", "700")
        .attr("fill", NODE_TEXT_COLORS.SITE)
        .attr("pointer-events", "none");

      if (centerNode) {
        selection
          .append("text")
          .text(centerNode.label)
          .attr("dy", NODE_RADIUS.SITE + 16)
          .attr("text-anchor", "middle")
          .attr("font-size", "13px")
          .attr("font-weight", "700")
          .attr("fill", NODE_LABEL_COLORS.SITE)
          .attr("pointer-events", "none");
      }
    } else {
      selection
        .append("circle")
        .attr("class", "halo-circle")
        .attr("r", (d: SimNode) => NODE_RADIUS[d.type] + 4)
        .attr("fill", "none")
        .attr("stroke", (d: SimNode) => NODE_STROKE_COLORS[d.type])
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.4);

      selection
        .append("circle")
        .attr("class", "inner-circle")
        .attr("r", (d: SimNode) => NODE_RADIUS[d.type])
        .attr("fill", (d: SimNode) => NODE_COLORS[d.type])
        .attr("stroke", (d: SimNode) => NODE_STROKE_COLORS[d.type])
        .attr("stroke-width", 2.5);

      selection
        .append("text")
        .text((d: SimNode) => NODE_LABELS[d.type])
        .attr("dy", "0.35em")
        .attr("text-anchor", "middle")
        .attr("font-size", "10px")
        .attr("font-weight", "700")
        .attr("fill", (d: SimNode) => NODE_TEXT_COLORS[d.type])
        .attr("pointer-events", "none");

      selection
        .append("text")
        .text((d: SimNode) => d.label)
        .attr("dy", (d: SimNode) => NODE_RADIUS[d.type] + 16)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .attr("font-weight", "500")
        .attr("fill", (d: SimNode) => NODE_LABEL_COLORS[d.type])
        .attr("pointer-events", "none");

      // SIGMPR mini-tag for R1 nodes
      const r1WithSigmpr = selection.filter(
        (d: SimNode) => d.type === "R1" && !!d.sigmpr,
      );
      r1WithSigmpr
        .append("rect")
        .attr("rx", 6)
        .attr("ry", 6)
        .attr("fill", "white");
      r1WithSigmpr
        .append("rect")
        .attr("rx", 6)
        .attr("ry", 6)
        .attr("fill", (d: SimNode) => NODE_STROKE_COLORS[d.type])
        .attr("fill-opacity", 0.15)
        .attr("stroke", (d: SimNode) => NODE_STROKE_COLORS[d.type])
        .attr("stroke-width", 1.5);

      const sigmprTextEls = r1WithSigmpr
        .append("text")
        .text((d: SimNode) => `SIGMPR:${d.sigmpr!}`)
        .attr("dy", (d: SimNode) => NODE_RADIUS[d.type] + 32)
        .attr("text-anchor", "middle")
        .attr("font-size", "7px")
        .attr("font-weight", "700")
        .attr("fill", (d: SimNode) => NODE_STROKE_COLORS[d.type])
        .attr("pointer-events", "none");

      // P10: Pre-computed SIGMPR tag dimensions (replaces getBBox)
      r1WithSigmpr.each(function (d: SimNode) {
        if (!d.sigmpr) return;
        const tagText = `SIGMPR:${d.sigmpr}`;
        const rect = computeCenteredTagRect(
          tagText,
          7,
          "700",
          0,
          NODE_RADIUS[d.type] + 32,
          3,
          1.5,
        );
        select(this)
          .selectAll("rect")
          .attr("x", rect.x)
          .attr("y", rect.y)
          .attr("width", rect.width)
          .attr("height", rect.height);
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Edge rendering
  // ─────────────────────────────────────────────────────────────────────────

  private createEdgePaths(
    edgeGroup: Selection<SVGGElement, unknown, null, undefined>,
    simLinks: SimLink[],
  ): Selection<SVGPathElement, SimLink, SVGGElement, unknown> {
    return edgeGroup
      .selectAll("path")
      .data(simLinks)
      .enter()
      .append("path")
      .attr("class", "g-edge")
      .attr("fill", "none")
      .attr("stroke", (d: SimLink) =>
        d.edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY,
      )
      .attr("stroke-width", 1.5)
      .attr("stroke-linecap", "round")
      .attr("marker-end", (d: SimLink) =>
        d.edgeType === "ANIMATION" ? "url(#arrow-animation)" : null,
      )
      .attr("marker-start", (d: SimLink) =>
        d.edgeType === "LOGISTICS" ? "url(#arrow-logistics-rev)" : null,
      )
      .attr("data-source-id", (d: SimLink) => d.sourceId)
      .attr("data-target-id", (d: SimLink) => d.targetId)
      .attr("data-edge-type", (d: SimLink) => d.edgeType);
  }

  private createEdgeLabels(
    labelGroup: Selection<SVGGElement, unknown, null, undefined>,
    simLinks: SimLink[],
  ): Selection<SVGGElement, SimLink, SVGGElement, unknown> {
    const edgeLabels = labelGroup
      .selectAll("g")
      .data(simLinks)
      .enter()
      .append("g")
      .attr("class", "edge-label g-badge")
      .attr("data-source-id", (d: SimLink) => d.sourceId)
      .attr("data-target-id", (d: SimLink) => d.targetId)
      .attr("data-edge-type", (d: SimLink) => d.edgeType);

    edgeLabels.append("rect").attr("rx", 6).attr("ry", 6).attr("fill", "white");

    edgeLabels
      .append("rect")
      .attr("rx", 6)
      .attr("ry", 6)
      .attr("class", "label-bg");

    edgeLabels
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", "10px")
      .attr("font-weight", "700")
      .attr("fill", (d: SimLink) =>
        d.edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY,
      )
      .text((d: SimLink) =>
        d.edgeType === "ANIMATION" ? "A" : d.dmsId ? `DMS:${d.dmsId}` : "L",
      );

    return edgeLabels;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tooltips
  // ─────────────────────────────────────────────────────────────────────────

  private addEdgeTooltip(
    edgePaths: Selection<SVGPathElement, SimLink, SVGGElement, unknown>,
    linkLabelsGroup: Selection<SVGGElement, unknown, null, undefined>,
    simLinks: SimLink[],
  ): void {
    edgePaths
      .on("mouseenter", (_event: MouseEvent, d: SimLink) => {
        const sourceNode = d.source as SimNode;
        const targetNode = d.target as SimNode;
        const typeLabel =
          d.edgeType === "ANIMATION" ? "Animation (Ventes)" : "Logistique";
        const dmsIdPart = d.dmsId ? ` (${d.dmsId})` : "";
        const text =
          d.edgeType === "LOGISTICS"
            ? `${typeLabel}${dmsIdPart}: ${targetNode.label} → ${sourceNode.label}`
            : `${typeLabel}: ${sourceNode.label} → ${targetNode.label}`;

        const midX = (sourceNode.x! + targetNode.x!) / 2;
        const midY = (sourceNode.y! + targetNode.y!) / 2;

        linkLabelsGroup
          .append("rect")
          .attr("class", "tooltip-rect")
          .attr("x", midX - 10)
          .attr("y", midY - 14)
          .attr("width", 10)
          .attr("height", 22)
          .attr("fill", COLOR_ON_PRIMARY_CONTAINER)
          .attr("rx", 4)
          .attr("opacity", 0);

        linkLabelsGroup
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

        const textBBox = linkLabelsGroup
          .select(".tooltip-text")
          .node() as SVGTextElement;
        if (textBBox) {
          const bbox = textBBox.getBBox();
          linkLabelsGroup
            .select(".tooltip-rect")
            .attr("x", bbox.x - 8)
            .attr("y", bbox.y - 4)
            .attr("width", bbox.width + 16)
            .attr("height", bbox.height + 8)
            .attr("opacity", 0.92);
        }
      })
      .on("mouseleave", () => {
        linkLabelsGroup.selectAll(".tooltip-rect, .tooltip-text").remove();
      });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Hover interactions
  // ─────────────────────────────────────────────────────────────────────────

  private addNeighborHover(
    elementRefs: ElementRefs,
    simLinks: SimLink[],
    centerId: string,
    selectedNodeId: string | null,
    onApplyNodeSelection: () => void,
  ): void {
    const { nodeGroupMap, edgePathMap, badgeGroupMap } = elementRefs;

    nodeGroupMap.forEach((el, nodeId) => {
      if (nodeId === centerId) return; // center hover is handled separately

      el.on("mouseenter", () => {
        const linkedEdgeIds = new Set(
          simLinks.filter(
            (l) => l.sourceId === nodeId || l.targetId === nodeId,
          ),
        );

        // Interrupt any ongoing selection transitions before applying hover
        nodeGroupMap.forEach((n) => n.interrupt());
        edgePathMap.forEach((e) => e.interrupt());
        badgeGroupMap.forEach((l) => l.interrupt());

        nodeGroupMap.forEach((nEl, nId) =>
          nEl.classed("dimmed", nId !== nodeId && linkedEdgeIds.size > 0),
        );
        const centerEl = nodeGroupMap.get(centerId);
        if (centerEl) centerEl.classed("dimmed", nodeId !== centerId);

        edgePathMap.forEach((pathEl, key) => {
          const [sourceId, targetId] = key.split("|");
          pathEl.classed("dimmed", sourceId !== nodeId && targetId !== nodeId);
        });

        badgeGroupMap.forEach((labelEl, key) => {
          const [sourceId, targetId] = key.split("|");
          labelEl.classed("dimmed", sourceId !== nodeId && targetId !== nodeId);
        });
      }).on("mouseleave", () => {
        if (selectedNodeId) {
          onApplyNodeSelection();
        } else {
          // Reset all dimmed states — CSS transition handles the animation
          nodeGroupMap.forEach((nEl) => nEl.classed("dimmed", false));
          edgePathMap.forEach((pathEl) => pathEl.classed("dimmed", false));
          badgeGroupMap.forEach((labelEl) => labelEl.classed("dimmed", false));
        }
      });
    });
  }

  private addCenterHover(
    elementRefs: ElementRefs,
    simLinks: SimLink[],
    centerId: string,
    selectedNodeId: string | null,
    onApplyNodeSelection: () => void,
  ): void {
    const { nodeGroupMap, edgePathMap, badgeGroupMap } = elementRefs;
    const centerNodeEl = nodeGroupMap.get(centerId);
    if (!centerNodeEl) return;

    centerNodeEl
      .on("mouseenter", () => {
        // Interrupt any ongoing selection transitions before applying hover
        nodeGroupMap.forEach((n) => n.interrupt());
        edgePathMap.forEach((e) => e.interrupt());
        badgeGroupMap.forEach((l) => l.interrupt());

        nodeGroupMap.forEach((nEl, nId) =>
          nEl.classed("dimmed", nId !== centerId),
        );

        edgePathMap.forEach((pathEl, key) => {
          const [sourceId, targetId] = key.split("|");
          pathEl.classed(
            "dimmed",
            sourceId !== centerId && targetId !== centerId,
          );
        });

        badgeGroupMap.forEach((labelEl, key) => {
          const [sourceId, targetId] = key.split("|");
          labelEl.classed(
            "dimmed",
            sourceId !== centerId && targetId !== centerId,
          );
        });
      })
      .on("mouseleave", () => {
        if (selectedNodeId) {
          onApplyNodeSelection();
        } else {
          // Reset all dimmed states — CSS transition handles the animation
          nodeGroupMap.forEach((nEl) => nEl.classed("dimmed", false));
          edgePathMap.forEach((pathEl) => pathEl.classed("dimmed", false));
          badgeGroupMap.forEach((labelEl) => labelEl.classed("dimmed", false));
        }
      });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Edge path computation
  // ─────────────────────────────────────────────────────────────────────────

  private computeEdgePath(
    d: SimLink,
    parallelCounts: Map<string, number>,
    targetRadius: (id: string) => number,
  ): string {
    const src = d.source as SimNode;
    const tgt = d.target as SimNode;
    const sx = src.x!;
    const sy = src.y!;
    const tx = tgt.x!;
    const ty = tgt.y!;

    const key = [d.sourceId, d.targetId].sort().join("|");
    const total = parallelCounts.get(key) || 1;
    const offset = ForceLayoutService.getLinkOffset(
      d,
      parallelCounts,
      d._parallelIndex ?? 0,
    );

    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    const isLogistics = d.edgeType === "LOGISTICS";

    if (total <= 1) {
      if (isLogistics) {
        const sr = NODE_RADIUS[src.type] || 22;
        const startX = sx + (dx / len) * sr;
        const startY = sy + (dy / len) * sr;
        const tr = targetRadius(d.targetId);
        const ex = tx - (dx / len) * tr;
        const ey = ty - (dy / len) * tr;
        return `M${startX},${startY}L${ex},${ey}`;
      } else {
        const tr = targetRadius(d.targetId);
        const ex = tx - (dx / len) * tr;
        const ey = ty - (dy / len) * tr;
        return `M${sx},${sy}L${ex},${ey}`;
      }
    }

    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2;
    const px = -dy / len;
    const py = dx / len;
    const cx = mx + px * offset;
    const cy = my + py * offset;

    if (isLogistics) {
      const sr = NODE_RADIUS[src.type] || 22;
      const sdx = cx - sx;
      const sdy = cy - sy;
      const slen = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
      const startX = sx + (sdx / slen) * sr;
      const startY = sy + (sdy / slen) * sr;
      const tdx = tx - cx;
      const tdy = ty - cy;
      const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
      const tr = targetRadius(d.targetId);
      const ex = tx - (tdx / tlen) * tr;
      const ey = ty - (tdy / tlen) * tr;
      return `M${startX},${startY}Q${cx},${cy} ${ex},${ey}`;
    } else {
      const tdx = tx - cx;
      const tdy = ty - cy;
      const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
      const tr = targetRadius(d.targetId);
      const ex = tx - (tdx / tlen) * tr;
      const ey = ty - (tdy / tlen) * tr;
      return `M${sx},${sy}Q${cx},${cy} ${ex},${ey}`;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Edge label updates (on tick)
  // ─────────────────────────────────────────────────────────────────────────

  private updateEdgeLabelsForce(
    edgeLabels: Selection<SVGGElement, SimLink, SVGGElement, unknown>,
    simLinks: SimLink[],
    parallelCounts: Map<string, number>,
    selectedNodeId: string | null,
  ): void {
    edgeLabels.each(function (d: SimLink) {
      const src = d.source as SimNode;
      const tgt = d.target as SimNode;
      const sx = src.x!;
      const sy = src.y!;
      const tx = tgt.x!;
      const ty = tgt.y!;

      const parallelOffset = ForceLayoutService.getLinkOffset(
        d,
        parallelCounts,
        d._parallelIndex ?? 0,
      );

      const dx = tx - sx;
      const dy = ty - sy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const px = -dy / len;
      const py = dx / len;

      const mx = (sx + tx) / 2 + px * parallelOffset;
      const my = (sy + ty) / 2 + py * parallelOffset;

      const el = select(this);

      // P10: Pre-computed badge dimensions (replaces getBBox on every tick)
      const badgeText =
        d.edgeType === "ANIMATION" ? "A" : d.dmsId ? `DMS:${d.dmsId}` : "L";
      const badgeRect = computeCenteredBadgeRect(badgeText, 10, "700", 4, 2);

      el.select("text:not(.label-dmsid)").attr("x", mx).attr("y", my);
      el.select(".label-dmsid").attr("x", mx).attr("y", my);

      el.selectAll("rect")
        .attr("x", String(badgeRect.x + mx))
        .attr("y", String(badgeRect.y + my))
        .attr("width", String(badgeRect.width))
        .attr("height", String(badgeRect.height));

      const color = d.edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY;

      if (selectedNodeId) {
        const isSelectedEdge =
          d.sourceId === selectedNodeId || d.targetId === selectedNodeId;
        if (isSelectedEdge) {
          el.select("rect:first-of-type").attr("fill", "white");
          el.select(".label-bg")
            .attr("fill", COLOR_ELECTRIC)
            .attr("fill-opacity", "0.15")
            .attr("stroke", COLOR_ELECTRIC)
            .attr("stroke-width", "1.5");
          el.selectAll("text").attr("fill", COLOR_ELECTRIC);
          return;
        }
      }

      el.select("rect:first-of-type").attr("fill", "white");
      el.select(".label-bg")
        .attr("fill", color)
        .attr("fill-opacity", "0.15")
        .attr("stroke", color)
        .attr("stroke-width", "1.5");
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utility helpers
  // ─────────────────────────────────────────────────────────────────────────

  private countParallelEdges(edges: SimLink[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const e of edges) {
      const key = [e.sourceId, e.targetId].sort().join("|");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  static getLinkOffset(
    link: SimLink,
    parallelCounts: Map<string, number>,
    linkIndexInGroup: number,
  ): number {
    const key = [link.sourceId, link.targetId].sort().join("|");
    const total = parallelCounts.get(key) || 1;
    if (total <= 1) return 0;
    const spacing = 65;
    return (linkIndexInGroup - (total - 1) / 2) * spacing;
  }
}
