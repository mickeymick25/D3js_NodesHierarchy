import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { GraphData, LayoutMode, Node, EdgeType } from "./models/graph.model";
import { GraphService, EdgeFilters } from "./services/graph.service";
import { GraphComponent } from "./components/graph/graph.component";
import { LegendComponent } from "./components/legend/legend.component";
import { SiteSelectorComponent } from "./components/site-selector/site-selector.component";
import { LayoutSelectorComponent } from "./components/layout-selector/layout-selector.component";
import { SigmprSearchComponent } from "./components/sigmpr-search/sigmpr-search.component";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    CommonModule,
    GraphComponent,
    LegendComponent,
    SiteSelectorComponent,
    LayoutSelectorComponent,
    SigmprSearchComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"],
})
export class AppComponent implements OnInit {
  graphData: GraphData | null = null;
  sites: Node[] = [];
  selectedSiteId = "";
  selectedLayoutMode: LayoutMode = "force";
  filters: EdgeFilters = { animation: true, logistics: true };
  selectedNodeIdBySearch: string | null = null;

  constructor(private graphService: GraphService) {}

  ngOnInit(): void {
    this.sites = this.graphService.getAllSites();
    this.graphService.getGraphData().subscribe((data) => {
      this.graphData = data;
    });
    this.graphService.getSelectedSiteId().subscribe((id) => {
      this.selectedSiteId = id;
    });
    this.graphService.getLayoutMode().subscribe((mode) => {
      this.selectedLayoutMode = mode;
    });
    this.graphService.getFilters().subscribe((f) => {
      this.filters = f;
    });
  }

  onFilterToggle(type: EdgeType): void {
    this.graphService.toggleFilter(type);
  }

  onSiteSelect(siteId: string): void {
    this.graphService.selectSite(siteId);
  }

  onModeChange(mode: LayoutMode): void {
    this.graphService.setLayoutMode(mode);
  }

  onSigmprSiteSelect(siteId: string): void {
    this.graphService.selectSite(siteId);
  }

  onSigmprNodeSelect(nodeId: string): void {
    this.selectedNodeIdBySearch = nodeId;
  }

  onSigmprNodeDeselect(): void {
    this.selectedNodeIdBySearch = null;
  }
}
