import { Injectable } from "@angular/core";
import { BehaviorSubject, Observable } from "rxjs";
import {
  Node,
  Edge,
  GraphData,
  EdgeType,
  LayoutMode,
} from "../models/graph.model";

export interface EdgeFilters {
  animation: boolean;
  logistics: boolean;
}

export const DEFAULT_LAYOUT_MODE: LayoutMode = "force";

const MOCK_NODES: Node[] = [
  // Sites
  { id: "site-1", label: "Site Paris", type: "SITE" },
  { id: "site-2", label: "Site Lyon", type: "SITE" },
  { id: "site-3", label: "Site Marseille", type: "SITE" },
  { id: "site-4", label: "Site Toulouse", type: "SITE" },
  { id: "site-5", label: "Site Bordeaux", type: "SITE" },
  { id: "site-6", label: "Garage Michael", type: "SITE" },

  // R1 — Sites animation
  { id: "r1-1", label: "Site R1 Île-de-France", type: "R1" },
  { id: "r1-2", label: "Site R1 Auvergne-Rhône-Alpes", type: "R1" },
  { id: "r1-3", label: "Site R1 Provence-Alpes-Côte d'Azur", type: "R1" },
  { id: "r1-4", label: "Site R1 Occitanie", type: "R1" },
  { id: "r1-5", label: "Site R1 Nouvelle-Aquitaine", type: "R1" },
  { id: "r1-6", label: "Site R1 Boulogne", type: "R1" },
  { id: "r1-7", label: "Site R1 Paris", type: "R1" },
  { id: "r1-8", label: "Site R1 Nantes", type: "R1" },
  { id: "r1-9", label: "Site R1 Strasbourg", type: "R1" },
  { id: "r1-10", label: "Site R1 Montpellier", type: "R1" },
  { id: "r1-11", label: "Site R1 Lille", type: "R1" },
  { id: "r1-12", label: "Site R1 Rennes", type: "R1" },
  { id: "r1-13", label: "Site R1 Reims", type: "R1" },
  { id: "r1-14", label: "Site R1 Grenoble", type: "R1" },
  { id: "r1-15", label: "Site R1 Dijon", type: "R1" },
  { id: "r1-16", label: "Site R1 Le Havre", type: "R1" },
  { id: "r1-17", label: "Site R1 Toulon", type: "R1" },
  { id: "r1-18", label: "Site R1 Angers", type: "R1" },
  { id: "r1-19", label: "Site R1 Saint-Étienne", type: "R1" },
  { id: "r1-20", label: "Site R1 Clermont-Ferrand", type: "R1" },

  // R2 — Sites logistique
  { id: "r2-1", label: "Site R2 Entrepôt Nord", type: "R2" },
  { id: "r2-2", label: "Site R2 Entrepôt Sud-Est", type: "R2" },
  { id: "r2-3", label: "Site R2 Entrepôt Sud-Ouest", type: "R2" },
  { id: "r2-4", label: "Site R2 Hub Central", type: "R2" },
  { id: "r2-5", label: "Site R2 Nice", type: "R2" },
  { id: "r2-6", label: "Site R2 Toulouse", type: "R2" },
  { id: "r2-7", label: "Site R2 Brest", type: "R2" },
  { id: "r2-8", label: "Site R2 Metz", type: "R2" },
  { id: "r2-9", label: "Site R2 Besançon", type: "R2" },
  { id: "r2-10", label: "Site R2 Orléans", type: "R2" },
  { id: "r2-11", label: "Site R2 Rouen", type: "R2" },
  { id: "r2-12", label: "Site R2 Tours", type: "R2" },
  { id: "r2-13", label: "Site R2 Amiens", type: "R2" },
  { id: "r2-14", label: "Site R2 Limoges", type: "R2" },
  { id: "r2-15", label: "Site R2 Annecy", type: "R2" },
  { id: "r2-16", label: "Site R2 Perpignan", type: "R2" },
  { id: "r2-17", label: "Site R2 Caen", type: "R2" },
  { id: "r2-18", label: "Site R2 Poitiers", type: "R2" },
  { id: "r2-19", label: "Site R2 Le Mans", type: "R2" },
  { id: "r2-20", label: "Site R2 Aix-en-Provence", type: "R2" },
  { id: "r2-21", label: "Site R2 Pau", type: "R2" },
  { id: "r2-22", label: "Site R2 Dunkerque", type: "R2" },
  { id: "r2-23", label: "Site R2 Versailles", type: "R2" },
  { id: "r2-24", label: "Site R2 Nanterre", type: "R2" },
  { id: "r2-25", label: "Site R2 Mulhouse", type: "R2" },
  { id: "r2-26", label: "Site R2 Nîmes", type: "R2" },
  { id: "r2-27", label: "Site R2 Villeurbanne", type: "R2" },
  { id: "r2-28", label: "Site R2 Colombes", type: "R2" },
  { id: "r2-29", label: "Site R2 Aubervilliers", type: "R2" },
  { id: "r2-30", label: "Site R2 Aulnay-sous-Bois", type: "R2" },
];

const MOCK_EDGES: Edge[] = [
  // === Animation links (SITE → R1, exactly 1 per site) ===
  { source: "site-1", target: "r1-1", type: "ANIMATION" },
  { source: "site-2", target: "r1-2", type: "ANIMATION" },
  { source: "site-3", target: "r1-3", type: "ANIMATION" },
  { source: "site-4", target: "r1-4", type: "ANIMATION" },
  { source: "site-5", target: "r1-5", type: "ANIMATION" },
  { source: "site-6", target: "r1-6", type: "ANIMATION" },

  // === Site Paris (site-1) — 50 logistics links ===
  { source: "site-1", target: "r2-1", type: "LOGISTICS" },
  { source: "site-1", target: "r2-4", type: "LOGISTICS" },
  { source: "site-1", target: "r1-8", type: "LOGISTICS" },
  { source: "site-1", target: "r1-9", type: "LOGISTICS" },
  { source: "site-1", target: "r1-10", type: "LOGISTICS" },
  { source: "site-1", target: "r1-11", type: "LOGISTICS" },
  { source: "site-1", target: "r1-12", type: "LOGISTICS" },
  { source: "site-1", target: "r1-13", type: "LOGISTICS" },
  { source: "site-1", target: "r1-14", type: "LOGISTICS" },
  { source: "site-1", target: "r1-15", type: "LOGISTICS" },
  { source: "site-1", target: "r1-16", type: "LOGISTICS" },
  { source: "site-1", target: "r1-17", type: "LOGISTICS" },
  { source: "site-1", target: "r1-18", type: "LOGISTICS" },
  { source: "site-1", target: "r1-19", type: "LOGISTICS" },
  { source: "site-1", target: "r1-20", type: "LOGISTICS" },
  { source: "site-1", target: "r2-5", type: "LOGISTICS" },
  { source: "site-1", target: "r2-6", type: "LOGISTICS" },
  { source: "site-1", target: "r2-7", type: "LOGISTICS" },
  { source: "site-1", target: "r2-8", type: "LOGISTICS" },
  { source: "site-1", target: "r2-9", type: "LOGISTICS" },
  { source: "site-1", target: "r2-10", type: "LOGISTICS" },
  { source: "site-1", target: "r2-11", type: "LOGISTICS" },
  { source: "site-1", target: "r2-12", type: "LOGISTICS" },
  { source: "site-1", target: "r2-13", type: "LOGISTICS" },
  { source: "site-1", target: "r2-14", type: "LOGISTICS" },
  { source: "site-1", target: "r2-15", type: "LOGISTICS" },
  { source: "site-1", target: "r2-16", type: "LOGISTICS" },
  { source: "site-1", target: "r2-17", type: "LOGISTICS" },
  { source: "site-1", target: "r2-18", type: "LOGISTICS" },
  { source: "site-1", target: "r2-19", type: "LOGISTICS" },
  { source: "site-1", target: "r2-20", type: "LOGISTICS" },
  { source: "site-1", target: "r2-21", type: "LOGISTICS" },
  { source: "site-1", target: "r2-22", type: "LOGISTICS" },
  { source: "site-1", target: "r2-23", type: "LOGISTICS" },
  { source: "site-1", target: "r2-24", type: "LOGISTICS" },
  { source: "site-1", target: "r2-25", type: "LOGISTICS" },
  { source: "site-1", target: "r2-26", type: "LOGISTICS" },
  { source: "site-1", target: "r2-27", type: "LOGISTICS" },
  { source: "site-1", target: "r2-28", type: "LOGISTICS" },
  { source: "site-1", target: "r2-29", type: "LOGISTICS" },
  { source: "site-1", target: "r2-30", type: "LOGISTICS" },
  { source: "site-1", target: "r1-7", type: "LOGISTICS" },
  { source: "site-1", target: "r2-2", type: "LOGISTICS" },
  { source: "site-1", target: "r2-3", type: "LOGISTICS" },

  // === Other sites — existing logistics links ===
  { source: "site-2", target: "r2-2", type: "LOGISTICS" },
  { source: "site-2", target: "r2-4", type: "LOGISTICS" },
  { source: "site-3", target: "r2-2", type: "LOGISTICS" },
  { source: "site-3", target: "r2-3", type: "LOGISTICS" },
  { source: "site-4", target: "r2-3", type: "LOGISTICS" },
  { source: "site-4", target: "r1-4", type: "LOGISTICS" },
  { source: "site-5", target: "r2-3", type: "LOGISTICS" },
  { source: "site-5", target: "r2-4", type: "LOGISTICS" },

  // === Garage Michael ===
  { source: "site-6", target: "r1-6", type: "LOGISTICS" },
  { source: "site-6", target: "r1-7", type: "LOGISTICS" },
];

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
