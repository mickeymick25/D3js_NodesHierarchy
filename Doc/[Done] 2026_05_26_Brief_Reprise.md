# Brief — Reprise du Refactoring COP Links Visualization

**Date :** 2026-05-26
**Fichier :** `Doc/2026_05_26_Brief_Reprise.md`

---

## 1. État actuel du projet

### Application
Application Angular 17 de visualisation interactive d'un graphe ego-centered des relations d'un site (COP), avec 3 modes de vue (Force, Arborescence, Dendrogramme), sélection R1/R2 avec effet électrique, recherche SIGMPR, collapse/expand.

### Stack technique
- Angular 17 (standalone components)
- D3.js v7 (imports sélectifs depuis la Phase 1)
- Tailwind CSS 3
- Docker + Docker Compose (Node 20 Alpine)
- Accès : http://localhost:4200

### Commandes
```bash
docker compose up --build -d    # Build & run
docker compose logs -f           # Logs
docker compose down               # Stop
```

---

## 2. Phase 1 terminée ✅ (commit `fda8360`)

| # | Action | Ce qui a été fait | Fichier(s) |
|---|---|---|---|
| P1 | Imports D3 sélectifs | `import * as d3` → imports sélectifs depuis 8 sous-packages + side-effect `d3-transition`. Bug corrigé : `parentMap` déclaré avant utilisation. | `graph.component.ts` |
| P7 | Cache buildHierarchy | Wrapper avec cache clé `siteId:collapsedCount:sortedIds`. Invalidé sur changement de site. Ancienne méthode renommée `buildHierarchyImpl()`. | `graph.component.ts` |
| P8 | OnPush + d3.timer 30fps | `ChangeDetectionStrategy.OnPush` + `markForCheck()`. Couleurs pré-calculées (`ELECTRIC_COLORS[30]`). Throttle 30fps. | `graph.component.ts` |
| P9 | Index searchBySigmpr | 5 Maps index (`r1BySigmpr`, `edgeByTargetAnim`, `edgesByTargetLogistics`, `siteById`, `nodeById`). Recherche O(k). | `graph.service.ts` |

**Résultat :** Compilation OK, 0 erreurs, bundle `main.js` = 123.75 kB.

---

## 3. Phase 2 à faire — P2 : Découpage du composant monolithe

### Problème
`graph.component.ts` fait **3 316+ lignes** et gère tout : 3 layouts, interactions, animations, sélection, tooltips, badges, markers SVG, auto-zoom. C'est le bloqueur pour P3, P4, P5, P6, P10.

### Architecture cible

```
src/app/
├── services/
│   ├── graph.service.ts              (existant — P9 déjà fait)
│   ├── layout/
│   │   ├── hierarchy-layout.service.ts   → Code partagé Tree/Dendrogram
│   │   ├── force-layout.service.ts        → Layout force spécifique
│   │   ├── tree-layout.service.ts         → Mapping axes Tree
│   │   └── dendrogram-layout.service.ts   → Mapping axes Dendrogramme
│   ├── selection.service.ts              → applyNodeSelection + electric anim
│   └── svg-builder.service.ts            → Markers, defs, zoom, resize
├── components/
│   ├── graph/
│   │   ├── graph.component.ts            → Orchestrateur ~150 lignes
│   │   └── graph.component.html
│   └── ...
```

| Module estimé | Lignes | Responsabilité |
|---|---|---|
| `GraphComponent` | ~150 | Orchestration, ngOnChanges, lifecycle |
| `HierarchyLayoutService` | ~300 | Code partagé Tree/Dendrogram (badges, nœuds, hover, drag, collapse) |
| `ForceLayoutService` | ~250 | Force layout spécifique |
| `TreeLayoutService` | ~100 | Mapping axes Tree |
| `DendrogramLayoutService` | ~100 | Mapping axes Dendrogramme |
| `SelectionService` | ~250 | Sélection + transitions + animation électrique |
| `SvgBuilderService` | ~80 | Markers, defs, zoom, resize |

### Code dupliqué entre Tree et Dendrogram (~80%)
- Rendu des badges (A/DMS/L) — ~40 lignes × 2
- Rendu des nœuds (branches, centre, feuilles R1/R2) — ~120 lignes × 2
- Tags SIGMPR — ~30 lignes × 2
- Hover interactions (`addHierarchyHoverInteractions`) — ~170 lignes × 2
- Drag des nœuds feuilles — ~40 lignes × 2
- Simulation D3 — ~50 lignes × 2
- Auto-zoom et resize — ~10 lignes × 2
- Sélection par clic — ~15 lignes × 2

### Paramétrage HierarchyLayoutService

Les différences entre Tree et Dendrogram se résument à :

```typescript
interface HierarchyConfig {
  layout: "tree" | "dendrogram";
  xMapping: (d: any) => number;  // tree: d.y + 150, dendrogram: d.x + 150
  yMapping: (d: any) => number;  // tree: d.x + 40, dendrogram: height - d.y - 40
  linkCurve: (sx: number, sy: number, tx: number, ty: number) => string;
  labelPosition: "right" | "bottom";
  indicatorPosition: "right" | "bottom";
}
```

---

## 4. Phases suivantes (après P2)

| # | Priorité | Action | Dépend de |
|---|---|---|---|
| P6 | 🟠 Élevé | Extraction HierarchyLayoutService (suppression ~500 lignes) | P2 |
| P3 | 🟠 Élevé | Enter/Update/Exit D3 (rendu incrémental) | P2 |
| P4 | 🟠 Élevé | Références directes vs DOM queries | P2 |
| P5 | 🟠 Élevé | Transitions CSS vs D3 inline | P4 |
| P10 | 🟢 Faible | Pré-calcul badges getBBox | P2 |

---

## 5. Fichiers clés à lire

| Fichier | Lignes | Rôle |
|---|---|---|
| `src/app/components/graph/graph.component.ts` | ~3 350 | **Monolithe à découper** — lire en priorité |
| `src/app/services/graph.service.ts` | ~130 | Service de données (P9 déjà fait) |
| `src/app/models/graph.model.ts` | ~40 | Modèles (Node, Edge, LayoutMode, SigmprSearchResult) |
| `src/app/models/colors.ts` | ~60 | Constantes couleurs et styles |
| `src/app/services/mock-graph-data.ts` | ~130 | Données mock |
| `src/app/components/sigmpr-search/` | ~100 | Recherche SIGMPR |
| `Doc/2026_05_26_Refactoring_Performance.md` | ~570 | Plan complet avec suivi d'avancement |

### Sections critiques de graph.component.ts

| Méthode | Lignes approx. | Ce qu'elle fait | Futur service |
|---|---|---|---|
| `renderForceLayout()` | 250 | Force-directed layout | `ForceLayoutService` |
| `renderTreeLayout()` | 590 | Arborescence | `HierarchyLayoutService` + `TreeLayoutService` |
| `renderDendrogramLayout()` | 590 | Dendrogramme | `HierarchyLayoutService` + `DendrogramLayoutService` |
| `applyNodeSelection()` | 570 | Sélection + transitions + électrique | `SelectionService` |
| `addHierarchyHoverInteractions()` | 170 | Hover tree/dendrogram | `HierarchyLayoutService` |
| `addNeighborHover()` | 60 | Hover force | `ForceLayoutService` |
| `addCenterHover()` | 50 | Hover centre | `ForceLayoutService` |
| `startElectricAnimation()` / `stopElectricAnimation()` | 60 | Animation électrique | `SelectionService` |
| `addArrowMarkers()` | 80 | Marqueurs SVG | `SvgBuilderService` |
| `drawNodeCircles()` | 115 | Nœuds force | `ForceLayoutService` |
| `createEdgePaths()` | 30 | Liens force | `ForceLayoutService` |
| `createEdgeLabels()` | 40 | Badges force | `ForceLayoutService` |
| `addEdgeTooltip()` | 60 | Tooltips | `ForceLayoutService` |
| `computeEdgePath()` | 80 | Calcul chemins | `ForceLayoutService` |
| `updateEdgeLabelsForce()` | 80 | Mise à jour labels | `ForceLayoutService` |
| `setupAutoZoomAndResize()` | 70 | Zoom/resize | `SvgBuilderService` |
| `buildHierarchy()` / `buildHierarchyImpl()` | 90 | Construction hiérarchie | `HierarchyLayoutService` |

---

## 6. Risques et points d'attention pour P2

- **Régression visuelle** : Les 3 modes (Force, Arborescence, Dendrogramme) doivent être testés visuellement après chaque étape du découpage.
- **État partagé** : `selectedNodeId`, `collapsedBranches`, `savedPositions`, `selectionAnimTimer` sont partagés entre layouts et sélection — décider si ils restent dans le composant ou sont déplacés dans les services.
- **Références SVG** : Les méthodes de rendu partagent `this.svg` et `this.g` — ils devront être passés en paramètre ou injectés via un service.
- **`d3.timer` et `d3.drag`** : L'animation électrique et le drag D3 ont des callbacks qui référencent `this` — attention au binding `this` lors de l'extraction.
- **Angular DI** : Les services extraits doivent être `providedIn: 'root'` pour partager l'état avec le composant.

---

## 7. Objectif qualité : Platinium

Chaque priorité doit respecter les critères Platinium avant d'être marquée ✅ :

| Critère | Description |
|---|---|
| Code production-ready | Aucun `any`, aucun `eslint-disable`, typage strict |
| Zéro régression visuelle | Les 3 modes testés visuellement |
| Zéro dette technique | Pas de code mort en commentaire, pas de duplication résiduelle |
| Performance mesurée | Métriques avant/après consignées dans le suivi |
| Documentation à jour | Journal des modifications dans `Doc/` |
| Tests | Cas critiques couverts |

**Barème P2** : `graph.component.ts` < 800 lignes, 0 ligne dupliquée Tree/Dendrogram.