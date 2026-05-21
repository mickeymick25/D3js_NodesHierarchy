import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { GraphService } from "../../services/graph.service";
import { LayoutMode, LAYOUT_MODES } from "../../models/graph.model";

@Component({
  selector: "app-layout-selector",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex items-center gap-3">
      <label for="layout-select" class="text-sm font-medium text-gray-700"
        >Mode :</label
      >
      <select
        id="layout-select"
        [ngModel]="selectedMode"
        (ngModelChange)="onModeChange($event)"
        class="block w-full sm:w-48 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 border bg-white"
      >
        <option
          *ngFor="let mode of modes"
          [ngValue]="mode.value"
          [title]="mode.description"
        >
          {{ mode.label }}
        </option>
      </select>
    </div>
  `,
})
export class LayoutSelectorComponent implements OnInit {
  modes = LAYOUT_MODES;
  selectedMode: LayoutMode = "force";

  constructor(private graphService: GraphService) {}

  ngOnInit(): void {
    this.graphService.getLayoutMode().subscribe((mode) => {
      this.selectedMode = mode;
    });
  }

  onModeChange(mode: LayoutMode): void {
    this.graphService.setLayoutMode(mode);
  }
}
