// ─────────────────────────────────────────────────────────────────────────────
// SvgBuilderService — SVG infrastructure: init, markers, zoom, resize, destroy
// Extracted from graph.component.ts (P2 — Étape 2)
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable } from "@angular/core";
import { select, type Selection } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { type Simulation } from "d3-force";

import { type SimNode, type SimLink } from "../models/graph.model";
import {
  COLOR_TERTIARY,
  COLOR_PRIMARY,
  COLOR_ELECTRIC,
} from "../models/colors";

export interface AutoZoomParams {
  svg: Selection<SVGSVGElement, unknown, null, undefined>;
  g: Selection<SVGGElement, unknown, null, undefined>;
  zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;
  containerEl: HTMLDivElement;
  centerNode: SimNode | null;
  useSimulationEnd: boolean;
  recenterOnResize: boolean;
}

@Injectable({ providedIn: "root" })
export class SvgBuilderService {
  svg: Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  g: Selection<SVGGElement, unknown, null, undefined> | null = null;
  zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null;
  resizeObserver: ResizeObserver | null = null;

  // Temporarily holds a reference to the simulation for auto-zoom + resize
  private simulationRef: Simulation<SimNode, SimLink> | null = null;

  initSvg(container: HTMLDivElement): void {
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.svg = select(container)
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

  addArrowMarkers(
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

  setupAutoZoomAndResize(params: AutoZoomParams): void {
    const {
      svg,
      g,
      zoomBehavior: zb,
      containerEl,
      centerNode,
      useSimulationEnd,
      recenterOnResize,
    } = params;

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
          zb.transform,
          zoomIdentity
            .translate(fullWidth / 2, fullHeight / 2)
            .scale(clampedScale)
            .translate(-bmidX, -bmidY),
        );
    };

    if (useSimulationEnd && this.simulationRef) {
      this.simulationRef.on("end", fitZoom);
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
        if (this.simulationRef) {
          this.simulationRef.alpha(0.3).restart();
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
            zb.transform,
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

  /** Set the simulation reference (needed by auto-zoom and resize) */
  setSimulation(simulation: Simulation<SimNode, SimLink> | null): void {
    this.simulationRef = simulation;
  }

  destroySvg(containerNativeEl: HTMLDivElement): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.svg) {
      select(containerNativeEl).select("svg").remove();
      this.svg = null;
      this.g = null;
      this.zoomBehavior = null;
    }
  }
}
