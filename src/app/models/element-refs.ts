// ─────────────────────────────────────────────────────────────────────────────
// ElementRefs — D3 Selection reference maps for O(1) lookups (P4)
// ─────────────────────────────────────────────────────────────────────────────

import { type Selection } from "d3-selection";
import { type HierarchyDatum } from "./graph.model";

/**
 * Holds D3 Selection references to SVG elements, populated during render
 * and used by SelectionService / hover handlers / electric animation for O(1) lookups.
 *
 * Lifecycle: cleared on fullRebuild / layout change, updated on incremental update.
 * Managed by GraphComponent, passed to layout services for population.
 */
export class ElementRefs {
  /** Map<nodeId, Selection<SVGGElement>> — node groups (neighbor + branch + center) */
  readonly nodeGroupMap = new Map<
    string,
    Selection<SVGGElement, unknown, null, undefined>
  >();

  /** Map<nodeId, realId> — maps composite/node IDs to original node IDs (for type lookups) */
  readonly nodeRealIdMap = new Map<string, string>();

  /** Map<edgeKey (sourceId|targetId|edgeType), Selection<SVGPathElement>> — edge paths */
  readonly edgePathMap = new Map<
    string,
    Selection<SVGPathElement, unknown, null, undefined>
  >();

  /** Map<edgeKey (sourceId|targetId|edgeType) or targetId (hierarchy), Selection<SVGGElement>> — edge label groups (Force) or link badge groups (Tree/Dendrogram) */
  readonly badgeGroupMap = new Map<
    string,
    Selection<SVGGElement, unknown, null, undefined>
  >();

  /** Map<edgeKey or targetId, edgeType> — edge type associated with each badge */
  readonly badgeEdgeTypeMap = new Map<string, string>();

  /** References to SVG paths that have the electric-current class (for animation) */
  readonly electricPaths: Selection<
    SVGPathElement,
    unknown,
    null,
    undefined
  >[] = [];

  /** Clear all maps and references */
  clear(): void {
    this.nodeGroupMap.clear();
    this.nodeRealIdMap.clear();
    this.edgePathMap.clear();
    this.badgeGroupMap.clear();
    this.badgeEdgeTypeMap.clear();
    this.electricPaths.length = 0;
  }
}
