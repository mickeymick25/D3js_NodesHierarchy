import { Injectable } from "@angular/core";
import { BehaviorSubject, Observable } from "rxjs";
import {
  Node,
  Edge,
  GraphData,
  EdgeType,
  LayoutMode,
  SigmprSearchResult,
} from "../models/graph.model";
import { MOCK_NODES, MOCK_EDGES } from "./mock-graph-data";

export interface EdgeFilters {
  animation: boolean;
  logistics: boolean;
}

export const DEFAULT_LAYOUT_MODE: LayoutMode = "force";

@Injectable({ providedIn: "root" })
export class GraphService {
  private allNodes = MOCK_NODES;
  private allEdges = MOCK_EDGES;

  /** Index maps for O(1) lookups */
  private r1BySigmpr = new Map<string, Node>();
  private edgeByTargetAnim = new Map<string, Edge>();
  private edgesByTargetLogistics = new Map<string, Edge[]>();
  private siteById = new Map<string, Node>();
  private nodeById = new Map<string, Node>();
  private allSites: Node[];

  private selectedSiteId$ = new BehaviorSubject<string>("site-1");
  private graphData$ = new BehaviorSubject<GraphData | null>(null);
  private filters$ = new BehaviorSubject<EdgeFilters>({
    animation: true,
    logistics: true,
  });
  private layoutMode$ = new BehaviorSubject<LayoutMode>(DEFAULT_LAYOUT_MODE);

  constructor() {
    this.allSites = this.allNodes.filter((n) => n.type === "SITE");

    for (const n of this.allNodes) {
      this.nodeById.set(n.id, n);
      if (n.type === "SITE") this.siteById.set(n.id, n);
      if (n.type === "R1" && n.sigmpr) this.r1BySigmpr.set(n.sigmpr, n);
    }

    for (const e of this.allEdges) {
      if (e.type === "ANIMATION") {
        this.edgeByTargetAnim.set(e.target, e);
      } else {
        const arr = this.edgesByTargetLogistics.get(e.target) || [];
        arr.push(e);
        this.edgesByTargetLogistics.set(e.target, arr);
      }
    }

    this.rebuildGraph();
  }

  getSelectedSiteId(): Observable<string> {
    return this.selectedSiteId$.asObservable();
  }

  getGraphData(): Observable<GraphData | null> {
    return this.graphData$.asObservable();
  }

  getAllSites(): Node[] {
    return this.allSites;
  }

  getFilters(): Observable<EdgeFilters> {
    return this.filters$.asObservable();
  }

  toggleFilter(type: EdgeType): void {
    const current = this.filters$.value;
    if (type === "ANIMATION") {
      this.filters$.next({ ...current, animation: !current.animation });
    } else {
      this.filters$.next({ ...current, logistics: !current.logistics });
    }
    this.rebuildGraph();
  }

  selectSite(siteId: string): void {
    this.selectedSiteId$.next(siteId);
    this.rebuildGraph();
  }

  getLayoutMode(): Observable<LayoutMode> {
    return this.layoutMode$.asObservable();
  }

  setLayoutMode(mode: LayoutMode): void {
    this.layoutMode$.next(mode);
  }

  searchBySigmpr(term: string): SigmprSearchResult[] {
    const lowerTerm = term.toLowerCase();
    const results: SigmprSearchResult[] = [];

    for (const [sigmpr, r1] of this.r1BySigmpr) {
      if (!sigmpr.toLowerCase().includes(lowerTerm)) continue;

      // O(1) lookup: ANIMATION edge by target
      const animEdge = this.edgeByTargetAnim.get(r1.id);
      let site: Node | null = animEdge
        ? (this.siteById.get(animEdge.source) ?? null)
        : null;

      // Fallback: O(1) lookup via LOGISTICS edges
      if (!site) {
        const logisticsEdges = this.edgesByTargetLogistics.get(r1.id);
        if (logisticsEdges && logisticsEdges.length > 0) {
          site = this.siteById.get(logisticsEdges[0].source) ?? null;
        }
      }

      if (site) {
        results.push({
          sigmpr: r1.sigmpr!,
          r1Id: r1.id,
          r1Label: r1.label,
          siteId: site.id,
          siteLabel: site.label,
        });
      }
    }

    return results;
  }

  private rebuildGraph(): void {
    const siteId = this.selectedSiteId$.value;
    const site = this.siteById.get(siteId) ?? null;

    if (!site) {
      this.graphData$.next(null);
      return;
    }

    const filters = this.filters$.value;

    // STRICT 1-hop: only edges where source is the selected site, filtered by type
    const directEdges = this.allEdges.filter(
      (e) =>
        e.source === siteId &&
        (e.type === "ANIMATION" ? filters.animation : filters.logistics),
    );

    const nodeIds = new Set<string>([siteId]);
    directEdges.forEach((e) => nodeIds.add(e.target));

    const nodes = this.allNodes.filter((n) => nodeIds.has(n.id));

    this.graphData$.next({
      center: site,
      nodes,
      edges: directEdges,
    });
  }
}
