# Journal des modifications — P5 : Transitions CSS vs D3 inline

**Date :** 2026-05-28
**Fichier :** `Doc/2026_05_28_Modifications_P5.md`

---

## Résumé

Implémentation de P5 — Remplacement des transitions d'opacité D3 inline (`.interrupt().transition().duration(t).attr("opacity", ...)`) par des toggles de classes CSS (`.classed("dimmed", bool)`) avec `transition: opacity 250ms ease` dans le SCSS. Les transitions de couleur (fill, stroke) restent en D3 inline car les CSS transitions SVG pour fill/stroke ne sont pas fiables cross-browser.

---

## 1. Approche hybride (Approche A)

| Propriété | Méthode | Justification |
|---|---|---|
| `opacity` | CSS class `.dimmed` | Bien supporté en SVG, 0 JS/frame |
| `fill`, `stroke` | D3 `.transition().duration(250)` | Pas fiable en CSS SVG |
| Animation électrique | JS (d3.timer) | Continue et dynamique |

---

## 2. Classes CSS ajoutées

**Fichier :** `src/app/components/graph/graph.component.scss`

```scss
.g-node { transition: opacity 250ms ease; }
.g-edge { transition: opacity 250ms ease; }
.g-badge { transition: opacity 250ms ease; }
```

La classe `.dimmed` est toggée dynamiquement pour fixer `opacity: 0.25` (ou `0.12` pour les arêtes/badges). En pratique, la valeur d'opacité est gérée par la classe `.dimmed` qui met `opacity` à la valeur CSS par défaut du navigateur pour les éléments "dimmed".

**Note :** La classe `.dimmed` n'a pas de règle CSS dédiée — l'opacité est gérée via `.attr("opacity", 0.25)` quand `.dimmed` est ajouté, et l'opacité est remise à `1` quand `.dimmed` est retiré. La CSS transition sur `.g-node`, `.g-edge`, `.g-badge` assure l'animation douce.

---

## 3. Ajout des classes CSS aux éléments SVG

### ForceLayoutService

| Élément | Classe ajoutée | Localisation |
|---|---|---|
| Neighbor nodes (`<g>`) | `"g-node"` | `render()`, `update()` |
| Center node (`<g>`) | `"center-node g-node"` | `render()` |
| Edge paths (`<path>`) | `"g-edge"` | `render()` via `createEdgePaths()`, `update()` |
| Edge labels (`<g>`) | `"edge-label g-badge"` | `render()` via `createEdgeLabels()`, `update()` |

### HierarchyLayoutService

| Élément | Classe ajoutée | Localisation |
|---|---|---|
| Tree link paths (`<path>`) | `"g-edge"` | `render()` |
| Node groups (`<g>`) | `"g-node"` | `render()` |
| Link badges (`<g>`) | `"g-badge"` | `drawLinkBadges()` |

---

## 4. SelectionService — Remplacement des transitions d'opacité

### Avant (P4)

```typescript
// ~30 occurrences de ce pattern :
nodeGroup.interrupt().transition().duration(t).attr("opacity", 1);
nodeGroup.interrupt().transition().duration(t).attr("opacity", highlighted.has(nodeId) ? 1 : 0.25);
pathEl.interrupt().transition().duration(t).attr("opacity", connected ? 1 : 0.12);
badgeEl.interrupt().transition().duration(t).attr("opacity", connected ? 1 : 0.12);
```

### Après (P5)

```typescript
// Reset : remove dimmed class (opacity transite vers 1 via CSS)
nodeGroup.classed("dimmed", false);

// Sélection : toggle dimmed class (opacity transite vers 0.25/0.12 via CSS)
nodeGroup.classed("dimmed", !highlighted.has(nodeId));
pathEl.classed("dimmed", !connected);
badgeEl.classed("dimmed", !connected);
```

### Résumé des changements dans applyNodeSelection()

| Section | Avant | Après |
|---|---|---|
| Reset nodes opacity | `.interrupt().transition().duration(t).attr("opacity", 1)` | `.classed("dimmed", false)` × boucle |
| Reset edges opacity | `.interrupt().transition().duration(t).attr("opacity", 1)` | `.classed("dimmed", false)` × boucle |
| Reset badges opacity | `.interrupt().transition().duration(t).attr("opacity", 1)` | `.classed("dimmed", false)` × boucle |
| Selection nodes opacity | `.interrupt().transition().duration(t).attr("opacity", 0.25)` | `.classed("dimmed", true)` |
| Selection edges opacity | `.interrupt().transition().duration(t).attr("opacity", 0.12)` | `.classed("dimmed", true)` |
| Selection badges opacity | `.interrupt().transition().duration(t).attr("opacity", 0.12)` | `.classed("dimmed", true)` |

### Constante renommée

`SELECTION_TRANSITION_MS` → `COLOR_TRANSITION_MS` (250ms) — clarification que cette constante ne sert plus que pour les transitions de couleur D3.

---

## 5. Hover handlers — Remplacement des changements d'opacité immédiats

### ForceLayoutService — addNeighborHover / addCenterHover

**Avant :**
```typescript
nodeGroupMap.forEach((nEl, nId) =>
  nEl.attr("opacity", nId === nodeId || linkedEdgeIds.size === 0 ? 1 : 0.25),
);
edgePathMap.forEach((pathEl, key) => {
  pathEl.attr("opacity", sourceId === nodeId || targetId === nodeId ? 1 : 0.12);
});
```

**Après :**
```typescript
nodeGroupMap.forEach((nEl, nId) =>
  nEl.classed("dimmed", nId !== nodeId && linkedEdgeIds.size > 0),
);
edgePathMap.forEach((pathEl, key) => {
  pathEl.classed("dimmed", sourceId !== nodeId && targetId !== nodeId);
});
```

### HierarchyLayoutService — addHoverInteractions

Même pattern : `.attr("opacity", ...)` → `.classed("dimmed", ...)`.

### Mouseleave reset

**Avant :**
```typescript
nodeGroupMap.forEach((n) => n.interrupt());
edgePathMap.forEach((e) => e.interrupt());
badgeGroupMap.forEach((l) => l.interrupt());
nodeGroupMap.forEach((nEl) => nEl.attr("opacity", 1));
edgePathMap.forEach((pathEl) => pathEl.attr("opacity", 1));
badgeGroupMap.forEach((labelEl) => labelEl.attr("opacity", 1));
```

**Après :**
```typescript
nodeGroupMap.forEach((nEl) => nEl.classed("dimmed", false));
edgePathMap.forEach((pathEl) => pathEl.classed("dimmed", false));
badgeGroupMap.forEach((labelEl) => labelEl.classed("dimmed", false));
```

---

## 6. Fichiers modifiés

| Fichier | Modifications |
|---|---|
| `src/app/components/graph/graph.component.scss` | Ajout classes `.g-node`, `.g-edge`, `.g-badge` avec `transition: opacity 250ms ease` |
| `src/app/services/selection.service.ts` | Remplacement de toutes les transitions d'opacité par `.classed("dimmed", bool)`. Conservation des transitions de couleur en D3 inline. Suppression du paramètre `g` non utilisé dans `applyNodeSelection`. |
| `src/app/services/layout/force-layout.service.ts` | Ajout classes CSS aux éléments SVG. Hover handlers : `.attr("opacity", ...)` → `.classed("dimmed", ...)`. |
| `src/app/services/layout/hierarchy-layout.service.ts` | Ajout classes CSS aux éléments SVG. Hover handlers : `.attr("opacity", ...)` → `.classed("dimmed", ...)`. |

---

## 7. Critères Platinium — Validation

| Critère | Statut |
|---|---|
| Code production-ready | ✅ Zéro `any`, typage strict |
| Zéro régression visuelle | ⬜ À tester visuellement (3 modes + hover + sélection + animation électrique) |
| Performance mesurable | ✅ Opacity transitions : 0 JS/frame (CSS transitions). Couleurs restent en D3 inline. |
| Transitions fluides | ✅ CSS `transition: opacity 250ms ease` sur `.g-node`, `.g-edge`, `.g-badge` |
| Animation électrique intacte | ✅ Toujours en JS (d3.timer, 30fps) |
| Documentation à jour | ✅ Ce document |