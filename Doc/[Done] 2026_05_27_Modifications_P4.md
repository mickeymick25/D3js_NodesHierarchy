# Journal des modifications — P4 : Références directes vs DOM queries

**Date :** 2026-05-27
**Fichier :** `Doc/2026_05_27_Modifications_P4.md`

---

## Résumé

Implémentation de P4 — Remplacement de toutes les traversées DOM (`selectAll`, `each(function)`, `attr("r")`) dans `SelectionService.applyNodeSelection()` et les hover handlers par des lookups O(1) via des Maps de références D3 (`ElementRefs`).

---

## 1. Nouveau modèle : `ElementRefs`

**Fichier :** `src/app/models/element-refs.ts` (nouveau)

```typescript
class ElementRefs {
  nodeGroupMap: Map<string, Selection<SVGGElement>>      // clé = nodeId
  edgePathMap: Map<string, Selection<SVGPathElement>>     // clé = sourceId|targetId|edgeType
  badgeGroupMap: Map<string, Selection<SVGGElement>>       // Force: sourceId|targetId|edgeType, Hierarchy: targetId
  electricPaths: Selection<SVGPathElement>[]               // paths animés par le courant électrique
  clear(): void
}
```

Cycle de vie :
- **`fullRebuild()`** → `elementRefs.clear()` avant `renderGraph()`
- **`renderGraph()`** → `elementRefs.clear()` avant chaque render
- **`incrementalUpdate()` (Force)** → Maps mises à jour via `ForceLayoutService.update()`
- **Changement de layout** → `elementRefs.clear()` implicite via `fullRebuild()`

---

## 2. Étape 1 — Classes CSS `.inner-circle` / `.halo-circle`

**Fichiers modifiés :**
- `src/app/services/layout/force-layout.service.ts` — `drawNodeCircles()` : `attr("class", "inner-circle")` et `attr("class", "halo-circle")`
- `src/app/services/layout/hierarchy-layout.service.ts` — `drawNodes()` : idem pour root et leaf nodes
- `src/app/services/selection.service.ts` — Remplacement de `circles.filter(function() { const r = select(this).attr("r"); return r === "30" || r === "22"; })` par `nodeGroup.select("circle.inner-circle")` et `.select("circle.halo-circle")`

**Avant :**
```typescript
const circles = nodeGroup.selectAll("circle");
const innerCircle = circles.filter(function() {
  const r = select(this).attr("r");
  return r === "30" || r === "22";
});
```

**Après :**
```typescript
const innerCircle = nodeGroup.select("circle.inner-circle");
```

---

## 3. Étape 2 — Maps de références dans les services de layout

**Fichiers modifiés :**
- `src/app/services/layout/force-layout.service.ts` :
  - `ForceRenderContext` : ajout de `elementRefs: ElementRefs`
  - `render()` : peuple `nodeGroupMap`, `edgePathMap`, `badgeGroupMap`
  - `update()` : peuple les Maps après data-join
- `src/app/services/layout/hierarchy-layout.service.ts` :
  - `HierarchyRenderContext` : ajout de `elementRefs: ElementRefs`
  - `render()` : peuple `nodeGroupMap`, `edgePathMap`, `badgeGroupMap`
- `src/app/components/graph/graph.component.ts` :
  - Instancie `private readonly elementRefs = new ElementRefs()`
  - Passe `elementRefs` à tous les appels de render/update
  - `fullRebuild()` et `renderGraph()` : `elementRefs.clear()`

---

## 4. Étape 3 — Réécriture de `SelectionService` avec Maps

**Fichier :** `src/app/services/selection.service.ts`

### `SelectionContext` — ajout de `elementRefs: ElementRefs`

### `applyNodeSelection()` — Avant vs Après

| Opération | Avant (DOM traversal) | Après (Map lookup) |
|---|---|---|
| Nœuds | `g.selectAll("[data-node-id]").each(...)` | `for (const [nodeId, nodeGroup] of elementRefs.nodeGroupMap)` |
| Arêtes | `g.selectAll(".edges path, .tree-links path").each(...)` | `for (const [key, pathEl] of elementRefs.edgePathMap)` |
| Badges Force | `g.selectAll(".edge-labels g").each(...)` | `for (const [key, badgeEl] of elementRefs.badgeGroupMap)` |
| Badges Hierarchy | `g.selectAll(".link-badges g").each(...)` | `for (const [targetId, badgeG] of elementRefs.badgeGroupMap)` |
| Cercle intérieur | `circles.filter(function() { attr("r") === "30" })` | `nodeGroup.select("circle.inner-circle")` |
| Halo | `circles.filter(function() { attr("r") === "34" })` | `nodeGroup.select("circle.halo-circle")` |
| Animation électrique | `g.selectAll("...path").filter(".electric-current")` | `for (const [, pathEl] of elementRefs.edgePathMap) { if (pathEl.classed("electric-current")) ... }` |

### `startElectricAnimation()` — Avant vs Après

| Avant | Après |
|---|---|
| `g.selectAll("...path").filter(".electric-current")` | Collecte depuis `edgePathMap` + stockage dans `elementRefs.electricPaths` |
| `animatedPaths.attr(...)` en une seule sélection D3 | Boucle `for (const pathEl of electricPaths)` |

### `stopElectricAnimation()` — Avant vs Après

| Avant | Après |
|---|---|
| `g.selectAll("...path").attr(stroke-dasharray, null, ...)` | Boucle sur `elementRefs.electricPaths` |

### Import `select` supprimé

L'import `select` de `d3-selection` n'est plus nécessaire dans `selection.service.ts` (plus aucun `selectAll`/`each(function)`).

---

## 5. Hover handlers — Extension avec ElementRefs

### `ForceLayoutService`

- `addNeighborHover()` : signature mise à jour pour recevoir `ElementRefs` au lieu des sélections D3 directes. Itère sur `nodeGroupMap`, `edgePathMap`, `badgeGroupMap`.
- `addCenterHover()` : idem.

### `HierarchyLayoutService`

- `addHoverInteractions()` : utilise `elementRefs` du contexte pour les opérations hover/mouseleave au lieu de `nodeGroups.interrupt()` + `linkPathSelection.interrupt()`.

---

## 6. Fichiers modifiés (résumé)

| Fichier | Modifications |
|---|---|
| `src/app/models/element-refs.ts` | **Nouveau** — Classe `ElementRefs` avec `nodeGroupMap`, `edgePathMap`, `badgeGroupMap`, `electricPaths` |
| `src/app/services/selection.service.ts` | Réécriture complète avec Maps O(1). Suppression de `selectAll`, `each(function)`, `attr("r")`. Ajout `elementRefs` au contexte. |
| `src/app/services/layout/force-layout.service.ts` | Ajout `elementRefs` au contexte. Population des Maps dans `render()` et `update()`. Classes CSS `.inner-circle`/`.halo-circle`. Hover handlers avec Maps. |
| `src/app/services/layout/hierarchy-layout.service.ts` | Ajout `elementRefs` au contexte. Population des Maps dans `render()`. Classes CSS. Hover handlers avec Maps. |
| `src/app/components/graph/graph.component.ts` | Instanciation de `ElementRefs`, passage aux 3 layout services et à `SelectionService`. `clear()` dans `fullRebuild()` et `renderGraph()`. Mise à jour `stopElectricAnimation(g, elementRefs)`. |

---

## 7. Critères Platinium — Validation

| Critère | Statut |
|---|---|
| Code production-ready | ✅ Zéro `any`, typage strict sur les Maps |
| Zéro régression visuelle | ⬜ À tester visuellement (3 modes : Force, Arborescence, Dendrogramme) |
| Performance mesurable | ✅ `applyNodeSelection()` ne contient plus aucun `selectAll` ni `each(function)` de traversée DOM |
| Maps cohérentes | ✅ Vérifié : clear dans `fullRebuild()`, `renderGraph()`, population dans `render()` et `update()` |
| Documentation à jour | ✅ Ce document |

---

## 8. Étape 4 — Nettoyage `data-*` attributes (non implémentée)

Les attributs `data-source-id`, `data-target-id`, `data-edge-type` sont conservés car :
- `data-node-id` et `data-real-id` sont encore utilisés par `saveNodePositions()`
- `data-target-id` et `data-edge-type` sont lus dans `HierarchyLayoutService` tick handler (badge positions) et dans `SelectionService` (branch reset, badge color reset)
- Utiles pour le debug visuel dans les DevTools

**Décision :** Conservation des `data-*` attributes pour le moment. La suppression complète nécessiterait de remplacer aussi les lectures dans le tick handler et `saveNodePositions()`.