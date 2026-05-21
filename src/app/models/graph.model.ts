export type NodeType = "SITE" | "R1" | "R2";

export type LayoutMode = "force" | "tree" | "radial" | "pack";

export interface Node {
  id: string;
  label: string;
  type: NodeType;
}

export type EdgeType = "ANIMATION" | "LOGISTICS";

export interface Edge {
  source: string;
  target: string;
  type: EdgeType;
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
    value: "radial",
    label: "Radial",
    description: "Disposition radiale autour du site",
  },
  {
    value: "pack",
    label: "Pack",
    description: "Cercles emboîtés par type (R1/R2)",
  },
];
