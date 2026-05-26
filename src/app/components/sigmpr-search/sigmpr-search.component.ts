import {
  Component,
  Output,
  EventEmitter,
  HostListener,
  ElementRef,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { GraphService } from "../../services/graph.service";
import { SigmprSearchResult } from "../../models/graph.model";

@Component({
  selector: "app-sigmpr-search",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="relative" #searchContainer>
      <label for="sigmpr-search" class="sr-only">Rechercher SIGMPR</label>
      <div class="relative">
        <input
          id="sigmpr-search"
          type="text"
          placeholder="Rechercher un SIGMPR…"
          [(ngModel)]="searchTerm"
          (ngModelChange)="onSearch()"
          (keydown.escape)="clearSearch()"
          (focus)="onFocus()"
          class="block w-full sm:w-48 rounded-md border-gray-300 shadow-sm
                 focus:border-blue-500 focus:ring-blue-500 text-sm py-2 px-3 pr-8 border bg-white"
        />
        <button
          *ngIf="searchTerm"
          (click)="clearSearch()"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          aria-label="Effacer la recherche"
        >
          ✕
        </button>
      </div>

      <!-- Dropdown des résultats -->
      <div
        *ngIf="results.length > 0 && showDropdown"
        class="absolute z-50 mt-1 w-72 bg-white rounded-md shadow-lg border border-gray-200
               max-h-60 overflow-y-auto"
      >
        <button
          *ngFor="let result of results"
          (click)="onSelect(result)"
          class="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm border-b border-gray-100 last:border-b-0"
        >
          <span class="font-mono font-semibold">{{ result.sigmpr }}</span>
          <span class="text-gray-600"> — {{ result.r1Label }}</span>
          <div class="text-xs text-gray-400">({{ result.siteLabel }})</div>
        </button>
      </div>
    </div>
  `,
})
export class SigmprSearchComponent {
  searchTerm = "";
  results: SigmprSearchResult[] = [];
  showDropdown = false;

  @Output() siteSelected = new EventEmitter<string>();
  @Output() nodeSelected = new EventEmitter<string>();
  @Output() nodeDeselected = new EventEmitter<void>();

  constructor(
    private graphService: GraphService,
    private elementRef: ElementRef,
  ) {}

  onSearch(): void {
    const term = this.searchTerm.trim();
    this.showDropdown = true;
    if (term.length < 2) {
      this.results = [];
      return;
    }
    this.results = this.graphService.searchBySigmpr(term);
  }

  onSelect(result: SigmprSearchResult): void {
    this.searchTerm = result.sigmpr;
    this.showDropdown = false;
    this.siteSelected.emit(result.siteId);
    this.nodeSelected.emit(result.r1Id);
  }

  clearSearch(): void {
    this.searchTerm = "";
    this.results = [];
    this.showDropdown = false;
    this.nodeDeselected.emit();
  }

  onFocus(): void {
    if (this.results.length > 0) {
      this.showDropdown = true;
    }
  }

  @HostListener("document:click", ["$event"])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.showDropdown = false;
    }
  }
}
