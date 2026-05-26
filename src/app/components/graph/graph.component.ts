import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from "@angular/core";
import { CommonModule } from "@angular/common";

// Selective D3 imports for tree-shaking (P1)
import "d3-transition"; // side-effect: patches Selection prototype with .transition()
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
  type Simulation,
} from "d3-force";
import { hierarchy, tree, cluster } from "d3-hierarchy";
import { select, pointer, type Selection } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { drag } from "d3-drag";
import { timer, type Timer } from "d3-timer";
import { interpolateRgb } from "d3-interpolate";

import { GraphData, NodeType, LayoutMode } from "../../models/graph.model";
import {
  COLOR_PRIMARY,
  COLOR_ON_PRIMARY,
  COLOR_PRIMARY_CONTAINER,
  COLOR_ON_PRIMARY_CONTAINER,
  COLOR_SECONDARY_CONTAINER,
  COLOR_ON_SECONDARY_CONTAINER,
  COLOR_TERTIARY,
  COLOR_ON_TERTIARY,
  COLOR_TERTIARY_CONTAINER,
  COLOR_ON_TERTIARY_CONTAINER,
  COLOR_ELECTRIC,
  COLOR_ON_ELECTRIC,
  COLOR_ELECTRIC_CONTAINER,
  COLOR_ON_ELECTRIC_CONTAINER,
  NODE_COLORS,
  NODE_STROKE_COLORS,
  NODE_TEXT_COLORS,
  NODE_LABEL_COLORS,
  NODE_RADIUS,
  NODE_LABELS,
  LINK_DISTANCE,
} from "../../models/colors";

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: NodeType;
  sigmpr?: string;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  edgeType: "ANIMATION" | "LOGISTICS";
  sourceId: string;
  targetId: string;
  dmsId?: string;
}

/** Hierarchy node used for tree/radial D3 hierarchy layouts */
interface HierarchyDatum {
  id: string;
  realId?: string; // original node ID (when id is a composite for uniqueness)
  label: string;
  type: NodeType;
  edgeType?: "ANIMATION" | "LOGISTICS";
  dmsId?: string;
  sigmpr?: string;
  children?: HierarchyDatum[];
}

@Component({
  selector: "app-graph",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./graph.component.html",
  styleUrls: ["./graph.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphComponent implements OnChanges, OnDestroy {
  @Input() graphData: GraphData | null = null;
  @Input() layoutMode: LayoutMode = "force";
  @Input() selectedNodeIdBySearch: string | null = null;

  @ViewChild("chartContainer", { static: true })
  container!: ElementRef<HTMLDivElement>;

  // Persistent SVG state
  private svg: Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private g: Selection<SVGGElement, unknown, null, undefined> | null = null;
  private zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
  private simulation: Simulation<SimNode, SimLink> | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // Saved positions for smooth layout transitions
  private savedPositions = new Map<string, { x: number; y: number }>();

  // Collapsed branches in tree view
  private collapsedBranches = new Set<string>();

  // Selected node (click to select, click again to deselect)
  private selectedNodeId: string | null = null;

  // Transition duration for selection animations (ms)
  private readonly SELECTION_TRANSITION_MS = 250;

  // Electric current animation timer
  private selectionAnimTimer: Timer | null = null;
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

  // P7: Cached hierarchy
  private cachedHierarchy: HierarchyDatum | null = null;
  private cachedHierarchyKey: string | null = null;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.graphData) return;

    this.cdr.markForCheck();

    if (changes["graphData"]) {
      // Data changed → full rebuild (P7: also invalidate hierarchy cache)
      this.stopElectricAnimation();
      this.destroySvg();
      this.savedPositions.clear();
      this.collapsedBranches.clear();
      this.cachedHierarchy = null;
      this.cachedHierarchyKey = null;
      this.selectedNodeId = null;
      this.renderGraph();
      // Apply search node selection after graph rebuild
      if (this.selectedNodeIdBySearch) {
        this.selectedNodeId = this.selectedNodeIdBySearch;
        this.applyNodeSelection();
      }
    } else if (changes["layoutMode"]) {
      // Layout changed → smooth transition
      this.stopElectricAnimation();
      this.saveNodePositions();
      this.stopSimulation();
      this.renderGraph();
    } else if (changes["selectedNodeIdBySearch"]) {
      // Search node selection/deselection without full rebuild
      if (this.selectedNodeIdBySearch) {
        this.selectedNodeId = this.selectedNodeIdBySearch;
        this.applyNodeSelection();
      } else {
        this.selectedNodeId = null;
        this.stopElectricAnimation();
        this.applyNodeSelection();
      }
    }
  }

  ngOnDestroy(): void {
    this.stopElectricAnimation();
    this.destroySvg();
  }

  private stopSimulation(): void {
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }
  }

  private destroySvg(): void {
    this.stopSimulation();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.svg) {
      select(this.container.nativeElement).select("svg").remove();
      this.svg = null;
      this.g = null;
      this.zoomBehavior = null;
    }
  }

  private initSvg(): void {
    const containerEl = this.container.nativeElement;
    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    this.svg = select(containerEl)
      .append("svg")
      .attr("width", width)
      .attr("height", height);

    const defs = this.svg.append("defs");
    this.addArrowMarkers(defs);

    this.g = this.svg.append("g");

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        this.g!.attr("transform", event.transform.toString());
      });
    this.svg.call(this.zoomBehavior);
  }

  private saveNodePositions(): void {
    this.savedPositions.clear();
    if (!this.g) return;

    const positions = new Map<string, { x: number; y: number }>();
    this.g!.selectAll("[data-node-id]").each(function () {
      const el = select(this);
      const nodeId = el.attr("data-node-id");
      const realId = el.attr("data-real-id");
      const transform = el.attr("transform");
      if (nodeId && transform) {
        const match = transform.match(
          /translate\(\s*([^,\s]+)[\s,]+([^)\s]+)\s*\)/,
        );
        if (match) {
          const x = parseFloat(match[1]);
          const y = parseFloat(match[2]);
          if (!isNaN(x) && !isNaN(y)) {
            positions.set(nodeId, { x, y });
            // Also save by real ID so positions survive layout mode switches
            // (Force mode uses real IDs, Tree/Dendrogram use composite IDs)
            if (realId && realId !== nodeId) {
              positions.set(realId, { x, y });
            }
          }
        }
      }
    });

    this.savedPositions = positions;
  }

  private getSavedPosition(
    id: string,
    defaultX: number,
    defaultY: number,
  ): { x: number; y: number } {
    const saved = this.savedPositions.get(id);
    if (saved) {
      return saved;
    }
    // For nodes without saved position (e.g. branch nodes), start from center
    // or from the center node's position if available
    const centerPos = this.savedPositions.get(this.graphData?.center.id || "");
    if (centerPos) {
      return centerPos;
    }
    return { x: defaultX, y: defaultY };
  }

  private countParallelEdges(edges: SimLink[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const e of edges) {
      const key = [e.sourceId, e.targetId].sort().join("|");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  /**
   * Build a hierarchy tree from the ego-centered graph data.
   * P7: Uses a cache keyed on site ID + filters + collapsed branches.
   * Structure:
   *   SITE (root)
   *   ├── Animation (branch)
   *   │   └── R1 targets...
   *   └── Logistique (branch)
   *       ├── R1 (sub-branch)
   *       │   └── R1 logistics targets...
   *       └── R2 (sub-branch)
   *           └── R2 targets...
   */
  private buildHierarchy(): HierarchyDatum {
    if (!this.graphData) {
      return { id: "", label: "", type: "SITE" };
    }

    // P7: Compute cache key from current state
    const collapsedKey =
      this.collapsedBranches.size > 0
        ? [...this.collapsedBranches].sort().join(",")
        : "";
    const key = `${this.graphData.center.id}:${this.collapsedBranches.size}:${collapsedKey}`;

    if (this.cachedHierarchy && this.cachedHierarchyKey === key) {
      return this.cachedHierarchy;
    }

    const result = this.buildHierarchyImpl();
    this.cachedHierarchy = result;
    this.cachedHierarchyKey = key;
    return result;
  }

  private buildHierarchyImpl(): HierarchyDatum {
    if (!this.graphData) {
      return { id: "", label: "", type: "SITE" };
    }

    const center = this.graphData.center;
    const animationTargets: HierarchyDatum[] = [];
    const logisticsR1Targets: HierarchyDatum[] = [];
    const logisticsR2Targets: HierarchyDatum[] = [];

    for (const edge of this.graphData.edges) {
      const targetNode = this.graphData.nodes.find((n) => n.id === edge.target);
      if (!targetNode) continue;

      const leaf: HierarchyDatum = {
        id: `${targetNode.id}___${edge.type}`,
        realId: targetNode.id,
        label: targetNode.label,
        type: targetNode.type,
        edgeType: edge.type,
        dmsId: edge.dmsId,
        sigmpr: targetNode.sigmpr,
      };

      if (edge.type === "ANIMATION") {
        animationTargets.push(leaf);
      } else {
        if (targetNode.type === "R1") {
          logisticsR1Targets.push(leaf);
        } else {
          logisticsR2Targets.push(leaf);
        }
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

    if (logisticsR1Targets.length > 0 || logisticsR2Targets.length > 0) {
      const logisticsChildren: HierarchyDatum[] = [];

      if (logisticsR1Targets.length > 0) {
        logisticsChildren.push({
          id: "__logistics_r1__",
          label: "R1",
          type: "R1",
          edgeType: "LOGISTICS",
          children: logisticsR1Targets,
        });
      }

      if (logisticsR2Targets.length > 0) {
        logisticsChildren.push({
          id: "__logistics_r2__",
          label: "R2",
          type: "R2",
          edgeType: "LOGISTICS",
          children: logisticsR2Targets,
        });
      }

      root.children!.push({
        id: "__logistics__",
        label: "Logistique",
        type: "R2",
        edgeType: "LOGISTICS",
        children: logisticsChildren,
      });
    }

    return root;
  }

  private renderGraph(): void {
    if (!this.graphData) return;

    // Ensure SVG container exists
    if (!this.svg || !this.g) {
      this.initSvg();
    }

    // Update SVG dimensions
    const containerEl = this.container.nativeElement;
    this.svg!.attr("width", containerEl.clientWidth).attr(
      "height",
      containerEl.clientHeight,
    );

    // Clear previous content (keep SVG container)
    this.g!.selectAll("*").remove();

    // Recreate defs/markers (cleared byselectAll)
    this.svg!.select("defs").remove();
    this.svg!.insert("defs", ":first-child").call((d) =>
      this.addArrowMarkers(d),
    );

    // Delegate to specialized renderers based on layout mode
    switch (this.layoutMode) {
      case "tree":
        this.renderTreeLayout();
        break;
      case "dendrogram":
        this.renderDendrogramLayout();
        break;
      default:
        this.renderForceLayout();
        break;
    }

    // Re-apply node selection after render
    if (this.selectedNodeId) {
      this.applyNodeSelection();
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

    // Use persistent SVG
    const svg = this.svg!;
    const g = this.g!;

    const simNodes: SimNode[] = this.graphData.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      sigmpr: n.sigmpr,
    }));

    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

    const simLinks: SimLink[] = this.graphData.edges.map((e) => ({
      source: nodeMap.get(e.source)!,
      target: nodeMap.get(e.target)!,
      sourceId: e.source,
      targetId: e.target,
      edgeType: e.type,
      dmsId: e.dmsId,
    }));

    const centerNode = simNodes.find((n) => n.id === this.graphData!.center.id);

    if (centerNode) {
      // Use saved position if available, otherwise center
      const saved = this.savedPositions.get(centerNode.id);
      centerNode.fx = saved ? saved.x : width / 2;
      centerNode.fy = saved ? saved.y : height / 2;
      centerNode.x = centerNode.fx;
      centerNode.y = centerNode.fy;
    }

    // Initialize non-center nodes: R1 on the left, R2 on the right
    const centerX = centerNode ? centerNode.x! : width / 2;
    const centerY = centerNode ? centerNode.y! : height / 2;

    const r1Nodes = simNodes.filter(
      (n) => n.id !== this.graphData!.center.id && n.type === "R1",
    );
    const r2Nodes = simNodes.filter(
      (n) => n.id !== this.graphData!.center.id && n.type === "R2",
    );
    const dist = 200;

    // R1: spread across the left side (angles from 2π/3 to 4π/3)
    r1Nodes.forEach((n, i) => {
      const saved = this.savedPositions.get(n.id);
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
      const saved = this.savedPositions.get(n.id);
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
      .attr("data-node-id", (d) => d.id)
      .attr("cursor", "pointer")
      .call(
        drag<SVGGElement, SimNode>()
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

    // ── Hover interactions ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const centerNodeEl: any = centerNode
      ? g
          .append("g")
          .attr("class", "center-node")
          .attr("data-node-id", centerNode.id)
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

    // ── Click to select R1/R2 nodes ──
    neighborNodes.on("click", (_event: MouseEvent, d: SimNode) => {
      if (d.type === "R1" || d.type === "R2") {
        this.selectedNodeId = this.selectedNodeId === d.id ? null : d.id;
        this.applyNodeSelection();
      }
    });

    // ── Path computation ──
    const targetRadius = (id: string): number => {
      const n = simNodes.find((n) => n.id === id);
      return n ? NODE_RADIUS[n.type] : 20;
    };

    const computePath = (d: SimLink): string =>
      this.computeEdgePath(d, parallelCounts, targetRadius);

    // ── Force simulation ──
    this.simulation = forceSimulation<SimNode>(simNodes)
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
      this.zoomBehavior!,
      containerEl,
      centerNode ?? null,
      true,
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

    // Use persistent SVG
    const svg = this.svg!;
    const g = this.g!;

    // Build hierarchy
    const hierarchyData = this.buildHierarchy();
    const root = hierarchy(hierarchyData);

    // Apply collapsed state to branch nodes
    root.each((node: any) => {
      if (this.collapsedBranches.has(node.data.id) && node.children) {
        (node as any)._children = node.children;
        node.children = null;
      }
    });

    // Compute tree layout - horizontal orientation (left to right)
    const treeLayout = tree<HierarchyDatum>()
      .size([height - 80, width - 300])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.5));

    treeLayout(root);

    // D3 tree gives us x,y but we want horizontal: swap them
    // x → vertical position, y → horizontal depth
    const allNodes = root.descendants();

    // Visible node IDs (for filtering collapsed nodes)
    const visibleIds = new Set(allNodes.map((d: any) => d.data.id));

    // Compute target positions for each node
    const targetPositions = new Map<string, { x: number; y: number }>();
    allNodes.forEach((d: any) => {
      targetPositions.set(d.data.id, { x: d.y + 150, y: d.x + 40 });
    });

    // Build parent position map for newly expanded nodes
    const parentPositions = new Map<string, { x: number; y: number }>();
    allNodes.forEach((d: any) => {
      if (d.parent) {
        const parentPos = targetPositions.get(d.parent.data.id);
        if (parentPos) {
          parentPositions.set(d.data.id, parentPos);
        }
      }
    });

    // Get center position for default transitions
    const centerTarget = targetPositions.get(this.graphData.center.id);
    const defaultX = centerTarget ? centerTarget.x : width / 2;
    const defaultY = centerTarget ? centerTarget.y : height / 2;

    // Draw links (from parent to child) using adjusted positions
    const treeLinks = g.append("g").attr("class", "tree-links");

    treeLinks
      .selectAll("path")
      .data(root.links())
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", (d: any) => {
        const childData = d.target.data as HierarchyDatum;
        if (childData.edgeType === "ANIMATION") return COLOR_TERTIARY;
        return COLOR_PRIMARY;
      })
      .attr("stroke-width", 1.5)
      .attr("opacity", 1)
      .attr("d", (d: any) => {
        const sourcePos = targetPositions.get(d.source.data.id);
        const targetPos = targetPositions.get(d.target.data.id);
        const sx = sourcePos!.x;
        const sy = sourcePos!.y;
        const tx = targetPos!.x;
        const ty = targetPos!.y;
        const midX = (sx + tx) / 2;
        return `M${sx},${sy}C${midX},${sy} ${midX},${ty} ${tx},${ty}`;
      })
      .attr("data-source-id", (d: any) => d.source.data.id)
      .attr("data-target-id", (d: any) => d.target.data.id)
      .attr("data-edge-type", (d: any) => {
        const childData = d.target.data as HierarchyDatum;
        return childData.edgeType || "LOGISTICS";
      });

    // Draw link midpoint badges using adjusted positions
    const linkBadges = g.append("g").attr("class", "link-badges");

    root.links().forEach((link: any) => {
      const childData = link.target.data as HierarchyDatum;
      // Skip branches (Animation/Logistique) — only show badges on leaf links
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

    // Draw nodes
    const nodeGroups = g
      .append("g")
      .attr("class", "tree-nodes")
      .selectAll("g")
      .data(allNodes)
      .enter()
      .append("g")
      .attr("data-node-id", (d: any) => d.data.id)
      .attr("data-real-id", (d: any) => d.data.realId || null)
      .attr("transform", (d: any) => {
        const saved =
          this.savedPositions.get(d.data.id) ||
          (d.data.realId ? this.savedPositions.get(d.data.realId) : null);
        if (saved) return `translate(${saved.x},${saved.y})`;
        const target = targetPositions.get(d.data.id);
        return target
          ? `translate(${target.x},${target.y})`
          : `translate(${defaultX},${defaultY})`;
      })
      .attr("cursor", "pointer");

    // Style each node based on its role
    const self = this;
    nodeGroups.each(function (d: any) {
      const data = d.data as HierarchyDatum;
      const g = select(this);

      // Branch nodes (Animation/Logistique/R1-Logistique/R2-Logistique labels)
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
        const width = isLogisticsMain ? 100 : 60;
        const height = isLogisticsMain ? 28 : 22;
        const fontSize = isLogisticsMain ? "11px" : "10px";
        const fontWeight = isLogisticsMain ? "600" : "700";

        g.append("rect")
          .attr("rx", 6)
          .attr("ry", 6)
          .attr("width", width)
          .attr("height", height)
          .attr("x", -width / 2)
          .attr("y", -height / 2)
          .attr("fill", "white");

        g.append("rect")
          .attr("rx", 6)
          .attr("ry", 6)
          .attr("width", width)
          .attr("height", height)
          .attr("x", -width / 2)
          .attr("y", -height / 2)
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
        const isCollapsed = self.collapsedBranches.has(data.id);
        const indicatorSymbol = isCollapsed ? "\u25B6" : "\u25BC";
        g.append("circle")
          .attr("cx", width / 2 + 10)
          .attr("cy", 0)
          .attr("r", 8)
          .attr("fill", "white")
          .attr("stroke", color)
          .attr("stroke-width", 1.5);

        g.append("text")
          .attr("x", width / 2 + 10)
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

      g.append("text")
        .text(data.label)
        .attr("dy", "0.35em")
        .attr("text-anchor", "start")
        .attr("x", radius + 8)
        .attr("font-size", "12px")
        .attr("font-weight", "500")
        .attr("fill", COLOR_ON_SECONDARY_CONTAINER);

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
      }
    });

    // ── Hover interactions ──
    const tooltipGroup = g.append("g").attr("class", "link-labels");
    this.addHierarchyHoverInteractions(
      nodeGroups,
      treeLinks.selectAll("path"),
      linkBadges,
      this.graphData.center.id,
      root,
      tooltipGroup,
      targetPositions,
    );

    // ── Click handlers: R1/R2 selection + branch collapse/expand ──
    nodeGroups.on("click", (_event: MouseEvent, d: any) => {
      const data = d.data as HierarchyDatum;
      if (
        data.id === "__animation__" ||
        data.id === "__logistics__" ||
        data.id === "__logistics_r1__" ||
        data.id === "__logistics_r2__"
      ) {
        // Branch node → toggle collapse/expand
        if (this.collapsedBranches.has(data.id)) {
          this.collapsedBranches.delete(data.id);
        } else {
          this.collapsedBranches.add(data.id);
        }
        this.saveNodePositions();
        this.stopSimulation();
        this.renderGraph();
      } else if (data.type === "R1" || data.type === "R2") {
        // R1/R2 leaf node → toggle selection using realId
        const selectId = data.realId || data.id;
        this.selectedNodeId =
          this.selectedNodeId === selectId ? null : selectId;
        this.applyNodeSelection();
      }
    });

    // ── Simulation ──
    // Build leafNodeIds using composite IDs from the tree hierarchy,
    // since node groups use composite IDs as data-node-id.
    const leafNodeIds = new Set<string>();
    // Also build a mapping from composite ID to real ID for drag/simulation
    const compositeToRealId = new Map<string, string>();
    allNodes.forEach((d: any) => {
      const data = d.data as HierarchyDatum;
      // Only leaf nodes (R1/R2) that are not the center
      if (
        (data.type === "R1" || data.type === "R2") &&
        data.id !== this.graphData!.center.id &&
        data.realId // only actual leaf nodes, not grouping branches
      ) {
        leafNodeIds.add(data.id);
        compositeToRealId.set(data.id, data.realId);
      }
    });

    const simNodes: SimNode[] = [];
    const simNodeMap = new Map<string, SimNode>();

    // Center node (pinned)
    const centerSimNode: SimNode = {
      id: this.graphData!.center.id,
      label: this.graphData!.center.label,
      type: this.graphData!.center.type,
    };
    const centerSimTarget = targetPositions.get(this.graphData!.center.id);
    const savedCenterPos = this.savedPositions.get(this.graphData!.center.id);
    centerSimNode.fx = centerSimTarget ? centerSimTarget.x : width / 2;
    centerSimNode.fy = centerSimTarget ? centerSimTarget.y : height / 2;
    centerSimNode.x = savedCenterPos ? savedCenterPos.x : centerSimNode.fx;
    centerSimNode.y = savedCenterPos ? savedCenterPos.y : centerSimNode.fy;
    simNodes.push(centerSimNode);
    simNodeMap.set(centerSimNode.id, centerSimNode);

    // Build parent map for badge updates (needed before leaf node initialization)
    const parentMap = new Map<string, string>();
    root.links().forEach((link: any) => {
      parentMap.set(link.target.data.id, link.source.data.id);
    });

    // Leaf nodes (draggable) — use composite IDs from the tree hierarchy
    for (const compositeId of leafNodeIds) {
      const realId = compositeToRealId.get(compositeId)!;
      const node = this.graphData!.nodes.find((n) => n.id === realId);
      if (!node) continue;
      const simNode: SimNode = {
        id: compositeId,
        label: node.label,
        type: node.type,
        sigmpr: node.sigmpr,
      };
      const target = targetPositions.get(compositeId);
      const saved = this.savedPositions.get(compositeId);
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

    // Position lookup: simulation nodes > target positions
    const getPosition = (id: string): { x: number; y: number } => {
      const sn = simNodeMap.get(id);
      if (sn && sn.x !== undefined && sn.y !== undefined) {
        return { x: sn.x, y: sn.y };
      }
      const t = targetPositions.get(id);
      if (t) return t;
      return { x: width / 2, y: height / 2 };
    };

    // Drag behavior on leaf nodes only
    const leafNodeGroups = nodeGroups.filter((d: any) =>
      leafNodeIds.has(d.data.id),
    );

    const svgEl = this.svg!.node()!;

    leafNodeGroups.call(
      drag<SVGGElement, any>()
        .container(svgEl)
        .on("start", (event: any, d: any) => {
          const sn = simNodeMap.get(d.data.id);
          if (!sn) return;
          if (!event.active) this.simulation?.alphaTarget(0.3).restart();
          sn.fx = sn.x;
          sn.fy = sn.y;
        })
        .on("drag", (event: any, d: any) => {
          const sn = simNodeMap.get(d.data.id);
          if (!sn) return;
          const [mx, my] = pointer(event, svgEl);
          sn.fx = mx;
          sn.fy = my;
        })
        .on("end", (event: any, d: any) => {
          const sn = simNodeMap.get(d.data.id);
          if (!sn) return;
          if (!event.active) this.simulation?.alphaTarget(0);
          sn.fx = null;
          sn.fy = null;
        }),
    );

    // Force simulation
    this.simulation = forceSimulation<SimNode>(simNodes)
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
      .force("collide", forceCollide().radius(30).strength(0.3))
      .on("tick", () => {
        // Update node positions
        nodeGroups.attr("transform", (d: any) => {
          const pos = getPosition(d.data.id);
          return `translate(${pos.x},${pos.y})`;
        });

        // Update link paths
        treeLinks.selectAll("path").attr("d", (d: any) => {
          const sourcePos = getPosition(d.source.data.id);
          const targetPos = getPosition(d.target.data.id);
          const sx = sourcePos.x;
          const sy = sourcePos.y;
          const tx = targetPos.x;
          const ty = targetPos.y;
          const midX = (sx + tx) / 2;
          return `M${sx},${sy}C${midX},${sy} ${midX},${ty} ${tx},${ty}`;
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

    this.setupAutoZoomAndResize(
      svg,
      g,
      this.zoomBehavior!,
      containerEl,
      centerSimNode,
      true,
      false,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // DENDROGRAM LAYOUT (vertical, leaves at top, root at bottom)
  // ═══════════════════════════════════════════════════════════════════

  private renderDendrogramLayout(): void {
    if (!this.graphData) return;

    const containerEl = this.container.nativeElement;
    const width = containerEl.clientWidth;
    const height = containerEl.clientHeight;

    // Use persistent SVG
    const svg = this.svg!;
    const g = this.g!;

    // Build hierarchy
    const hierarchyData = this.buildHierarchy();
    const root = hierarchy(hierarchyData);

    // Apply collapsed state to branch nodes
    root.each((node: any) => {
      if (this.collapsedBranches.has(node.data.id) && node.children) {
        (node as any)._children = node.children;
        node.children = null;
      }
    });

    // Compute cluster layout — vertical orientation (top to bottom)
    // cluster() aligns all leaves at the same depth
    const clusterLayout = cluster<HierarchyDatum>()
      .size([width - 300, height - 80])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.5));

    clusterLayout(root);

    const allNodes = root.descendants();

    // Visible node IDs (for filtering collapsed nodes)
    const visibleIds = new Set(allNodes.map((d: any) => d.data.id));

    // Compute target positions for each node
    // cluster gives: d.x = horizontal spread, d.y = depth (0 = root)
    // We want: root at bottom, leaves at top
    // So we flip vertically: y = height - d.y - offset
    const targetPositions = new Map<string, { x: number; y: number }>();
    allNodes.forEach((d: any) => {
      targetPositions.set(d.data.id, {
        x: d.x + 150,
        y: height - d.y - 40,
      });
    });

    // Build parent position map for newly expanded nodes
    const parentPositions = new Map<string, { x: number; y: number }>();
    allNodes.forEach((d: any) => {
      if (d.parent) {
        const parentPos = targetPositions.get(d.parent.data.id);
        if (parentPos) {
          parentPositions.set(d.data.id, parentPos);
        }
      }
    });

    // Get center position for default transitions
    const centerTarget = targetPositions.get(this.graphData.center.id);
    const defaultX = centerTarget ? centerTarget.x : width / 2;
    const defaultY = centerTarget ? centerTarget.y : height / 2;

    // Draw links (from parent to child) using vertical cubic bezier
    const treeLinks = g.append("g").attr("class", "tree-links");

    treeLinks
      .selectAll("path")
      .data(root.links())
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", (d: any) => {
        const childData = d.target.data as HierarchyDatum;
        if (childData.edgeType === "ANIMATION") return COLOR_TERTIARY;
        return COLOR_PRIMARY;
      })
      .attr("stroke-width", 1.5)
      .attr("opacity", 1)
      .attr("d", (d: any) => {
        const sourcePos = targetPositions.get(d.source.data.id);
        const targetPos = targetPositions.get(d.target.data.id);
        const sx = sourcePos!.x;
        const sy = sourcePos!.y;
        const tx = targetPos!.x;
        const ty = targetPos!.y;
        const midY = (sy + ty) / 2;
        return `M${sx},${sy}C${sx},${midY} ${tx},${midY} ${tx},${ty}`;
      })
      .attr("data-source-id", (d: any) => d.source.data.id)
      .attr("data-target-id", (d: any) => d.target.data.id)
      .attr("data-edge-type", (d: any) => {
        const childData = d.target.data as HierarchyDatum;
        return childData.edgeType || "LOGISTICS";
      });

    // Draw link midpoint badges
    const linkBadges = g.append("g").attr("class", "link-badges");

    root.links().forEach((link: any) => {
      const childData = link.target.data as HierarchyDatum;
      // Skip branches (Animation/Logistique) — only show badges on leaf links
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

    // Draw nodes
    const nodeGroups = g
      .append("g")
      .attr("class", "tree-nodes")
      .selectAll("g")
      .data(allNodes)
      .enter()
      .append("g")
      .attr("data-node-id", (d: any) => d.data.id)
      .attr("data-real-id", (d: any) => d.data.realId || null)
      .attr("transform", (d: any) => {
        const saved =
          this.savedPositions.get(d.data.id) ||
          (d.data.realId ? this.savedPositions.get(d.data.realId) : null);
        if (saved) return `translate(${saved.x},${saved.y})`;
        const target = targetPositions.get(d.data.id);
        return target
          ? `translate(${target.x},${target.y})`
          : `translate(${defaultX},${defaultY})`;
      })
      .attr("cursor", "pointer");

    // Style each node based on its role
    const self = this;
    nodeGroups.each(function (d: any) {
      const data = d.data as HierarchyDatum;
      const g = select(this);

      // Branch nodes (Animation/Logistique/R1-Logistique/R2-Logistique labels)
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
        const width = isLogisticsMain ? 100 : 60;
        const height = isLogisticsMain ? 28 : 22;
        const fontSize = isLogisticsMain ? "11px" : "10px";
        const fontWeight = isLogisticsMain ? "600" : "700";

        g.append("rect")
          .attr("rx", 6)
          .attr("ry", 6)
          .attr("width", width)
          .attr("height", height)
          .attr("x", -width / 2)
          .attr("y", -height / 2)
          .attr("fill", "white");

        g.append("rect")
          .attr("rx", 6)
          .attr("ry", 6)
          .attr("width", width)
          .attr("height", height)
          .attr("x", -width / 2)
          .attr("y", -height / 2)
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

        // Collapse/expand indicator — positioned below the rectangle
        const isCollapsed = self.collapsedBranches.has(data.id);
        const indicatorSymbol = isCollapsed ? "\u25B6" : "\u25BC";
        g.append("circle")
          .attr("cx", 0)
          .attr("cy", height / 2 + 10)
          .attr("r", 8)
          .attr("fill", "white")
          .attr("stroke", color)
          .attr("stroke-width", 1.5);

        g.append("text")
          .attr("x", 0)
          .attr("y", height / 2 + 10)
          .attr("dy", "0.35em")
          .attr("text-anchor", "middle")
          .attr("font-size", "9px")
          .attr("font-weight", "700")
          .attr("fill", color)
          .text(indicatorSymbol);

        g.style("cursor", "pointer");

        return;
      }

      // Root node (SITE R3) — at the bottom
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

      // Leaf nodes (R1/R2) — at the top
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

      // Label below the circle in dendrogram (vertical layout)
      g.append("text")
        .text(data.label)
        .attr("dy", radius + 16)
        .attr("text-anchor", "middle")
        .attr("font-size", "11px")
        .attr("font-weight", "500")
        .attr("fill", COLOR_ON_SECONDARY_CONTAINER);

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
    });

    // ── Hover interactions ──
    const tooltipGroup = g.append("g").attr("class", "link-labels");
    this.addHierarchyHoverInteractions(
      nodeGroups,
      treeLinks.selectAll("path"),
      linkBadges,
      this.graphData.center.id,
      root,
      tooltipGroup,
      targetPositions,
    );

    // ── Click handlers: R1/R2 selection + branch collapse/expand ──
    nodeGroups.on("click", (_event: MouseEvent, d: any) => {
      const data = d.data as HierarchyDatum;
      if (
        data.id === "__animation__" ||
        data.id === "__logistics__" ||
        data.id === "__logistics_r1__" ||
        data.id === "__logistics_r2__"
      ) {
        // Branch node → toggle collapse/expand
        if (this.collapsedBranches.has(data.id)) {
          this.collapsedBranches.delete(data.id);
        } else {
          this.collapsedBranches.add(data.id);
        }
        this.saveNodePositions();
        this.stopSimulation();
        this.renderGraph();
      } else if (data.type === "R1" || data.type === "R2") {
        // R1/R2 leaf node → toggle selection using realId
        const selectId = data.realId || data.id;
        this.selectedNodeId =
          this.selectedNodeId === selectId ? null : selectId;
        this.applyNodeSelection();
      }
    });

    // ── Simulation ──
    const leafNodeIds = new Set<string>();
    const compositeToRealId = new Map<string, string>();
    allNodes.forEach((d: any) => {
      const data = d.data as HierarchyDatum;
      if (
        (data.type === "R1" || data.type === "R2") &&
        data.id !== this.graphData!.center.id &&
        data.realId
      ) {
        leafNodeIds.add(data.id);
        compositeToRealId.set(data.id, data.realId);
      }
    });

    const simNodes: SimNode[] = [];
    const simNodeMap = new Map<string, SimNode>();

    // Center node (pinned)
    const centerSimNode: SimNode = {
      id: this.graphData!.center.id,
      label: this.graphData!.center.label,
      type: this.graphData!.center.type,
    };
    const centerSimTarget = targetPositions.get(this.graphData.center.id);
    const savedCenterPos = this.savedPositions.get(this.graphData.center.id);
    centerSimNode.fx = centerSimTarget ? centerSimTarget.x : width / 2;
    centerSimNode.fy = centerSimTarget ? centerSimTarget.y : height / 2;
    centerSimNode.x = savedCenterPos ? savedCenterPos.x : centerSimNode.fx;
    centerSimNode.y = savedCenterPos ? savedCenterPos.y : centerSimNode.fy;
    simNodes.push(centerSimNode);
    simNodeMap.set(centerSimNode.id, centerSimNode);

    // Leaf nodes (draggable)
    for (const compositeId of leafNodeIds) {
      const realId = compositeToRealId.get(compositeId)!;
      const node = this.graphData!.nodes.find((n) => n.id === realId);
      if (!node) continue;
      const simNode: SimNode = {
        id: compositeId,
        label: node.label,
        type: node.type as NodeType,
        sigmpr: node.sigmpr,
      };
      const target = targetPositions.get(compositeId);
      const saved =
        this.savedPositions.get(compositeId) || this.savedPositions.get(realId);
      const parentPos = parentPositions.get(compositeId);
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

    // Build parent map for badge updates
    const parentMap = new Map<string, string>();
    root.links().forEach((link: any) => {
      parentMap.set(link.target.data.id, link.source.data.id);
    });

    // Position lookup: simulation nodes > target positions
    const getPosition = (id: string): { x: number; y: number } => {
      const sn = simNodeMap.get(id);
      if (sn && sn.x !== undefined && sn.y !== undefined) {
        return { x: sn.x, y: sn.y };
      }
      const t = targetPositions.get(id);
      if (t) return t;
      return { x: width / 2, y: height / 2 };
    };

    // Drag behavior on leaf nodes only
    const leafNodeGroups = nodeGroups.filter((d: any) =>
      leafNodeIds.has(d.data.id),
    );

    const svgEl = this.svg!.node()!;

    leafNodeGroups.call(
      drag<SVGGElement, any>()
        .container(svgEl)
        .on("start", (event: any, d: any) => {
          const sn = simNodeMap.get(d.data.id);
          if (!sn) return;
          if (!event.active) this.simulation?.alphaTarget(0.3).restart();
          sn.fx = sn.x;
          sn.fy = sn.y;
        })
        .on("drag", (event: any, d: any) => {
          const sn = simNodeMap.get(d.data.id);
          if (!sn) return;
          const [mx, my] = pointer(event, svgEl);
          sn.fx = mx;
          sn.fy = my;
        })
        .on("end", (event: any, d: any) => {
          const sn = simNodeMap.get(d.data.id);
          if (!sn) return;
          if (!event.active) this.simulation?.alphaTarget(0);
          sn.fx = null;
          sn.fy = null;
        }),
    );

    // Force simulation
    this.simulation = forceSimulation<SimNode>(simNodes)
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
      .force("collide", forceCollide().radius(30).strength(0.3))
      .on("tick", () => {
        // Update node positions
        nodeGroups.attr("transform", (d: any) => {
          const pos = getPosition(d.data.id);
          return `translate(${pos.x},${pos.y})`;
        });

        // Update link paths — vertical bezier curves
        treeLinks.selectAll("path").attr("d", (d: any) => {
          const sourcePos = getPosition(d.source.data.id);
          const targetPos = getPosition(d.target.data.id);
          const sx = sourcePos.x;
          const sy = sourcePos.y;
          const tx = targetPos.x;
          const ty = targetPos.y;
          const midY = (sy + ty) / 2;
          return `M${sx},${sy}C${sx},${midY} ${tx},${midY} ${tx},${ty}`;
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

    this.setupAutoZoomAndResize(
      svg,
      g,
      this.zoomBehavior!,
      containerEl,
      centerSimNode,
      true,
      false,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // SHARED HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private addArrowMarkers(
    defs: Selection<SVGDefsElement, unknown, null, undefined>,
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
      .attr("fill", COLOR_TERTIARY);

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
      .attr("fill", COLOR_PRIMARY);

    // Reversed arrow for logistics: points opposite to path direction (towards source)
    defs
      .append("marker")
      .attr("id", "arrow-logistics-rev")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 2)
      .attr("refY", 0)
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M8,-4L0,0L8,4")
      .attr("fill", COLOR_PRIMARY);

    // ── Electric glow filter for selection animation ──
    // Wide blur = visible "wire" underneath, narrow blur = close glow, original = "current pulses"
    // Use filterUnits=userSpaceOnUse with a large region to avoid clipping the glow
    // on thin paths (objectBoundingBox percentages are relative to the path's bbox,
    // which can be too small for the Gaussian blur on nearly-horizontal/vertical paths).
    defs
      .append("filter")
      .attr("id", "electric-glow")
      .attr("filterUnits", "userSpaceOnUse")
      .attr("x", "-5000")
      .attr("y", "-5000")
      .attr("width", "10000")
      .attr("height", "10000")
      .call((f) => {
        f.append("feGaussianBlur")
          .attr("in", "SourceGraphic")
          .attr("stdDeviation", 5)
          .attr("result", "wire");
        f.append("feComponentTransfer")
          .attr("in", "wire")
          .attr("result", "dimWire")
          .call((ct) =>
            ct.append("feFuncA").attr("type", "linear").attr("slope", 0.35),
          );
        f.append("feGaussianBlur")
          .attr("in", "SourceGraphic")
          .attr("stdDeviation", 1.5)
          .attr("result", "glow");
        f.append("feMerge").call((m) => {
          m.append("feMergeNode").attr("in", "dimWire");
          m.append("feMergeNode").attr("in", "glow");
          m.append("feMergeNode").attr("in", "SourceGraphic");
        });
      });
  }

  private drawNodeCircles(
    selection: Selection<SVGGElement, any, any, any>,
    isCenter: boolean,
    centerNode?: SimNode,
  ): void {
    const nodeData = isCenter && centerNode ? [centerNode] : undefined;

    if (isCenter) {
      selection
        .append("circle")
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
        .attr("r", (d: SimNode) => NODE_RADIUS[d.type] + 4)
        .attr("fill", "none")
        .attr("stroke", (d: SimNode) => NODE_STROKE_COLORS[d.type])
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.4);

      selection
        .append("circle")
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

      r1WithSigmpr.each(function (d: SimNode, i: number) {
        if (!d.sigmpr) return;
        const textEl = sigmprTextEls.nodes()[i] as SVGTextElement;
        if (textEl) {
          const bbox = textEl.getBBox();
          select(this)
            .selectAll("rect")
            .attr("x", bbox.x - 3)
            .attr("y", bbox.y - 1.5)
            .attr("width", bbox.width + 6)
            .attr("height", bbox.height + 3);
        }
      });
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
      .attr("class", "edge-label")
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

  // ═══════════════════════════════════════════════════════════════════
  // ELECTRIC CURRENT ANIMATION
  // ═══════════════════════════════════════════════════════════════════

  private startElectricAnimation(): void {
    this.stopElectricAnimation();
    if (!this.g) return;

    const animatedPaths = this.g
      .selectAll(".edges path, .tree-links path")
      .filter(function () {
        return select(this).classed("electric-current");
      });

    if (animatedPaths.empty()) return;

    // Apply dasharray and glow filter directly (D3 bypasses Angular encapsulation)
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
      // Throttle: skip frames to maintain ~30 fps
      if (elapsed - lastTick < frameMs) return;
      lastTick = elapsed;

      // Dash flow: increasing dashoffset => dashes move from start (R3) to end (target)
      const dashOffset = ((elapsed / flowMs) * period) % period;

      // Color wave: use pre-computed color array instead of interpolateRgb per frame
      const colorPhase = (elapsed % colorMs) / colorMs;
      const colorT = 0.5 - 0.5 * Math.cos(2 * Math.PI * colorPhase);
      const colorIndex = Math.round(colorT * (colorCount - 1));
      const color = colors[colorIndex];

      // Opacity wave: 1.0 ↔ 0.7 (brighter when Electric, dimmer when Tertiary)
      const strokeOpacity = 1 - 0.3 * colorT;

      animatedPaths
        .attr("stroke-dashoffset", dashOffset)
        .attr("stroke", color)
        .attr("stroke-opacity", strokeOpacity);
    });
  }

  private stopElectricAnimation(): void {
    if (this.selectionAnimTimer) {
      this.selectionAnimTimer.stop();
      this.selectionAnimTimer = null;
    }
    if (!this.g) return;

    // Remove all electric animation attributes from link paths
    this.g
      .selectAll(".edges path, .tree-links path")
      .attr("stroke-dasharray", null)
      .attr("stroke-dashoffset", null)
      .attr("stroke-linecap", null)
      .attr("filter", null)
      .attr("stroke-opacity", null);
  }

  private applyNodeSelection(): void {
    if (!this.g || !this.graphData) return;

    const self = this;
    const g = this.g;
    const allNodes = g.selectAll("[data-node-id]");

    const t = this.SELECTION_TRANSITION_MS;

    if (!this.selectedNodeId) {
      // Stop electric current animation and clean up attributes
      this.stopElectricAnimation();

      // Reset all opacity to 1 with transition
      allNodes.interrupt().transition().duration(t).attr("opacity", 1);
      g.selectAll(".link-badges g, .edge-labels g")
        .interrupt()
        .transition()
        .duration(t)
        .attr("opacity", 1);

      // Reset link opacity AND stroke colors in a single transition per element
      // Also stop electric current animation
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
        const isCenter = nodeId === self.graphData!.center.id;
        if (isCenter) return;

        // For tree mode leaf nodes, resolve realId for nodeType lookup
        const realId = nodeGroup.attr("data-real-id") || nodeId;
        const nodeType = self.graphData!.nodes.find(
          (n) => n.id === realId,
        )?.type;

        // Branch grouping nodes (__animation__, __logistics__, __logistics_r1__, __logistics_r2__)
        // don't exist in graphData.nodes — skip circle color reset for them.
        // Their rect colors are reset separately below.
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

    const selectedId = this.selectedNodeId;
    const centerId = this.graphData.center.id;

    // highlighted set: used to determine which branch grouping nodes to style
    // in tree mode. In force mode, there are no branch nodes, so it stays empty.
    let highlighted = new Set<string>();

    // Helper: determine if a link/badge is connected to the selected node
    const isConnected = (
      sourceId: string | null,
      targetId: string | null,
    ): boolean =>
      !!sourceId &&
      !!targetId &&
      (sourceId === selectedId || targetId === selectedId);

    if (this.layoutMode === "tree" || this.layoutMode === "dendrogram") {
      // Hierarchy modes: highlight ancestors + descendants
      const hierarchyData = this.buildHierarchy();
      const root = hierarchy(hierarchyData);

      // Apply collapsed state
      root.each((node: any) => {
        if (this.collapsedBranches.has(node.data.id) && node.children) {
          (node as any)._children = node.children;
          node.children = null;
        }
      });

      // Build ancestor and descendant maps
      // NOTE: a node id may appear multiple times in the hierarchy (e.g. r1-6
      // under both Animation and Logistics branches). We MERGE ancestors/descendants
      // so all paths to the node are highlighted.
      const ancestorMap = new Map<string, Set<string>>();
      const descendantMap = new Map<string, Set<string>>();
      root.descendants().forEach((d: any) => {
        const id = d.data.id;

        const ancestorIds = new Set<string>();
        d.ancestors().forEach((a: any) => ancestorIds.add(a.data.id));
        const existingAncestors = ancestorMap.get(id);
        if (existingAncestors) {
          ancestorIds.forEach((a) => existingAncestors.add(a));
        } else {
          ancestorMap.set(id, ancestorIds);
        }

        const descendantIds = new Set<string>();
        d.descendants().forEach((a: any) => descendantIds.add(a.data.id));
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
      root.descendants().forEach((d: any) => {
        const data = d.data as HierarchyDatum;
        if ((data.realId || data.id) === selectedId) {
          const a = ancestorMap.get(d.data.id);
          const desc = descendantMap.get(d.data.id);
          if (a) a.forEach((x) => ancestors.add(x));
          if (desc) desc.forEach((x) => descendants.add(x));
        }
      });
      let highlightedTree = new Set([...ancestors, ...descendants]);

      // With composite IDs (e.g. "r1-6___ANIMATION"), the selectedId ("r1-6") won't
      // match directly. Find all nodes whose realId or id matches and merge their paths.
      root.descendants().forEach((d: any) => {
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
          // CSS animation handles stroke color + dasharray flow
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
        // Only highlight badges whose target is a leaf in the selected path
        const isOnSelectedPath =
          connected && (ancestors.has(targetId) || descendants.has(targetId));
        badgeG
          .interrupt()
          .transition()
          .duration(t)
          .attr("opacity", connected ? 1 : 0.12);
        if (isOnSelectedPath) {
          // Electric colors for badges on the selected path
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
      this.graphData.edges.forEach((edge) => {
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
          // CSS animation handles stroke color + dasharray flow
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
          // Electric colors for connected labels
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

      // For tree mode leaf nodes, resolve realId for isSelected and nodeType lookups
      const realId = nodeGroup.attr("data-real-id") || nodeId;
      const isSelected = realId === selectedId;
      const isCenter = nodeId === centerId;

      // Branch grouping nodes
      const isBranch =
        nodeId === "__animation__" ||
        nodeId === "__logistics__" ||
        nodeId === "__logistics_r1__" ||
        nodeId === "__logistics_r2__";

      // Style branch grouping nodes when on the highlighted path
      if (isBranch) {
        const onPath = highlighted.has(nodeId);
        const branchColor =
          nodeId === "__animation__" ? COLOR_TERTIARY : COLOR_PRIMARY;
        if (onPath) {
          // Electric colors for branch nodes on the selected path
          // Make background rect transparent so electric current on links is visible through it
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
          // Reset to default colors
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
        // Selected R1/R2: use Electric colors with transition
        innerCircle
          .interrupt()
          .transition()
          .duration(t)
          .attr("fill", COLOR_ELECTRIC_CONTAINER)
          .attr("stroke", COLOR_ELECTRIC);
        // Also update outer circle with transition
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
        // Reset to default container colors with transition
        const nodeType = self.graphData!.nodes.find(
          (n) => n.id === realId,
        )?.type;
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
    this.startElectricAnimation();
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

        // Interrupt any ongoing selection transitions before applying hover
        neighborNodes.interrupt();
        edgePaths.interrupt();
        edgeLabels.interrupt();
        if (centerNodeEl) centerNodeEl.interrupt();

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
        if (this.selectedNodeId) {
          this.applyNodeSelection();
        } else {
          // Interrupt any transitions before resetting
          neighborNodes.interrupt();
          edgePaths.interrupt();
          edgeLabels.interrupt();
          if (centerNodeEl) centerNodeEl.interrupt();

          neighborNodes.attr("opacity", 1);
          if (centerNodeEl) centerNodeEl.attr("opacity", 1);
          edgePaths.attr("opacity", 1);
          edgeLabels.attr("opacity", 1);
        }
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

        // Interrupt any ongoing selection transitions before applying hover
        neighborNodes.interrupt();
        edgePaths.interrupt();
        edgeLabels.interrupt();
        centerNodeEl.interrupt();

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
        if (this.selectedNodeId) {
          this.applyNodeSelection();
        } else {
          // Interrupt any transitions before resetting
          neighborNodes.interrupt();
          edgePaths.interrupt();
          edgeLabels.interrupt();
          centerNodeEl.interrupt();

          neighborNodes.attr("opacity", 1);
          centerNodeEl.attr("opacity", 1);
          edgePaths.attr("opacity", 1);
          edgeLabels.attr("opacity", 1);
        }
      });
  }

  private addHierarchyHoverInteractions(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodeGroups: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    linkPathSelection: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    badgeGroup: any,
    centerId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hierarchyRoot: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tooltipGroup: any,
    targetPositions: Map<string, { x: number; y: number }>,
  ): void {
    // Build ancestor and descendant maps for hover highlighting
    // NOTE: merge duplicates so nodes appearing under multiple branches
    // (e.g. r1-6 under Animation + Logistics) have all paths highlighted.
    const ancestorMap = new Map<string, Set<string>>();
    const descendantMap = new Map<string, Set<string>>();
    hierarchyRoot.descendants().forEach((d: any) => {
      const id = d.data.id;

      const ancestorIds = new Set<string>();
      d.ancestors().forEach((a: any) => ancestorIds.add(a.data.id));
      const existingAncestors = ancestorMap.get(id);
      if (existingAncestors) {
        ancestorIds.forEach((a) => existingAncestors.add(a));
      } else {
        ancestorMap.set(id, ancestorIds);
      }

      const descendantIds = new Set<string>();
      d.descendants().forEach((a: any) => descendantIds.add(a.data.id));
      const existingDescendants = descendantMap.get(id);
      if (existingDescendants) {
        descendantIds.forEach((a) => existingDescendants.add(a));
      } else {
        descendantMap.set(id, descendantIds);
      }
    });

    // Node hover: highlight chain to root and subtree
    nodeGroups
      .on("mouseenter", (_event: MouseEvent, d: any) => {
        const nodeId = d.data.id;

        // Interrupt any ongoing selection transitions before applying hover
        nodeGroups.interrupt();
        linkPathSelection.interrupt();
        badgeGroup.selectAll("g").interrupt();

        if (nodeId === centerId) {
          // Center node: fade all neighbors, highlight all edges
          nodeGroups.attr("opacity", (n: any) =>
            n.data.id === centerId ? 1 : 0.25,
          );
          linkPathSelection.attr("opacity", 1);
          badgeGroup.selectAll("g").attr("opacity", 1);
        } else {
          // Other node: highlight ancestors + descendants chain
          const ancestors = ancestorMap.get(nodeId) || new Set<string>();
          const descendants = descendantMap.get(nodeId) || new Set<string>();
          const highlighted = new Set([...ancestors, ...descendants]);

          nodeGroups.attr("opacity", (n: any) =>
            highlighted.has(n.data.id) ? 1 : 0.25,
          );
          linkPathSelection.attr("opacity", (l: any) => {
            const sourceId = l.source.data.id;
            const targetId = l.target.data.id;
            return highlighted.has(sourceId) && highlighted.has(targetId)
              ? 1
              : 0.12;
          });
          badgeGroup
            .selectAll("g")
            .attr("opacity", function (this: SVGGElement) {
              const targetId = select(this).attr("data-target-id");
              return targetId && highlighted.has(targetId) ? 1 : 0.12;
            });
        }
      })
      .on("mouseleave", () => {
        if (this.selectedNodeId) {
          this.applyNodeSelection();
        } else {
          // Interrupt any transitions before resetting
          nodeGroups.interrupt();
          linkPathSelection.interrupt();
          badgeGroup.selectAll("g").interrupt();

          nodeGroups.attr("opacity", 1);
          linkPathSelection.attr("opacity", 1);
          badgeGroup.selectAll("g").attr("opacity", 1);
        }
      });

    // Edge tooltip on hover
    linkPathSelection
      .on("mouseenter", (_event: MouseEvent, d: any) => {
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
          // Leaf node — show business relationship
          const typeLabel =
            childData.edgeType === "ANIMATION"
              ? "Animation (Ventes)"
              : "Logistique";
          if (childData.edgeType === "LOGISTICS") {
            text = `${typeLabel}: ${childData.label} → ${this.graphData!.center.label}`;
          } else {
            text = `${typeLabel}: ${this.graphData!.center.label} → ${childData.label}`;
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
    const offset = GraphComponent.getLinkOffsetStatic(
      d,
      parallelCounts,
      (d as any)._parallelIndex,
    );

    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    // For logistics: arrow points towards source (SITE), so shorten at source end
    // For animation: arrow points towards target (R1), so shorten at target end
    const isLogistics = d.edgeType === "LOGISTICS";

    if (total <= 1) {
      if (isLogistics) {
        // Shorten at source end for reversed arrow
        const sr = NODE_RADIUS[src.type] || 22;
        const startX = sx + (dx / len) * sr;
        const startY = sy + (dy / len) * sr;
        // Shorten at target end so the path doesn't go behind the target circle
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
      // Shorten at source end for reversed arrow
      const sr = NODE_RADIUS[src.type] || 22;
      const sdx = cx - sx;
      const sdy = cy - sy;
      const slen = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
      const startX = sx + (sdx / slen) * sr;
      const startY = sy + (sdy / slen) * sr;
      // Shorten at target end so the path doesn't go behind the target circle
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

  private updateEdgeLabelsForce(
    edgeLabels: Selection<SVGGElement, SimLink, SVGGElement, unknown>,
    simLinks: SimLink[],
    parallelCounts: Map<string, number>,
  ): void {
    const selectedId = this.selectedNodeId;
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

      const el = select(this);
      const textEl = el
        .select("text:not(.label-dmsid)")
        .node() as SVGTextElement;

      el.select("text:not(.label-dmsid)").attr("x", mx).attr("y", my);
      el.select(".label-dmsid").attr("x", mx).attr("y", my);

      if (textEl) {
        const bbox = textEl.getBBox();
        el.selectAll("rect")
          .attr("x", String(bbox.x - 4))
          .attr("y", String(bbox.y - 2))
          .attr("width", String(bbox.width + 8))
          .attr("height", String(bbox.height + 4));
      } else {
        el.selectAll("rect").attr("x", mx).attr("y", my);
      }

      const color = d.edgeType === "ANIMATION" ? COLOR_TERTIARY : COLOR_PRIMARY;

      // If a node is selected, use Electric color for connected edges
      if (selectedId) {
        const isSelectedEdge =
          d.sourceId === selectedId || d.targetId === selectedId;
        if (isSelectedEdge) {
          // White background rect (first)
          el.select("rect:first-of-type").attr("fill", "white");

          // Colored overlay rect (second / label-bg) — Electric
          el.select(".label-bg")
            .attr("fill", COLOR_ELECTRIC)
            .attr("fill-opacity", "0.15")
            .attr("stroke", COLOR_ELECTRIC)
            .attr("stroke-width", "1.5");
          el.selectAll("text").attr("fill", COLOR_ELECTRIC);
          return;
        }
      }

      // White background rect (first)
      el.select("rect:first-of-type").attr("fill", "white");

      // Colored overlay rect (second / label-bg)
      el.select(".label-bg")
        .attr("fill", color)
        .attr("fill-opacity", "0.15")
        .attr("stroke", color)
        .attr("stroke-width", "1.5");
    });
  }

  private setupAutoZoomAndResize(
    svg: Selection<SVGSVGElement, unknown, null, undefined>,
    g: Selection<SVGGElement, unknown, null, undefined>,
    zoom: ZoomBehavior<SVGSVGElement, unknown>,
    containerEl: HTMLDivElement,
    centerNode: SimNode | null,
    useSimulationEnd: boolean,
    recenterOnResize: boolean,
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
          zoomIdentity
            .translate(fullWidth / 2, fullHeight / 2)
            .scale(clampedScale)
            .translate(-bmidX, -bmidY),
        );
    };

    if (useSimulationEnd && this.simulation) {
      this.simulation.on("end", fitZoom);
    } else {
      setTimeout(fitZoom, 100);
    }

    this.resizeObserver = new ResizeObserver(() => {
      const w = containerEl.clientWidth;
      const h = containerEl.clientHeight;
      svg.attr("width", w).attr("height", h);

      if (centerNode && recenterOnResize) {
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
            zoomIdentity
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
