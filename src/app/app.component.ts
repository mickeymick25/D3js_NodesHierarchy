import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { GraphData, LayoutMode } from "./models/graph.model";
import { GraphService } from "./services/graph.service";
import { GraphComponent } from "./components/graph/graph.component";
import { LegendComponent } from "./components/legend/legend.component";
import { SiteSelectorComponent } from "./components/site-selector/site-selector.component";
import { LayoutSelectorComponent } from "./components/layout-selector/layout-selector.component";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    CommonModule,
    GraphComponent,
    LegendComponent,
    SiteSelectorComponent,
    LayoutSelectorComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"],
})
export class AppComponent implements OnInit {
  graphData: GraphData | null = null;
  layoutMode: LayoutMode = "force";

  constructor(private graphService: GraphService) {}

  ngOnInit(): void {
    this.graphService.getGraphData().subscribe((data) => {
      this.graphData = data;
    });
    this.graphService.getLayoutMode().subscribe((mode) => {
      this.layoutMode = mode;
    });
  }
}
