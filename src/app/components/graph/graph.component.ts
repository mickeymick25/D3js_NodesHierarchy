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
import { type Simulation } from "d3-force";
import { hierarchy } from "d3-hierarchy";
import { select, type Selection } from "d3-selection";
import { type ZoomBehavior } from "d3-zoom";

import {
  GraphData,
  LayoutMode,
  SimNode,
  SimLink,
  HierarchyDatum,
} from "../../models/graph.model";
import { SvgBuilderService } from "../../services/svg-builder.service";
import { SelectionService } from "../../services/selection.service";
import { ForceLayoutService } from "../../services/layout/force-layout.service";
import { HierarchyLayoutService } from "../../services/layout/hierarchy-layout.service";
import { TreeLayoutService } from "../../services/layout/tree-layout.service";
import { DendrogramLayoutService } from "../../services/layout/dendrogram-layout.service";

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

  // Persistent SVG state (delegated to SvgBuilderService)
  private get svg(): Selection<SVGSVGElement, unknown, null, undefined> | null {
    return this.svgBuilder.svg;
  }
  private get g(): Selection<SVGGElement, unknown, null, undefined> | null {
    return this.svgBuilder.g;
  }
  private get zoomBehavior(): ZoomBehavior<SVGSVGElement, unknown> | null {
    return this.svgBuilder.zoomBehavior;
  }
  private simulation: Simulation<SimNode, SimLink> | null = null;

  // Saved positions for smooth layout transitions
  private savedPositions = new Map<string, { x: number; y: number }>();

  // Collapsed branches in tree view
  private collapsedBranches = new Set<string>();

  // Selected node (click to select, click again to deselect)
  private selectedNodeId: string | null = null;

  // P7: Cached hierarchy
  private cachedHierarchy: HierarchyDatum | null = null;
  private cachedHierarchyKey: string | null = null;

  constructor(
    private cdr: ChangeDetectorRef,
    private svgBuilder: SvgBuilderService,
    private selectionService: SelectionService,
    private forceLayout: ForceLayoutService,
    private hierarchyLayout: HierarchyLayoutService,
    private treeConfig: TreeLayoutService,
    private dendrogramConfig: DendrogramLayoutService,
  ) {}

  /** Build SelectionContext from current component state */
  private getSelectionContext() {
    return {
      g: this.g!,
      graphData: this.graphData!,
      layoutMode: this.layoutMode,
      selectedNodeId: this.selectedNodeId,
      collapsedBranches: this.collapsedBranches,
      buildHierarchy: () => this.buildHierarchy(),
    };
  }

  private applyNodeSelection(): void {
    if (!this.g || !this.graphData) return;
    this.selectionService.applyNodeSelection(this.getSelectionContext());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.graphData) return;

    this.cdr.markForCheck();

    if (changes["graphData"]) {
      const prevData = changes["graphData"].previousValue as GraphData | null;
      const isSameSite = prevData?.center?.id === this.graphData.center.id;

      if (isSameSite) {
        this.incrementalUpdate();
      } else {
        this.fullRebuild();
      }
    } else if (changes["layoutMode"]) {
      // Layout changed → smooth transition
      this.selectionService.stopElectricAnimation(this.g);
      this.saveNodePositions();
      this.stopSimulation();
      this.renderGraph();
    }

    // SIGMPR search selection/deselection — must run even when graphData changes simultaneously
    if (changes["selectedNodeIdBySearch"]) {
      if (this.selectedNodeIdBySearch) {
        this.selectedNodeId = this.selectedNodeIdBySearch;
        this.applyNodeSelection();
      } else {
        this.selectedNodeId = null;
        this.selectionService.stopElectricAnimation(this.g);
        this.applyNodeSelection();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // P3: Incremental updates (Enter/Update/Exit D3)
  // ═══════════════════════════════════════════════════════════════════

  private fullRebuild(): void {
    this.selectionService.destroy();
    this.svgBuilder.destroySvg(this.container.nativeElement);
    this.savedPositions.clear();
    this.collapsedBranches.clear();
    this.cachedHierarchy = null;
    this.cachedHierarchyKey = null;
    this.selectedNodeId = null;
    this.renderGraph();
    // SIGMPR search selection is handled in ngOnChanges() after this method
  }

  private incrementalUpdate(): void {
    if (!this.graphData || !this.svg || !this.g || !this.zoomBehavior) return;

    this.selectionService.stopElectricAnimation(this.g);
    this.stopSimulation();

    // Invalidate hierarchy cache (data changed)
    this.cachedHierarchy = null;
    this.cachedHierarchyKey = null;

    switch (this.layoutMode) {
      case "force":
        this.updateForceLayout();
        break;
      default:
        // For hierarchy layouts, fall back to full re-render (keeping SVG)
        // P3 incremental update for hierarchy layouts will be added later
        this.saveNodePositions();
        this.g!.selectAll("*").remove();
        this.svg!.select("defs").remove();
        this.svg!.insert("defs", ":first-child").call((d) =>
          this.svgBuilder.addArrowMarkers(d),
        );
        this.renderGraph();
        break;
    }

    if (this.selectedNodeId) {
      this.applyNodeSelection();
    }
  }

  private updateForceLayout(): void {
    if (!this.graphData || !this.svg || !this.g || !this.zoomBehavior) return;

    const result = this.forceLayout.update({
      svg: this.svg,
      g: this.g,
      zoomBehavior: this.zoomBehavior,
      graphData: this.graphData,
      containerEl: this.container.nativeElement,
      savedPositions: this.savedPositions,
      selectedNodeId: this.selectedNodeId,
      onNodeSelect: (nodeId) => {
        this.selectedNodeId = this.selectedNodeId === nodeId ? null : nodeId;
        this.applyNodeSelection();
      },
      onApplyNodeSelection: () => this.applyNodeSelection(),
    });

    if (result) {
      this.simulation = result;
    } else {
      // Fallback to full render
      this.renderGraph();
    }
  }

  ngOnDestroy(): void {
    this.selectionService.destroy();
    this.svgBuilder.destroySvg(this.container.nativeElement);
  }

  private stopSimulation(): void {
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }
    this.svgBuilder.setSimulation(null);
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
      this.svgBuilder.initSvg(this.container.nativeElement);
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
      this.svgBuilder.addArrowMarkers(d),
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
  // FORCE LAYOUT — delegated to ForceLayoutService (P2 Étape 4)
  // ═══════════════════════════════════════════════════════════════════

  private renderForceLayout(): void {
    if (!this.graphData || !this.svg || !this.g || !this.zoomBehavior) return;

    this.simulation = this.forceLayout.render({
      svg: this.svg,
      g: this.g,
      zoomBehavior: this.zoomBehavior,
      graphData: this.graphData,
      containerEl: this.container.nativeElement,
      savedPositions: this.savedPositions,
      selectedNodeId: this.selectedNodeId,
      onNodeSelect: (nodeId) => {
        this.selectedNodeId = this.selectedNodeId === nodeId ? null : nodeId;
        this.applyNodeSelection();
      },
      onApplyNodeSelection: () => this.applyNodeSelection(),
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // HIERARCHY LAYOUTS — delegated to HierarchyLayoutService (P2 Étapes 5+6)
  // ═══════════════════════════════════════════════════════════════════

  private renderTreeLayout(): void {
    if (!this.graphData || !this.svg || !this.g || !this.zoomBehavior) return;

    this.simulation = this.hierarchyLayout.render(
      {
        svg: this.svg,
        g: this.g,
        zoomBehavior: this.zoomBehavior,
        graphData: this.graphData,
        containerEl: this.container.nativeElement,
        savedPositions: this.savedPositions,
        selectedNodeId: this.selectedNodeId,
        collapsedBranches: this.collapsedBranches,
        onNodeSelect: (nodeId) => {
          this.selectedNodeId = this.selectedNodeId === nodeId ? null : nodeId;
          this.applyNodeSelection();
        },
        onApplyNodeSelection: () => this.applyNodeSelection(),
        buildHierarchy: () => this.buildHierarchy(),
        onStopSimulation: () => this.stopSimulation(),
        onRenderGraph: () => {
          this.saveNodePositions();
          this.stopSimulation();
          this.renderGraph();
        },
      },
      this.treeConfig.getConfig(
        this.container.nativeElement.clientWidth,
        this.container.nativeElement.clientHeight,
      ),
    );
  }

  private renderDendrogramLayout(): void {
    if (!this.graphData || !this.svg || !this.g || !this.zoomBehavior) return;

    this.simulation = this.hierarchyLayout.render(
      {
        svg: this.svg,
        g: this.g,
        zoomBehavior: this.zoomBehavior,
        graphData: this.graphData,
        containerEl: this.container.nativeElement,
        savedPositions: this.savedPositions,
        selectedNodeId: this.selectedNodeId,
        collapsedBranches: this.collapsedBranches,
        onNodeSelect: (nodeId) => {
          this.selectedNodeId = this.selectedNodeId === nodeId ? null : nodeId;
          this.applyNodeSelection();
        },
        onApplyNodeSelection: () => this.applyNodeSelection(),
        buildHierarchy: () => this.buildHierarchy(),
        onStopSimulation: () => this.stopSimulation(),
        onRenderGraph: () => {
          this.saveNodePositions();
          this.stopSimulation();
          this.renderGraph();
        },
      },
      this.dendrogramConfig.getConfig(
        this.container.nativeElement.clientWidth,
        this.container.nativeElement.clientHeight,
      ),
    );
  }
}
