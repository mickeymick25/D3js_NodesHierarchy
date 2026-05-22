import { Component, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { GraphService, EdgeFilters } from "../../services/graph.service";

@Component({
  selector: "app-legend",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="legend bg-white rounded-lg shadow-md border border-gray-200 p-4 text-sm max-w-[280px] sm:max-w-none"
    >
      <h3 class="font-semibold text-gray-700 mb-3">Légende</h3>

      <div class="mb-3">
        <p
          class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2"
        >
          Nœuds
        </p>
        <div class="flex items-center gap-2 mb-1.5">
          <span
            class="inline-block w-4 h-4 rounded-full"
            style="background-color: #F7FBFF; border: 1px solid #4B9BF5;"
          ></span>
          <span class="text-gray-700">Site R3 (centre)</span>
        </div>
        <div class="flex items-center gap-2 mb-1.5">
          <span
            class="inline-block w-4 h-4 rounded-full"
            style="background-color: #978B7F;"
          ></span>
          <span class="text-gray-700">Site R1</span>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="inline-block w-4 h-4 rounded-full"
            style="background-color: #1F1205;"
          ></span>
          <span class="text-gray-700">Site R2</span>
        </div>
      </div>

      <div>
        <p
          class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2"
        >
          Relations
        </p>
        <button
          (click)="toggle('ANIMATION')"
          [ngClass]="
            filters.animation ? 'opacity-100' : 'opacity-40 line-through'
          "
          class="flex items-center gap-2 mb-2 w-full text-left group cursor-pointer rounded px-1 py-0.5"
        >
          <span
            class="inline-block w-5 h-0.5 rounded-full group-hover:w-6 transition-all"
            style="background-color: #2E2ECA;"
          ></span>
          <span
            class="text-gray-700 group-hover:text-gray-900 transition-colors"
            >Animation (flux de ventes)</span
          >
          <span
            class="ml-auto text-xs"
            [ngClass]="filters.animation ? 'font-bold' : ''"
            [style.color]="filters.animation ? '#2E2ECA' : '#9CA3AF'"
          >
            {{ filters.animation ? "✓" : "✗" }}
          </span>
        </button>
        <button
          (click)="toggle('LOGISTICS')"
          [ngClass]="
            filters.logistics ? 'opacity-100' : 'opacity-40 line-through'
          "
          class="flex items-center gap-2 w-full text-left group cursor-pointer rounded px-1 py-0.5"
        >
          <span
            class="inline-block w-5 h-0.5 rounded-full group-hover:w-6 transition-all"
            style="background-color: #978B7F;"
          ></span>
          <span
            class="text-gray-700 group-hover:text-gray-900 transition-colors"
            >Logistique (relations opérationnelles)</span
          >
          <span
            class="ml-auto text-xs"
            [ngClass]="filters.logistics ? 'font-bold' : ''"
            [style.color]="filters.logistics ? '#978B7F' : '#9CA3AF'"
          >
            {{ filters.logistics ? "✓" : "✗" }}
          </span>
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .legend {
        min-width: 200px;
      }
      button {
        border: none;
        background: none;
        padding: 4px 0;
        font-size: 13px;
        color: inherit;
      }
      button:hover {
        background: #f9fafb;
        border-radius: 4px;
      }
      .line-through {
        text-decoration: line-through;
      }
    `,
  ],
})
export class LegendComponent implements OnInit {
  filters: EdgeFilters = { animation: true, logistics: true };

  constructor(private graphService: GraphService) {}

  ngOnInit(): void {
    this.graphService.getFilters().subscribe((f) => {
      this.filters = f;
    });
  }

  toggle(type: "ANIMATION" | "LOGISTICS"): void {
    this.graphService.toggleFilter(type);
  }
}
