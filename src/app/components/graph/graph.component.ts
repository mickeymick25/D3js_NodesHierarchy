import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import * as d3 from "d3";
import { GraphData, NodeType, LayoutMode } from "../../models/graph.model";

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: NodeType;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  edgeType: "ANIMATION" | "LOGISTICS";
  sourceId: string;
  targetId: string;
}

/** Hierarchy node used for tree/radial D3 hierarchy layouts */
interface HierarchyDatum {
  id: string;
  label: string;
  type: NodeType;
  edgeType?: "ANIMATION" | "LOGISTICS";
  children?: HierarchyDatum[];
}

@Component({
  selector: "app-graph",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./graph.component.html",
  styleUrls: ["./graph.component.scss"],
})
export class GraphComponent implements OnChanges, OnDestroy {
  @Input() graphData: GraphData | null = null;
  @Input() layoutMode: LayoutMode = "force";

  @ViewChild("chartContainer", { static: true })
  container!: ElementRef<HTMLDivElement>;

  private simulation: d3.Simulation<SimNode, SimLink> | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Design tokens
  private readonly COLOR_PRIMARY = "#978B7F";
  private readonly COLOR_ON_PRIMARY = "#DEDAD5";
  private readonly COLOR_PRIMARY_CONTAINER = "#DEDAD5";
  private readonly COLOR_ON_PRIMARY_CONTAINER = "#1F1205";
  private readonly COLOR_SECONDARY = "#000000";
  private readonly COLOR_ON_SECONDARY = "#E6E6E6";
  private readonly COLOR_SECONDARY_CONTAINER = "#E6E6E6";
  private readonly COLOR_ON_SECONDARY_CONTAINER = "#1A1A1A";
  private readonly COLOR_TERTIARY = "#2E2ECA";
  private readonly COLOR_ON_TERTIARY = "#FFFFFF";
  private readonly COLOR_TERTIARY_CONTAINER = "#EBEBF7";
  private readonly COLOR_ON_TERTIARY_CONTAINER = "#101078";

  // Electric tokens (for SITE R3)
  private readonly COLOR_ELECTRIC = "#4B9BF5";
  private readonly COLOR_ON_ELECTRIC = "#041A33";
  private readonly COLOR_ELECTRIC_CONTAINER = "#F7FBFF";
  private readonly COLOR_ON_ELECTRIC_CONTAINER = "#1C5494";

  private readonly NODE_COLORS: Record<NodeType, string> = {
    SITE: this.COLOR_ELECTRIC_CONTAINER,
    R1: this.COLOR_PRIMARY,
    R2: this.COLOR_ON_PRIMARY_CONTAINER,
  };

  private readonly NODE_STROKE_COLORS: Record<NodeType, string> = {
    SITE: this.COLOR_ELECTRIC,
    R1: this.COLOR_ON_PRIMARY,
    R2: this.COLOR_ON_PRIMARY,
  };

  private readonly NODE_TEXT_COLORS: Record<NodeType, string> = {
    SITE: this.COLOR_ON_ELECTRIC_CONTAINER,
    R1: this.COLOR_ON_PRIMARY,
    R2: this.COLOR_ON_PRIMARY,
  };

  private readonly NODE_LABEL_COLORS: Record<NodeType, string> = {
    SITE: this.COLOR_ON_ELECTRIC_CONTAINER,
    R1: this.COLOR_ON_SECONDARY_CONTAINER,
    R2: this.COLOR_ON_SECONDARY_CONTAINER,
  };

  private readonly NODE_RADIUS: Record<NodeType, number> = {
    SITE: 30,
    R1: 22,
    R2: 22,
  };

  private readonly NODE_LABELS: Record<NodeType, string> = {
    SITE: "R3",
    R1: "R1",
    R2: "R2",
  };

  private readonly LINK_DISTANCE: Record<string, number> = {
    ANIMATION: 180,
    LOGISTICS: 220,
  };

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes["graphData"] && this.graphData) || changes["layoutMode"]) {
      this.renderGraph();
    }
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private cleanup(): void {
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  private countParallelEdges(edges: SimLink[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const e of edges) {
      const key = [e.sourceId, e.targetId].sort().join("|");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  private getLinkOffset(
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

  /**
   * Build a hierarchy tree from the ego-centered graph data.
   * Structure:
   *   SITE (root)
   *   ├── Animation (branch)
   *   │   └── R1 targets...
   *   └── Logistique (branch)
   *       └── R1/R2 targets...
   */
  private buildHierarchy(): HierarchyDatum {
    if (!this.graphData) {
      return { id: "", label: "", type: "SITE" };
    }

    const center = this.graphData.center;
    const animationTargets: HierarchyDatum[] = [];
    const logisticsTargets: HierarchyDatum[] = [];

    for (const edge of this.graphData.edges) {
      const targetNode = this.graphData.nodes.find((n) => n.id === edge.target);
      if (!targetNode) continue;

      const leaf: HierarchyDatum = {
        id: targetNode.id,
        label: targetNode.label,
        type: targetNode.type,
        edgeType: edge.type,
      };

      if (edge.type === "ANIMATION") {
        animationTargets.push(leaf);
      } else {
        logisticsTargets.push(leaf);
      }
    }

    const root: HierarchyDatum = {
      id: center.id,
      label: center.label,
      type: center.type,
      children: [],
    };

    if (animationTargets.length > 0) {
      root.children!.push({
        id: "__animation__",
        label: "Animation",
        type: "R1",
        edgeType: "ANIMATION",
        children: animationTargets,
      });
    }

    if (logisticsTargets.length > 0) {
      root.children!.push({
        id: "__logistics__",
        label: "Logistique",
        type: "R2",
        edgeType: "LOGISTICS",
        children: logisticsTargets,
      });
    }

    return root;
  }

  private renderGraph(): void {
    if (!this.graphData) return;
    this.cleanup();

    // Delegate to specialized renderers based on layout mode
    switch (this.layoutMode) {
      case "tree":
        this.renderTreeLayout();
        break;
      case "radial":
        this.renderRadialLayout();
        break;
      case "pack":
        this.renderPackLayout();
        break;
      default:
        this.renderForceLayout();
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // FORCE LAYOUT (original ego-centered)
  // ═══════════════════════════════════════════════════════════════════

  private renderForceLayout(): void {
    if (!this.graphData) return;

    const containerEl = this.container.nativeElement;
    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    d3.select(containerEl).select("svg").remove();

    const svg = d3
      .select(containerEl)
      .append("svg")
      .attr("width", width)
      .attr("height", height);

    const defs = svg.append("defs");
    this.addArrowMarkers(defs);

    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });
    svg.call(zoom);

    const simNodes: SimNode[] = this.graphData.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
    }));

    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

    const simLinks: SimLink[] = this.graphData.edges.map((e) => ({
      source: nodeMap.get(e.source)!,
      target: nodeMap.get(e.target)!,
      sourceId: e.source,
      targetId: e.target,
      edgeType: e.type,
    }));

    const centerNode = simNodes.find((n) => n.id === this.graphData!.center.id);

    if (centerNode) {
      centerNode.fx = width / 2;
      centerNode.fy = height / 2;
      centerNode.x = width / 2;
      centerNode.y = height / 2;
    }

    // Initialize non-center nodes in a circle
    const centerX = width / 2;
    const centerY = height / 2;
    const spreadAngle = (2 * Math.PI) / Math.max(simNodes.length - 1, 1);
    let nodeIndex = 0;
    for (const n of simNodes) {
      if (n.id !== this.graphData!.center.id) {
        const angle = spreadAngle * nodeIndex;
        const dist = 200;
        n.x = centerX + Math.cos(angle) * dist;
        n.y = centerY + Math.sin(angle) * dist;
        nodeIndex++;
      }
    }

    const parallelCounts = this.countParallelEdges(simLinks);
    const groupIndexMap = new Map<string, number>();
    for (const link of simLinks) {
      const key = [link.sourceId, link.targetId].sort().join("|");
      const idx = groupIndexMap.get(key) || 0;
      groupIndexMap.set(key, idx + 1);
      (link as any)._parallelIndex = idx;
    }

    // ── Neighbor nodes ──
    const neighborNodes = g
      .append("g")
      .attr("class", "neighbor-nodes")
      .selectAll("g")
      .data(simNodes.filter((n) => n.id !== this.graphData!.center.id))
      .enter()
      .append("g")
      .attr("cursor", "pointer")
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on("start", (event, d) => {
            if (!event.active) this.simulation?.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) this.simulation?.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    this.drawNodeCircles(neighborNodes, false);

    // ── Edge paths ──
    const edgeGroup = g.append("g").attr("class", "edges");
    const edgePaths = this.createEdgePaths(edgeGroup, simLinks);

    // ── Edge labels ──
    const labelGroup = g.append("g").attr("class", "edge-labels");
    const edgeLabels = this.createEdgeLabels(labelGroup, simLinks);

    // ── Tooltip ──
    const linkLabelsGroup = g.append("g").attr("class", "link-labels");
    this.addEdgeTooltip(edgePaths, linkLabelsGroup, simLinks);

    // ── Hover interactions ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const centerNodeEl: any = centerNode
      ? g
          .append("g")
          .attr("class", "center-node")
          .datum(centerNode)
          .attr("transform", `translate(${centerNode.x},${centerNode.y})`)
      : null;

    if (centerNodeEl) {
      this.drawNodeCircles(centerNodeEl, true, centerNode!);
      this.addCenterHover(
        centerNodeEl,
        neighborNodes,
        edgePaths,
        edgeLabels,
        simLinks,
      );
    }

    this.addNeighborHover(
      neighborNodes,
      edgePaths,
      edgeLabels,
      simLinks,
      centerNodeEl,
    );

    // ── Path computation ──
    const targetRadius = (id: string): number => {
      const n = simNodes.find((n) => n.id === id);
      return n ? this.NODE_RADIUS[n.type] : 20;
    };

    const computePath = (d: SimLink): string =>
      this.computeEdgePath(d, parallelCounts, targetRadius);

    // ── Force simulation ──
    this.simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => this.LINK_DISTANCE[d.edgeType] || 150),
      )
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(70).strength(0.8));

    // Initial render
    edgePaths.attr("d", computePath);
    neighborNodes.attr("transform", (d) => `translate(${d.x},${d.y})`);
    if (centerNodeEl)
      centerNodeEl.attr(
        "transform",
        `translate(${centerNode!.x},${centerNode!.y})`,
      );

    this.simulation.on("tick", () => {
      edgePaths.attr("d", computePath);
      this.updateEdgeLabelsForce(edgeLabels, simLinks, parallelCounts);
      neighborNodes.attr("transform", (d) => `translate(${d.x},${d.y})`);
      if (centerNodeEl && centerNode)
        centerNodeEl.attr(
          "transform",
          `translate(${centerNode.x},${centerNode.y})`,
        );
    });

    this.setupAutoZoomAndResize(
      svg,
      g,
      zoom,
      containerEl,
      centerNode ?? null,
      true,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // TREE LAYOUT (D3 hierarchy tree - Reingold-Tilford)
  // ═══════════════════════════════════════════════════════════════════

  private renderTreeLayout(): void {
    if (!this.graphData) return;

    const containerEl = this.container.nativeElement;
    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    d3.select(containerEl).select("svg").remove();

    const svg = d3
      .select(containerEl)
      .append("svg")
      .attr("width", width)
      .attr("height", height);

    const defs = svg.append("defs");
    this.addArrowMarkers(defs);

    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });
    svg.call(zoom);

    // Build hierarchy
    const hierarchyData = this.buildHierarchy();
    const root = d3.hierarchy(hierarchyData);

    // Compute tree layout - horizontal orientation (left to right)
    const treeLayout = d3
      .tree<HierarchyDatum>()
      .size([height - 80, width - 300])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.5));

    treeLayout(root);

    // D3 tree gives us x,y but we want horizontal: swap them
    // x → vertical position, y → horizontal depth
    const allNodes = root.descendants();

    // Scale to fit
    const nodeSize = 40;

    // Draw links (from parent to child)
    const treeLinks = g.append("g").attr("class", "tree-links");

    treeLinks
      .selectAll("path")
      .data(root.links())
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", (d: any) => {
        // Color based on the type of connection
        const childData = d.target.data as HierarchyDatum;
        if (childData.edgeType === "ANIMATION") return this.COLOR_TERTIARY;
        return this.COLOR_PRIMARY;
      })
      .attr("stroke-width", 2.5)
      .attr("stroke-dasharray", (d: any) => {
        const childData = d.target.data as HierarchyDatum;
        if (childData.edgeType === "LOGISTICS") return "8,4";
        return "none";
      })
      .attr("d", (d: any) => {
        // Horizontal tree link: curve from source to target
        const sx = d.source.y + 150;
        const sy = d.source.x + 40;
        const tx = d.target.y + 150;
        const ty = d.target.x + 40;
        // Use a smooth horizontal curve (cubic bezier)
        const midX = (sx + tx) / 2;
        return `M${sx},${sy}C${midX},${sy} ${midX},${ty} ${tx},${ty}`;
      });

    // Draw link midpoint badges
    const linkBadges = g.append("g").attr("class", "link-badges");

    root.links().forEach((link: any) => {
      const childData = link.target.data as HierarchyDatum;
      // Skip branches (Animation/Logistique) — only show badges on leaf links
      if (childData.id === "__animation__" || childData.id === "__logistics__")
        return;

      const midX = (link.source.y + link.target.y) / 2 + 150;
      const midY = (link.source.x + link.target.x) / 2 + 40;

      const color =
        childData.edgeType === "ANIMATION"
          ? this.COLOR_TERTIARY
          : this.COLOR_PRIMARY;
      const badgeText = childData.edgeType === "ANIMATION" ? "A" : "L";

      const badgeG = linkBadges
        .append("g")
        .attr("transform", `translate(${midX},${midY})`);

      badgeG
        .append("rect")
        .attr("rx", 8)
        .attr("ry", 8)
        .attr("fill", color)
        .attr("fill-opacity", 0.9);

      const textEl = badgeG
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .attr("font-size", "9px")
        .attr("font-weight", "700")
        .attr("fill", this.COLOR_ON_PRIMARY)
        .text(badgeText);

      const bbox = (textEl.node() as SVGTextElement).getBBox();
      badgeG
        .select("rect")
        .attr("x", bbox.x - 4)
        .attr("y", bbox.y - 2)
        .attr("width", bbox.width + 8)
        .attr("height", bbox.height + 4);
    });

    // Draw nodes
    const nodeGroups = g
      .append("g")
      .attr("class", "tree-nodes")
      .selectAll("g")
      .data(allNodes)
      .enter()
      .append("g")
      .attr("transform", (d: any) => `translate(${d.y + 150},${d.x + 40})`)
      .attr("cursor", "pointer");

    // Style each node based on its role
    const self = this;
    nodeGroups.each(function (d: any) {
      const data = d.data as HierarchyDatum;
      const g = d3.select(this);

      // Branch nodes (Animation/Logistique labels)
      if (data.id === "__animation__" || data.id === "__logistics__") {
        const isAnimation = data.id === "__animation__";
        g.append("rect")
          .attr("rx", 6)
          .attr("ry", 6)
          .attr("width", 100)
          .attr("height", 28)
          .attr("x", -50)
          .attr("y", -14)
          .attr("fill", "white");

        g.append("rect")
          .attr("rx", 6)
          .attr("ry", 6)
          .attr("width", 100)
          .attr("height", 28)
          .attr("x", -50)
          .attr("y", -14)
          .attr("fill", isAnimation ? self.COLOR_TERTIARY : self.COLOR_PRIMARY)
          .attr("fill-opacity", 0.15)
          .attr(
            "stroke",
            isAnimation ? self.COLOR_TERTIARY : self.COLOR_PRIMARY,
          )
          .attr("stroke-width", 1.5);

        g.append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "0.35em")
          .attr("font-size", "11px")
          .attr("font-weight", "600")
          .attr("fill", isAnimation ? self.COLOR_TERTIARY : self.COLOR_PRIMARY)
          .text(data.label);
        return;
      }

      // Root node (SITE)
      if (d.depth === 0) {
        g.append("circle")
          .attr("r", self.NODE_RADIUS.SITE)
          .attr("fill", self.NODE_COLORS.SITE)
          .attr("stroke", self.COLOR_ELECTRIC)
          .attr("stroke-width", 1.5);

        g.append("text")
          .text("R3")
          .attr("dy", "0.35em")
          .attr("text-anchor", "end")
          .attr("x", -self.NODE_RADIUS.SITE - 6)
          .attr("font-size", "9px")
          .attr("font-weight", "700")
          .attr("fill", self.COLOR_ON_ELECTRIC_CONTAINER);

        g.append("text")
          .text(data.label)
          .attr("dy", "0.35em")
          .attr("text-anchor", "end")
          .attr("x", -self.NODE_RADIUS.SITE - 6)
          .attr("y", 13)
          .attr("font-size", "13px")
          .attr("font-weight", "700")
          .attr("fill", self.COLOR_ON_ELECTRIC_CONTAINER);
        return;
      }

      // Leaf nodes (R1/R2)
      const radius = self.NODE_RADIUS[data.type] || 22;
      const fillColor = self.NODE_COLORS[data.type] || self.COLOR_PRIMARY;

      g.append("circle")
        .attr("r", radius + 4)
        .attr("fill", "none")
        .attr("stroke", self.COLOR_ON_PRIMARY)
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.4);

      g.append("circle")
        .attr("r", radius)
        .attr("fill", fillColor)
        .attr("stroke", self.COLOR_ON_PRIMARY)
        .attr("stroke-width", 2.5);

      g.append("text")
        .text(self.NODE_LABELS[data.type] || "")
        .attr("dy", "0.35em")
        .attr("text-anchor", "middle")
        .attr("font-size", "10px")
        .attr("font-weight", "700")
        .attr("fill", self.COLOR_ON_PRIMARY);

      g.append("text")
        .text(data.label)
        .attr("dy", "0.35em")
        .attr("text-anchor", "start")
        .attr("x", radius + 8)
        .attr("font-size", "12px")
        .attr("font-weight", "500")
        .attr("fill", self.COLOR_ON_SECONDARY_CONTAINER);
    });

    this.setupAutoZoomAndResize(svg, g, zoom, containerEl, null, false);
  }

  // ═══════════════════════════════════════════════════════════════════
  // RADIAL LAYOUT (D3 hierarchy + polar projection)
  // ═══════════════════════════════════════════════════════════════════

  private renderRadialLayout(): void {
    if (!this.graphData) return;

    const containerEl = this.container.nativeElement;
    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    d3.select(containerEl).select("svg").remove();

    const svg = d3
      .select(containerEl)
      .append("svg")
      .attr("width", width)
      .attr("height", height);

    const defs = svg.append("defs");
    this.addArrowMarkers(defs);

    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });
    svg.call(zoom);

    // Build hierarchy for radial tree
    const hierarchyData = this.buildHierarchy();
    const root = d3.hierarchy(hierarchyData);

    const radius = Math.min(width, height) / 2 - 120;

    const treeLayout = d3
      .tree<HierarchyDatum>()
      .size([2 * Math.PI, radius])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);

    treeLayout(root);

    // Convert polar to cartesian, centered in SVG
    const cx = width / 2;
    const cy = height / 2;

    // Draw radial links
    const radialLinks = g.append("g").attr("class", "radial-links");

    radialLinks
      .selectAll("path")
      .data(root.links())
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", (d: any) => {
        const childData = d.target.data as HierarchyDatum;
        if (childData.edgeType === "ANIMATION") return this.COLOR_TERTIARY;
        return this.COLOR_PRIMARY;
      })
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", (d: any) => {
        const childData = d.target.data as HierarchyDatum;
        if (childData.edgeType === "LOGISTICS") return "8,4";
        return "none";
      })
      .attr("d", (d: any) => {
        // Manual radial link path
        const sx = cx + d.source.y * Math.cos(d.source.x - Math.PI / 2);
        const sy = cy + d.source.y * Math.sin(d.source.x - Math.PI / 2);
        const tx = cx + d.target.y * Math.cos(d.target.x - Math.PI / 2);
        const ty = cy + d.target.y * Math.sin(d.target.x - Math.PI / 2);
        const mx = (sx + tx) / 2;
        const my = (sy + ty) / 2;
        // Use a quadratic curve for smooth radial links
        const sourceR = d.source.y;
        const targetR = d.target.y;
        const midR = (sourceR + targetR) / 2;
        const midAngle = (d.source.x + d.target.x) / 2 - Math.PI / 2;
        const cmx = cx + midR * Math.cos(midAngle);
        const cmy = cy + midR * Math.sin(midAngle);
        return `M${sx},${sy}Q${cmx},${cmy} ${tx},${ty}`;
      });

    // Draw link badges
    const linkBadges = g.append("g").attr("class", "link-badges");

    root.links().forEach((link: any) => {
      const childData = link.target.data as HierarchyDatum;
      if (childData.id === "__animation__" || childData.id === "__logistics__")
        return;

      const midAngle = (link.source.x + link.target.x) / 2;
      const midRadius = (link.source.y + link.target.y) / 2;
      const mx = cx + midRadius * Math.cos(midAngle - Math.PI / 2);
      const my = cy + midRadius * Math.sin(midAngle - Math.PI / 2);

      const color =
        childData.edgeType === "ANIMATION"
          ? this.COLOR_TERTIARY
          : this.COLOR_PRIMARY;
      const badgeText = childData.edgeType === "ANIMATION" ? "A" : "L";

      const badgeG = linkBadges
        .append("g")
        .attr("transform", `translate(${mx},${my})`);

      badgeG
        .append("rect")
        .attr("rx", 8)
        .attr("ry", 8)
        .attr("fill", color)
        .attr("fill-opacity", 0.9);

      const textEl = badgeG
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .attr("font-size", "9px")
        .attr("font-weight", "700")
        .attr("fill", this.COLOR_ON_PRIMARY)
        .text(badgeText);

      const bbox = (textEl.node() as SVGTextElement).getBBox();
      badgeG
        .select("rect")
        .attr("x", bbox.x - 4)
        .attr("y", bbox.y - 2)
        .attr("width", bbox.width + 8)
        .attr("height", bbox.height + 4);
    });

    // Draw nodes
    const nodeGroups = g
      .append("g")
      .attr("class", "radial-nodes")
      .selectAll("g")
      .data(root.descendants())
      .enter()
      .append("g")
      .attr(
        "transform",
        (d: any) =>
          `translate(${cx + d.y * Math.cos(d.x - Math.PI / 2)},${cy + d.y * Math.sin(d.x - Math.PI / 2)})`,
      )
      .attr("cursor", "pointer");

    // Style each node based on its role
    const self = this;
    nodeGroups.each(function (d: any) {
      const data = d.data as HierarchyDatum;
      const g = d3.select(this);

      // Branch nodes
      if (data.id === "__animation__" || data.id === "__logistics__") {
        const isAnimation = data.id === "__animation__";
        g.append("rect")
          .attr("rx", 6)
          .attr("ry", 6)
          .attr("width", 90)
          .attr("height", 24)
          .attr("x", -45)
          .attr("y", -12)
          .attr("fill", isAnimation ? self.COLOR_TERTIARY : self.COLOR_PRIMARY)
          .attr("fill-opacity", 0.15)
          .attr(
            "stroke",
            isAnimation ? self.COLOR_TERTIARY : self.COLOR_PRIMARY,
          )
          .attr("stroke-width", 1.5);

        g.append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "0.35em")
          .attr("font-size", "10px")
          .attr("font-weight", "600")
          .attr("fill", isAnimation ? self.COLOR_TERTIARY : self.COLOR_PRIMARY)
          .text(data.label);
        return;
      }

      // Root node
      if (d.depth === 0) {
        g.append("circle")
          .attr("r", self.NODE_RADIUS.SITE)
          .attr("fill", self.NODE_COLORS.SITE)
          .attr("stroke", self.COLOR_ELECTRIC)
          .attr("stroke-width", 1.5);

        g.append("text")
          .text("R3")
          .attr("dy", "0.35em")
          .attr("text-anchor", "middle")
          .attr("font-size", "9px")
          .attr("font-weight", "700")
          .attr("fill", self.COLOR_ON_ELECTRIC_CONTAINER);

        g.append("text")
          .text(data.label)
          .attr("dy", self.NODE_RADIUS.SITE + 16)
          .attr("text-anchor", "middle")
          .attr("font-size", "13px")
          .attr("font-weight", "700")
          .attr("fill", self.COLOR_ON_ELECTRIC_CONTAINER);
        return;
      }

      // Leaf nodes
      const radius = self.NODE_RADIUS[data.type] || 22;
      const fillColor = self.NODE_COLORS[data.type] || self.COLOR_PRIMARY;

      g.append("circle")
        .attr("r", radius + 4)
        .attr("fill", "none")
        .attr("stroke", self.COLOR_ON_PRIMARY)
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.4);

      g.append("circle")
        .attr("r", radius)
        .attr("fill", fillColor)
        .attr("stroke", self.COLOR_ON_PRIMARY)
        .attr("stroke-width", 2.5);

      g.append("text")
        .text(self.NODE_LABELS[data.type] || "")
        .attr("dy", "0.35em")
        .attr("text-anchor", "middle")
        .attr("font-size", "10px")
        .attr("font-weight", "700")
        .attr("fill", self.COLOR_ON_PRIMARY);

      g.append("text")
        .text(data.label)
        .attr("dy", radius + 16)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .attr("font-weight", "500")
        .attr("fill", self.COLOR_ON_SECONDARY_CONTAINER);
    });

    this.setupAutoZoomAndResize(svg, g, zoom, containerEl, null, false);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PACK LAYOUT (R1/R2 grouped arcs around center)
  // ═══════════════════════════════════════════════════════════════════

  private renderPackLayout(): void {
    if (!this.graphData) return;

    const containerEl = this.container.nativeElement;
    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    d3.select(containerEl).select("svg").remove();

    const svg = d3
      .select(containerEl)
      .append("svg")
      .attr("width", width)
      .attr("height", height);

    const defs = svg.append("defs");
    this.addArrowMarkers(defs);

    const g = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });
    svg.call(zoom);

    const simNodes: SimNode[] = this.graphData.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
    }));

    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

    const simLinks: SimLink[] = this.graphData.edges.map((e) => ({
      source: nodeMap.get(e.source)!,
      target: nodeMap.get(e.target)!,
      sourceId: e.source,
      targetId: e.target,
      edgeType: e.type,
    }));

    const centerNode = simNodes.find(
      (n) => n.id === this.graphData!.center.id,
    )!;

    const cx = width / 2;
    const cy = height / 2;

    // Pin center
    centerNode.fx = cx;
    centerNode.fy = cy;
    centerNode.x = cx;
    centerNode.y = cy;

    // Separate R1 and R2 nodes into arcs
    const neighbors = simNodes.filter(
      (n) => n.id !== this.graphData!.center.id,
    );
    const r1Nodes = neighbors.filter((n) => n.type === "R1");
    const r2Nodes = neighbors.filter((n) => n.type === "R2");

    const groupRadius = 280;

    // R1 cluster in left arc
    if (r1Nodes.length > 0) {
      const r1CenterAngle = -Math.PI / 2;
      const r1Spread = Math.min(Math.PI, Math.PI / 2 + r1Nodes.length * 0.05);
      r1Nodes.forEach((n, i) => {
        const angle =
          r1CenterAngle -
          r1Spread / 2 +
          (r1Nodes.length === 1 ? 0 : (r1Spread * i) / (r1Nodes.length - 1));
        n.x = cx + groupRadius * Math.cos(angle);
        n.y = cy + groupRadius * Math.sin(angle);
        n.fx = n.x;
        n.fy = n.y;
      });
    }

    // R2 cluster in right arc
    if (r2Nodes.length > 0) {
      const r2CenterAngle = Math.PI / 2;
      const r2Spread = Math.min(Math.PI, Math.PI / 2 + r2Nodes.length * 0.05);
      r2Nodes.forEach((n, i) => {
        const angle =
          r2CenterAngle -
          r2Spread / 2 +
          (r2Nodes.length === 1 ? 0 : (r2Spread * i) / (r2Nodes.length - 1));
        n.x = cx + groupRadius * Math.cos(angle);
        n.y = cy + groupRadius * Math.sin(angle);
        n.fx = n.x;
        n.fy = n.y;
      });
    }

    // Draw arc zone indicators (subtle)
    if (r1Nodes.length > 0) {
      g.append("text")
        .attr("x", cx - groupRadius - 30)
        .attr("y", cy - groupRadius + 20)
        .attr("font-size", "12px")
        .attr("font-weight", "600")
        .attr("fill", this.COLOR_PRIMARY)
        .attr("fill-opacity", 0.4)
        .text("R1");
    }

    if (r2Nodes.length > 0) {
      g.append("text")
        .attr("x", cx + groupRadius - 10)
        .attr("y", cy + groupRadius + 20)
        .attr("font-size", "12px")
        .attr("font-weight", "600")
        .attr("fill", this.COLOR_ON_PRIMARY_CONTAINER)
        .attr("fill-opacity", 0.4)
        .text("R2");
    }

    const parallelCounts = this.countParallelEdges(simLinks);
    const groupIndexMap = new Map<string, number>();
    for (const link of simLinks) {
      const key = [link.sourceId, link.targetId].sort().join("|");
      const idx = groupIndexMap.get(key) || 0;
      groupIndexMap.set(key, idx + 1);
      (link as any)._parallelIndex = idx;
    }

    // ── Neighbor nodes ──
    const neighborNodes = g
      .append("g")
      .attr("class", "neighbor-nodes")
      .selectAll("g")
      .data(simNodes.filter((n) => n.id !== this.graphData!.center.id))
      .enter()
      .append("g")
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .attr("cursor", "pointer");

    this.drawNodeCircles(neighborNodes, false);

    // ── Edge paths ──
    const edgeGroup = g.append("g").attr("class", "edges");
    const edgePaths = this.createEdgePaths(edgeGroup, simLinks);

    // ── Edge labels ──
    const labelGroup = g.append("g").attr("class", "edge-labels");
    const edgeLabels = this.createEdgeLabels(labelGroup, simLinks);

    // ── Center node on top ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const centerNodeEl: any = g
      .append("g")
      .attr("class", "center-node")
      .datum(centerNode)
      .attr("transform", `translate(${centerNode.x},${centerNode.y})`);

    this.drawNodeCircles(centerNodeEl, true, centerNode);

    // ── Tooltip ──
    const linkLabelsGroup = g.append("g").attr("class", "link-labels");
    this.addEdgeTooltip(edgePaths, linkLabelsGroup, simLinks);

    // Hover interactions
    this.addNeighborHover(
      neighborNodes,
      edgePaths,
      edgeLabels,
      simLinks,
      centerNodeEl,
    );

    centerNodeEl
      .on("mouseenter", () => {
        const centerId = this.graphData!.center.id;
        neighborNodes.attr("opacity", 0.25);
        centerNodeEl.attr("opacity", 1);
        edgePaths.attr("opacity", (l: SimLink) =>
          l.sourceId === centerId || l.targetId === centerId ? 1 : 0.12,
        );
        edgeLabels.attr("opacity", (l: SimLink) =>
          l.sourceId === centerId || l.targetId === centerId ? 1 : 0.12,
        );
      })
      .on("mouseleave", () => {
        neighborNodes.attr("opacity", 1);
        centerNodeEl.attr("opacity", 1);
        edgePaths.attr("opacity", 1);
        edgeLabels.attr("opacity", 1);
      });

    // ── Path computation ──
    const targetRadius = (id: string): number => {
      const n = simNodes.find((n) => n.id === id);
      return n ? this.NODE_RADIUS[n.type] : 20;
    };

    const computePath = (d: SimLink): string =>
      this.computeEdgePath(d, parallelCounts, targetRadius);

    edgePaths.attr("d", computePath);
    this.updateEdgeLabelsOnce(edgeLabels, simLinks, parallelCounts);

    this.setupAutoZoomAndResize(svg, g, zoom, containerEl, centerNode, false);
  }

  // ═══════════════════════════════════════════════════════════════════
  // SHARED HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private addArrowMarkers(
    defs: d3.Selection<SVGDefsElement, unknown, null, undefined>,
  ): void {
    defs
      .append("marker")
      .attr("id", "arrow-animation")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 8)
      .attr("refY", 0)
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-4L8,0L0,4")
      .attr("fill", this.COLOR_TERTIARY);

    defs
      .append("marker")
      .attr("id", "arrow-logistics")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 8)
      .attr("refY", 0)
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-4L8,0L0,4")
      .attr("fill", this.COLOR_PRIMARY);
  }

  private drawNodeCircles(
    selection: d3.Selection<SVGGElement, any, any, any>,
    isCenter: boolean,
    centerNode?: SimNode,
  ): void {
    const nodeData = isCenter && centerNode ? [centerNode] : undefined;

    if (isCenter) {
      selection
        .append("circle")
        .attr("r", this.NODE_RADIUS.SITE)
        .attr("fill", this.NODE_COLORS.SITE)
        .attr("stroke", this.COLOR_ELECTRIC)
        .attr("stroke-width", 1.5);

      selection
        .append("text")
        .text("R3")
        .attr("dy", "0.35em")
        .attr("text-anchor", "middle")
        .attr("font-size", "9px")
        .attr("font-weight", "700")
        .attr("fill", this.NODE_TEXT_COLORS.SITE)
        .attr("pointer-events", "none");

      if (centerNode) {
        selection
          .append("text")
          .text(centerNode.label)
          .attr("dy", this.NODE_RADIUS.SITE + 16)
          .attr("text-anchor", "middle")
          .attr("font-size", "13px")
          .attr("font-weight", "700")
          .attr("fill", this.NODE_LABEL_COLORS.SITE)
          .attr("pointer-events", "none");
      }
    } else {
      selection
        .append("circle")
        .attr("r", (d: SimNode) => this.NODE_RADIUS[d.type] + 4)
        .attr("fill", "none")
        .attr("stroke", this.COLOR_ON_PRIMARY)
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.4);

      selection
        .append("circle")
        .attr("r", (d: SimNode) => this.NODE_RADIUS[d.type])
        .attr("fill", (d: SimNode) => this.NODE_COLORS[d.type])
        .attr("stroke", (d: SimNode) => this.NODE_STROKE_COLORS[d.type])
        .attr("stroke-width", 2.5);

      selection
        .append("text")
        .text((d: SimNode) => this.NODE_LABELS[d.type])
        .attr("dy", "0.35em")
        .attr("text-anchor", "middle")
        .attr("font-size", "10px")
        .attr("font-weight", "700")
        .attr("fill", (d: SimNode) => this.NODE_TEXT_COLORS[d.type])
        .attr("pointer-events", "none");

      selection
        .append("text")
        .text((d: SimNode) => d.label)
        .attr("dy", (d: SimNode) => this.NODE_RADIUS[d.type] + 16)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .attr("font-weight", "500")
        .attr("fill", (d: SimNode) => this.NODE_LABEL_COLORS[d.type])
        .attr("pointer-events", "none");
    }
  }

  private createEdgePaths(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    edgeGroup: any,
    simLinks: SimLink[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    return edgeGroup
      .selectAll("path")
      .data(simLinks)
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", (d: SimLink) =>
        d.edgeType === "ANIMATION" ? this.COLOR_TERTIARY : this.COLOR_PRIMARY,
      )
      .attr("stroke-width", 3)
      .attr("stroke-dasharray", (d: SimLink) =>
        d.edgeType === "LOGISTICS" ? "12,6" : "none",
      )
      .attr("stroke-linecap", "round")
      .attr("marker-end", (d: SimLink) =>
        d.edgeType === "ANIMATION"
          ? "url(#arrow-animation)"
          : "url(#arrow-logistics)",
      );
  }

  private createEdgeLabels(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    labelGroup: any,
    simLinks: SimLink[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    const edgeLabels = labelGroup
      .selectAll("g")
      .data(simLinks)
      .enter()
      .append("g")
      .attr("class", "edge-label");

    edgeLabels
      .append("rect")
      .attr("rx", 8)
      .attr("ry", 8)
      .attr("class", "label-bg");

    edgeLabels
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", "10px")
      .attr("font-weight", "700")
      .attr("fill", this.COLOR_ON_PRIMARY)
      .text((d: SimLink) => (d.edgeType === "ANIMATION" ? "A" : "L"));

    return edgeLabels;
  }

  private addEdgeTooltip(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    edgePaths: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    linkLabelsGroup: any,
    simLinks: SimLink[],
  ): void {
    edgePaths
      .on("mouseenter", (_event: MouseEvent, d: SimLink) => {
        const sourceNode = d.source as SimNode;
        const targetNode = d.target as SimNode;
        const typeLabel =
          d.edgeType === "ANIMATION" ? "Animation (Ventes)" : "Logistique";
        const text = `${typeLabel}: ${sourceNode.label} → ${targetNode.label}`;

        const midX = (sourceNode.x! + targetNode.x!) / 2;
        const midY = (sourceNode.y! + targetNode.y!) / 2;

        linkLabelsGroup
          .append("rect")
          .attr("class", "tooltip-rect")
          .attr("x", midX - 10)
          .attr("y", midY - 14)
          .attr("width", 10)
          .attr("height", 22)
          .attr("fill", this.COLOR_ON_PRIMARY_CONTAINER)
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
          .attr("fill", this.COLOR_ON_PRIMARY)
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

  private addNeighborHover(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    neighborNodes: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    edgePaths: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    edgeLabels: any,
    simLinks: SimLink[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    centerNodeEl: any,
  ): void {
    neighborNodes
      .on("mouseenter", (_event: MouseEvent, d: SimNode) => {
        const linkedEdgeIds = new Set(
          simLinks.filter((l) => l.sourceId === d.id || l.targetId === d.id),
        );

        neighborNodes.attr("opacity", (n: SimNode) =>
          n.id === d.id || linkedEdgeIds.size === 0 ? 1 : 0.25,
        );
        if (centerNodeEl)
          centerNodeEl.attr(
            "opacity",
            d.id === this.graphData!.center.id ? 1 : 0.25,
          );

        edgePaths.attr("opacity", (l: SimLink) =>
          l.sourceId === d.id || l.targetId === d.id ? 1 : 0.12,
        );

        edgeLabels.attr("opacity", (l: SimLink) =>
          l.sourceId === d.id || l.targetId === d.id ? 1 : 0.12,
        );
      })
      .on("mouseleave", () => {
        neighborNodes.attr("opacity", 1);
        if (centerNodeEl) centerNodeEl.attr("opacity", 1);
        edgePaths.attr("opacity", 1);
        edgeLabels.attr("opacity", 1);
      });
  }

  private addCenterHover(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    centerNodeEl: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    neighborNodes: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    edgePaths: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    edgeLabels: any,
    simLinks: SimLink[],
  ): void {
    centerNodeEl
      .on("mouseenter", () => {
        const centerId = this.graphData!.center.id;
        neighborNodes.attr("opacity", 0.25);
        centerNodeEl.attr("opacity", 1);
        edgePaths.attr("opacity", (l: SimLink) =>
          l.sourceId === centerId || l.targetId === centerId ? 1 : 0.12,
        );
        edgeLabels.attr("opacity", (l: SimLink) =>
          l.sourceId === centerId || l.targetId === centerId ? 1 : 0.12,
        );
      })
      .on("mouseleave", () => {
        neighborNodes.attr("opacity", 1);
        centerNodeEl.attr("opacity", 1);
        edgePaths.attr("opacity", 1);
        edgeLabels.attr("opacity", 1);
      });
  }

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
    const offset = this.getLinkOffset(
      d,
      parallelCounts,
      (d as any)._parallelIndex,
    );

    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    if (total <= 1) {
      const tr = targetRadius(d.targetId);
      const ex = tx - (dx / len) * tr;
      const ey = ty - (dy / len) * tr;
      return `M${sx},${sy}L${ex},${ey}`;
    }

    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2;
    const px = -dy / len;
    const py = dx / len;
    const cx = mx + px * offset;
    const cy = my + py * offset;

    const tdx = tx - cx;
    const tdy = ty - cy;
    const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
    const tr = targetRadius(d.targetId);
    const ex = tx - (tdx / tlen) * tr;
    const ey = ty - (tdy / tlen) * tr;

    return `M${sx},${sy}Q${cx},${cy} ${ex},${ey}`;
  }

  private updateEdgeLabelsForce(
    edgeLabels: d3.Selection<SVGGElement, SimLink, SVGGElement, unknown>,
    simLinks: SimLink[],
    parallelCounts: Map<string, number>,
  ): void {
    edgeLabels.each(function (d: SimLink) {
      const src = d.source as SimNode;
      const tgt = d.target as SimNode;
      const sx = src.x!;
      const sy = src.y!;
      const tx = tgt.x!;
      const ty = tgt.y!;

      const key = [d.sourceId, d.targetId].sort().join("|");
      const parallelOffset = GraphComponent.getLinkOffsetStatic(
        d,
        parallelCounts,
        (d as any)._parallelIndex,
      );

      const dx = tx - sx;
      const dy = ty - sy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const px = -dy / len;
      const py = dx / len;

      const mx = (sx + tx) / 2 + px * parallelOffset;
      const my = (sy + ty) / 2 + py * parallelOffset;

      const el = d3.select(this);
      const textEl = el.select("text").node() as SVGTextElement;
      const rectEl = el.select("rect").node() as SVGRectElement;

      el.select("text").attr("x", mx).attr("y", my);
      el.select("rect").attr("x", mx).attr("y", my);

      if (textEl) {
        const bbox = textEl.getBBox();
        rectEl.setAttribute("x", String(bbox.x - 5));
        rectEl.setAttribute("y", String(bbox.y - 2));
        rectEl.setAttribute("width", String(bbox.width + 10));
        rectEl.setAttribute("height", String(bbox.height + 4));
      }

      const color = d.edgeType === "ANIMATION" ? "#2E2ECA" : "#978B7F";
      rectEl.setAttribute("fill", color);
      rectEl.setAttribute("fill-opacity", "0.9");
    });
  }

  private updateEdgeLabelsOnce(
    edgeLabels: d3.Selection<SVGGElement, SimLink, SVGGElement, unknown>,
    simLinks: SimLink[],
    parallelCounts: Map<string, number>,
  ): void {
    edgeLabels.each(function (d: SimLink) {
      const src = d.source as SimNode;
      const tgt = d.target as SimNode;
      const sx = src.x!;
      const sy = src.y!;
      const tx = tgt.x!;
      const ty = tgt.y!;

      const key = [d.sourceId, d.targetId].sort().join("|");
      const parallelOffset = GraphComponent.getLinkOffsetStatic(
        d,
        parallelCounts,
        (d as any)._parallelIndex,
      );

      const dx = tx - sx;
      const dy = ty - sy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const px = -dy / len;
      const py = dx / len;

      const mx = (sx + tx) / 2 + px * parallelOffset;
      const my = (sy + ty) / 2 + py * parallelOffset;

      const el = d3.select(this);
      const textEl = el.select("text").node() as SVGTextElement;
      const rectEl = el.select("rect").node() as SVGRectElement;

      el.select("text").attr("x", mx).attr("y", my);
      el.select("rect").attr("x", mx).attr("y", my);

      if (textEl) {
        const bbox = textEl.getBBox();
        rectEl.setAttribute("x", String(bbox.x - 5));
        rectEl.setAttribute("y", String(bbox.y - 2));
        rectEl.setAttribute("width", String(bbox.width + 10));
        rectEl.setAttribute("height", String(bbox.height + 4));
      }

      const color = d.edgeType === "ANIMATION" ? "#2E2ECA" : "#978B7F";
      rectEl.setAttribute("fill", color);
      rectEl.setAttribute("fill-opacity", "0.9");
    });
  }

  private setupAutoZoomAndResize(
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    zoom: d3.ZoomBehavior<SVGSVGElement, unknown>,
    containerEl: HTMLDivElement,
    centerNode: SimNode | null,
    isForceLayout: boolean,
  ): void {
    const fitZoom = () => {
      const bounds = (g.node() as SVGGElement).getBBox();
      if (bounds.width === 0 || bounds.height === 0) return;
      const fullWidth = containerEl.clientWidth;
      const fullHeight = containerEl.clientHeight;
      const bmidX = bounds.x + bounds.width / 2;
      const bmidY = bounds.y + bounds.height / 2;
      const scale =
        0.85 / Math.max(bounds.width / fullWidth, bounds.height / fullHeight);
      const clampedScale = Math.min(Math.max(scale, 0.3), 2);
      svg
        .transition()
        .duration(500)
        .call(
          zoom.transform,
          d3.zoomIdentity
            .translate(fullWidth / 2, fullHeight / 2)
            .scale(clampedScale)
            .translate(-bmidX, -bmidY),
        );
    };

    if (isForceLayout && this.simulation) {
      this.simulation.on("end", fitZoom);
    } else {
      setTimeout(fitZoom, 100);
    }

    this.resizeObserver = new ResizeObserver(() => {
      const w = containerEl.clientWidth;
      const h = containerEl.clientHeight;
      svg.attr("width", w).attr("height", h);

      if (centerNode && isForceLayout) {
        centerNode.fx = w / 2;
        centerNode.fy = h / 2;
        if (this.simulation) {
          this.simulation.alpha(0.3).restart();
        }
      }

      const doFitZoom = () => {
        const bounds = (g.node() as SVGGElement).getBBox();
        if (bounds.width === 0 || bounds.height === 0) return;
        const bmidX = bounds.x + bounds.width / 2;
        const bmidY = bounds.y + bounds.height / 2;
        const sc = 0.85 / Math.max(bounds.width / w, bounds.height / h);
        const clamped = Math.min(Math.max(sc, 0.3), 2);
        svg
          .transition()
          .duration(300)
          .call(
            zoom.transform,
            d3.zoomIdentity
              .translate(w / 2, h / 2)
              .scale(clamped)
              .translate(-bmidX, -bmidY),
          );
      };

      setTimeout(doFitZoom, 400);
    });
    this.resizeObserver.observe(containerEl);
  }

  private static getLinkOffsetStatic(
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
