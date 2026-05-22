import { Injectable } from "@angular/core";
import { BehaviorSubject, Observable } from "rxjs";
import { Node, GraphData, EdgeType, LayoutMode } from "../models/graph.model";
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

  private selectedSiteId$ = new BehaviorSubject<string>("site-1");
  private graphData$ = new BehaviorSubject<GraphData | null>(null);
  private filters$ = new BehaviorSubject<EdgeFilters>({
    animation: true,
    logistics: true,
  });
  private layoutMode$ = new BehaviorSubject<LayoutMode>(DEFAULT_LAYOUT_MODE);

  constructor() {
    this.rebuildGraph();
  }

  getSelectedSiteId(): Observable<string> {
    return this.selectedSiteId$.asObservable();
  }

  getGraphData(): Observable<GraphData | null> {
    return this.graphData$.asObservable();
  }

  getAllSites(): Node[] {
    return this.allNodes.filter((n) => n.type === "SITE");
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

  private rebuildGraph(): void {
    const siteId = this.selectedSiteId$.value;
    const site = this.allNodes.find((n) => n.id === siteId);

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
