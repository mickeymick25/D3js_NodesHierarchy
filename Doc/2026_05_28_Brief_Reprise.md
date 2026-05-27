# Brief — Reprise du projet COP Links Visualization

**Date :** 2026-05-28
**Fichier :** `Doc/2026_05_28_Brief_Reprise.md`

---

## 1. Objectif du projet

Application Angular 17 de visualisation interactive d'un **graphe ego-centered** des relations d'un site (COP). Le graphe affiche uniquement les **relations directes 1-hop** d'un site sélectionné, avec distinction visuelle entre **flux d'animation** (ventes → R1) et **flux logistique** (opérations → R1/R2).

### Stack technique
- Angular 17 (standalone components, OnPush)
- D3.js v7 (imports sélectifs depuis P1)
- Tailwind CSS 3
- Docker + Docker Compose (Node 20 Alpine)
- Accès : http://localhost:4200

### Commandes
```bash
docker compose up --build -d    # Build & run
docker compose logs -f           # Logs
docker compose down               # Stop
```

### 3 modes de visualisation
| Mode | Description |
|---|---|
| **Force** | Graphe force-directed (ego-centered) |
| **Arborescence** | Layout hiérarchique horizontal |
| **Dendrogramme** | Dendrogramme vertical (feuilles alignées en haut) |

---

## 2. Architecture actuelle

```
src/app/
├── models/
│   ├── graph.model.ts              — Node, Edge, SimNode, SimLink, HierarchyDatum, LayoutMode, SigmprSearchResult
│   ├── hierarchy-config.ts         — HierarchyConfig (paramétrage Tree vs Dendrogram)
│   ├── colors.ts                   — Palette, NODE_COLORS, NODE_RADIUS, LINK_DISTANCE
│   └── element-refs.ts             — ElementRefs (Maps de références D3 pour O(1) lookups)
├── services/
│   ├── graph.service.ts            — Données mock, filtrage, sélection site, searchBySigmpr (O(1) via Maps)
│   ├── mock-graph-data.ts          — 6 sites, 20 R1, 30 R2, ~50 edges
│   ├── selection.service.ts        — Sélection nœud + transitions couleur D3 + animation électrique (~690 lignes)
│   ├── svg-builder.service.ts      — Init SVG, markers, zoom, resize, destroy
│   └── layout/
│       ├── force-layout.service.ts     — Force: render() + update() (~1290 lignes)
│       ├── hierarchy-layout.service.ts — Code partagé Tree/Dendrogram (~1000 lignes)
│       ├── tree-layout.service.ts      — Config Tree (xMapping, linkCurve, applyLayout)
│       └── dendrogram-layout.service.ts — Config Dendrogram (cluster, vertical)
├── components/
│   ├── graph/
│   │   ├── graph.component.ts          — Orchestrateur (~540 lignes)
│   │   ├── graph.component.html
│   │   └── graph.component.scss        — CSS transitions .g-node/.g-edge/.g-badge
│   ├── legend/
│   ├── site-selector/
│   ├── layout-selector/
│   └── sigmpr-search/
└── app.component.ts/html
```

---

## 3. Phases terminées ✅

| Phase | Date | Description |
|---|---|---|
| **P1** | 2026-05-26 | Imports D3 sélectifs, bundle ~140 KB |
| **P2** | 2026-05-27 | Découpage monolithe (3316 → ~540 lignes), 4 services layout + SelectionService + SvgBuilderService |
| **P3** | 2026-05-28 | Enter/Update/Exit D3 (mode Force incrémental), correction bugs désélection et SIGMPR |
| **P4** | 2026-05-28 | Références directes vs DOM queries — ElementRefs Maps O(1), classes CSS .inner-circle/.halo-circle, nettoyage data-* attributes, hover handlers avec Maps |
| **P5** | 2026-05-28 | Transitions CSS vs D3 inline — Approche hybride : opacity → CSS class .dimmed, couleurs → D3 inline, animation électrique intacte |
| **P6** | 2026-05-26 | Fusionné dans P2 — HierarchyLayoutService avec HierarchyConfig |
| **P7** | 2026-05-26 | Cache buildHierarchy (clé = siteId:collapsedCount:collapsedIds) |
| **P8** | 2026-05-26 | OnPush + d3.timer 30fps + couleurs pré-calculées |
| **P9** | 2026-05-26 | Index searchBySigmpr O(k) via Maps |

---

## 4. Phase restante

### P10 — Pré-calcul badges getBBox

| Champ | Détail |
|---|---|
| **Priorité** | 🟢 Faible |
| **Effort** | Faible |
| **Impact** | Rendu initial -30-40%, simulation ~50 getBBox/tick éliminés |
| **Statut** | ✅ Terminé |

**Problème :** `getBBox()` force un layout synchrone du navigateur. Appelé ~100 fois pour un site avec 50 liens.

**Deux solutions possibles :**

1. **Pré-calculer les largeurs de badges** : Les badges "A" et "L" ont une largeur constante, les badges "DMS:xxxxxx" ont une largeur prédictible ≈ 7px × len + 8px padding
2. **Batcher les lectures getBBox** : Regrouper tous les `append("text")` en premier, puis un seul cycle de lecture `getBBox()`, puis appliquer les `rect` en batch

**Fichiers concernés :**
- `src/app/services/layout/force-layout.service.ts` — `drawNodeCircles()` (SIGMPR tags), `addEdgeTooltip()` (tooltip), `updateEdgeLabelsForce()` (badge rects)
- `src/app/services/layout/hierarchy-layout.service.ts` — `drawNodes()` (SIGMPR tags), `drawLinkBadges()` (badges)

---

## 5. Détails P4 — ElementRefs (contexte important)

### Classe ElementRefs

```typescript
class ElementRefs {
  nodeGroupMap: Map<string, Selection<SVGGElement>>        // clé = nodeId
  nodeRealIdMap: Map<string, string>                       // nodeId → realId (composite→original)
  edgePathMap: Map<string, Selection<SVGPathElement>>       // clé = sourceId|targetId|edgeType
  badgeGroupMap: Map<string, Selection<SVGGElement>>        // Force: sourceId|targetId|edgeType, Hierarchy: targetId
  badgeEdgeTypeMap: Map<string, string>                     // badge key → edgeType
  electricPaths: Selection<SVGPathElement>[]                // paths animés par courant électrique
  clear(): void
}
```

### Cycle de vie
- **`fullRebuild()`** → `elementRefs.clear()` avant `renderGraph()`
- **`renderGraph()`** → `elementRefs.clear()` avant chaque render
- **`incrementalUpdate()` (Force)** → Maps mises à jour via `ForceLayoutService.update()`
- **Changement de layout** → `elementRefs.clear()` implicite via `fullRebuild()`

### Classes CSS sur les éléments SVG
| Classe | Éléments | Effet |
|---|---|---|
| `.g-node` | Node groups (`<g>`) | `transition: opacity 250ms ease` |
| `.g-edge` | Edge paths (`<path>`) | `transition: opacity 250ms ease` |
| `.g-badge` | Badge/label groups (`<g>`) | `transition: opacity 250ms ease` |
| `.dimmed` | Toggled sur n'importe lequel des 3 ci-dessus | Opacité réduite (géré par D3 `.classed()`) |
| `.inner-circle` | Cercle intérieur des nœuds | Identifie le cercle principal (vs halo) |
| `.halo-circle` | Cercle halo des nœuds | Identifie le cercle extérieur |

---

## 6. Détails P5 — Transitions CSS (contexte important)

### Approche hybride

| Propriété | Méthode | Justification |
|---|---|---|
| `opacity` | CSS class `.dimmed` + `transition: opacity 250ms ease` | Bien supporté en SVG, 0 JS/frame |
| `fill`, `stroke` | D3 `.transition().duration(250)` | Pas fiable en CSS SVG cross-browser |
| Animation électrique | JS (d3.timer, 30fps) | Continue et dynamique |

### Pattern P5 dans SelectionService

```typescript
// AVANT (P4) — D3 transition inline
nodeGroup.interrupt().transition().duration(t).attr("opacity", 1);
pathEl.interrupt().transition().duration(t).attr("opacity", 0.12);

// APRÈS (P5) — CSS class toggle
nodeGroup.classed("dimmed", false);          // opacity → 1 via CSS transition
pathEl.classed("dimmed", true);             // opacity → 0.12 via CSS transition
```

### Constantes renommées
- `SELECTION_TRANSITION_MS` → `COLOR_TRANSITION_MS` (250ms) — ne sert plus que pour les transitions de couleur D3

---

## 7. Points d'attention connus

| Point | Détail |
|---|---|
| **`data-*` attributes conservés** | `data-node-id`, `data-real-id`, `data-source-id`, `data-target-id`, `data-edge-type` sont conservés sur les éléments SVG. Ils ne sont plus lus dans `SelectionService` (remplacés par Maps), mais restent utilisés par : (1) le D3 data-join key `selectAll("g[data-node-id]")` dans `ForceLayoutService.update()`, (2) le debug DevTools, (3) les tooltips. |
| **Hover handlers Force** | Les handlers `addNeighborHover` et `addCenterHover` utilisent les Maps ElementRefs et les classes CSS `.dimmed`. Les appels `.interrupt()` restent nécessaires pour annuler les transitions de couleur D3 en cours. |
| **Tick handler Hierarchy** | Le tick handler pour les positions des badges utilise `elementRefs.badgeGroupMap.forEach()` au lieu de `selectAll("g").attr("transform", function() { ... })`. |
| **Duplication render/update Force** | `ForceLayoutService.render()` et `update()` partagent beaucoup de code similaire (~60% de duplication). C'est un candidat pour un futur refactoring. |
| **`select` de d3-selection** | L'import `select` n'est plus utilisé dans `graph.component.ts` ni `selection.service.ts`. Il reste utilisé dans `force-layout.service.ts` et `hierarchy-layout.service.ts` pour les opérations D3 internes. |
| **Erreurs TypeScript préexistantes** | Le Zed language server ne résout pas `node_modules`, causant des erreurs "Cannot find module" sur `@angular/core`, `d3-*`, `tslib`. Aussi des `SimNode.x/fy` non reconnus et des `this: any` implicites dans les callbacks D3. Ces erreurs n'affectent pas le build Docker. |

---

## 8. Documentation existante

| Fichier | Contenu |
|---|---|
| `Doc/spec.md` | Spécification fonctionnelle complète |
| `Doc/2026_05_26_Refactoring_Performance.md` | Plan de refactoring complet avec suivi d'avancement (P1-P10) |
| `Doc/2026_05_26_Brief_Reprise.md` | Brief de reprise P2 (découpage monolithe) |
| `Doc/2026_05_26_Plan_Decoupage_P2.md` | Plan détaillé du découpage P2 |
| `Doc/2026_05_26_Refactoring_Performance.md` | Plan complet avec suivi d'avancement |
| `Doc/2026_05_27_Modifications_P3.md` | Journal modifications P3 (Enter/Update/Exit) |
| `Doc/2026_05_27_Modifications_P4.md` | Journal modifications P4 (Références directes) |
| `Doc/2026_05_28_Modifications_P5.md` | Journal modifications P5 (Transitions CSS) |
| `Doc/2026_05_28_Brief_P4_References_Directes.md` | Brief détaillé P4 |
| `Doc/2026_05_28_Brief_Reprise_P3.md` | Brief reprise P3 |

---

## 9. Objectif qualité : Platinium

Chaque priorité doit respecter les critères Platinium :

| Critère | Description |
|---|---|
| Code production-ready | Aucun `any`, aucun `eslint-disable`, typage strict |
| Zéro régression visuelle | Les 3 modes testés visuellement |
| Zéro dette technique | Pas de code mort, pas de duplication résiduelle |
| Performance mesurée | Métriques avant/après consignées |
| Documentation à jour | Journal des modifications dans `Doc/` |

---

## 10. État du build

**Dernier build :** ✅ Réussi
- `main.js` = 140.24 kB
- `polyfills.js` = 88.09 kB
- `styles.css` = 13.38 kB
- 0 erreur TypeScript
- Application accessible sur http://localhost:4200