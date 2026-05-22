import { Component, Input, Output, EventEmitter } from "@angular/core";
import { CommonModule } from "@angular/common";
import { EdgeType } from "../../models/graph.model";
import { EdgeFilters } from "../../services/graph.service";
import {
  COLOR_PRIMARY,
  COLOR_ON_PRIMARY_CONTAINER,
  COLOR_ELECTRIC,
  COLOR_ELECTRIC_CONTAINER,
  COLOR_PRIMARY_CONTAINER,
  COLOR_TERTIARY,
} from "../../models/colors";

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
            [style.backgroundColor]="COLOR_ELECTRIC_CONTAINER"
            [style.border]="'1px solid ' + COLOR_ELECTRIC"
          ></span>
          <span class="text-gray-700">Site R3 (centre)</span>
        </div>
        <div class="flex items-center gap-2 mb-1.5">
          <span
            class="inline-block w-4 h-4 rounded-full"
            [style.backgroundColor]="COLOR_PRIMARY_CONTAINER"
            [style.border]="'1px solid ' + COLOR_PRIMARY"
          ></span>
          <span class="text-gray-700">Site R1</span>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="inline-block w-4 h-4 rounded-full"
            [style.backgroundColor]="COLOR_PRIMARY_CONTAINER"
            [style.border]="'1px solid ' + COLOR_ON_PRIMARY_CONTAINER"
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
            [style.backgroundColor]="COLOR_TERTIARY"
          ></span>
          <span
            class="text-gray-700 group-hover:text-gray-900 transition-colors"
            >Animation (flux de ventes)</span
          >
          <span
            class="ml-auto text-xs"
            [ngClass]="filters.animation ? 'font-bold' : ''"
            [style.color]="filters.animation ? COLOR_TERTIARY : '#9CA3AF'"
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
            [style.backgroundColor]="COLOR_PRIMARY"
          ></span>
          <span
            class="text-gray-700 group-hover:text-gray-900 transition-colors"
            >Logistique (relations opérationnelles)</span
          >
          <span
            class="ml-auto text-xs"
            [ngClass]="filters.logistics ? 'font-bold' : ''"
            [style.color]="filters.logistics ? COLOR_PRIMARY : '#9CA3AF'"
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
export class LegendComponent {
  @Input() filters: EdgeFilters = { animation: true, logistics: true };
  @Output() filterToggle = new EventEmitter<EdgeType>();

  // Expose color constants to template
  readonly COLOR_ELECTRIC_CONTAINER = COLOR_ELECTRIC_CONTAINER;
  readonly COLOR_ELECTRIC = COLOR_ELECTRIC;
  readonly COLOR_PRIMARY_CONTAINER = COLOR_PRIMARY_CONTAINER;
  readonly COLOR_PRIMARY = COLOR_PRIMARY;
  readonly COLOR_ON_PRIMARY_CONTAINER = COLOR_ON_PRIMARY_CONTAINER;
  readonly COLOR_TERTIARY = COLOR_TERTIARY;

  toggle(type: EdgeType): void {
    this.filterToggle.emit(type);
  }
}
