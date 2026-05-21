import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { GraphService } from "../../services/graph.service";
import { Node } from "../../models/graph.model";

@Component({
  selector: "app-site-selector",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex items-center gap-3">
      <label for="site-select" class="text-sm font-medium text-gray-700"
        >Site :</label
      >
      <select
        id="site-select"
        [ngModel]="selectedSiteId"
        (ngModelChange)="onSiteChange($event)"
        class="block w-full sm:w-64 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 border bg-white"
      >
        <option *ngFor="let site of sites" [ngValue]="site.id">
          {{ site.label }}
        </option>
      </select>
    </div>
  `,
})
export class SiteSelectorComponent implements OnInit {
  sites: Node[] = [];
  selectedSiteId = "";

  constructor(private graphService: GraphService) {}

  ngOnInit(): void {
    this.sites = this.graphService.getAllSites();
    this.graphService.getSelectedSiteId().subscribe((id) => {
      this.selectedSiteId = id;
    });
  }

  onSiteChange(siteId: string): void {
    this.graphService.selectSite(siteId);
  }
}
