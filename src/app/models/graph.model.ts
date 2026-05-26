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
