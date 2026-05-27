// ─────────────────────────────────────────────────────────────────────────────
// D3 simulation types
// ─────────────────────────────────────────────────────────────────────────────

import { type SimulationNodeDatum, type SimulationLinkDatum } from "d3-force";

export type NodeType = "SITE" | "R1" | "R2";

export type LayoutMode = "force" | "tree" | "dendrogram";

export interface Node {
  id: string;
  label: string;
  type: NodeType;
  sigmpr?: string;
}

export type EdgeType = "ANIMATION" | "LOGISTICS";

export interface Edge {
  source: string;
  target: string;
  type: EdgeType;
  dmsId?: string;
}

export interface GraphData {
  center: Node;
  nodes: Node[];
  edges: Edge[];
}

export interface SigmprSearchResult {
  sigmpr: string;
  r1Id: string;
  r1Label: string;
  siteId: string;
  siteLabel: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// D3 simulation node / link (used by Force layout)
// ─────────────────────────────────────────────────────────────────────────────

export interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: NodeType;
  sigmpr?: string;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  edgeType: "ANIMATION" | "LOGISTICS";
  sourceId: string;
  targetId: string;
  dmsId?: string;
  _parallelIndex?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchy datum (used by Tree / Dendrogram layouts)
// ─────────────────────────────────────────────────────────────────────────────

export interface HierarchyDatum {
  id: string;
  realId?: string; // original node ID (when id is a composite for uniqueness)
  label: string;
  type: NodeType;
  edgeType?: "ANIMATION" | "LOGISTICS";
  dmsId?: string;
  sigmpr?: string;
  children?: HierarchyDatum[];
}

export const LAYOUT_MODES: {
  value: LayoutMode;
  label: string;
  description: string;
}[] = [
  {
    value: "force",
    label: "Force",
    description: "Graphe force-directed (ego-centered)",
  },
  {
    value: "tree",
    label: "Arborescence",
    description: "Disposition hiérarchique en arbre",
  },
  {
    value: "dendrogram",
    label: "Dendrogramme",
    description: "Dendrogramme vertical (feuilles alignées en haut)",
  },
];
