# Journal des modifications — COP Links Visualization

**Date :** 2026-05-27
**Fichier :** `Doc/2026_05_27_Modifications_P3.md`

---

## Résumé

Implémentation de P3 — Enter/Update/Exit D3 (rendu incrémental) pour le mode Force. Les changements de filtre (Animation/Logistique) déclenchent désormais une mise à jour incrémentale au lieu d'une destruction et recréation complète du SVG.

---

## 1. Détection des changements incrémentaux dans `GraphComponent`

**Fichier :** `src/app/components/graph/graph.component.ts`

### `ngOnChanges()` — Différenciation site change vs data change

| Changement détecté | Comportement |
|---|---|
| `graphData` change, centre différent | `fullRebuild()` — destruction SVG + recréation complète |
| `graphData` change, même centre | `incrementalUpdate()` — mise à jour incrémentale |
| `layoutMode` change | Comportement inchangé (sauvegarde positions + render) |
| `selectedNodeIdBySearch` change | Comportement inchangé (sélection/désélection) |

### Nouvelles méthodes

| Méthode | Rôle |
|---|---|
| `fullRebuild()` | Extraction de la logique existante de `ngOnChanges` — destroy SVG, clear caches, render |
| `incrementalUpdate()` | Stop animation + simulation, route vers `updateForceLayout()` ou full re-render (hiérarchie) |
| `updateForceLayout()` | Appelle `forceLayout.update()` ; si retour `null`, fallback vers `renderGraph()` |

### `incrementalUpdate()` — Comportement par layout

| Layout | Comportement |
|---|---|
| `force` | `updateForceLayout()` → data join incrémental |
| `tree` / `dendrogram` | Sauvegarde positions, clear contenu SVG, re-render complet (amélioration future) |

---

## 2. Méthode `update()` dans `ForceLayoutService`

**Fichier :** `src/app/services/layout/force-layout.service.ts`

### Principe

Au lieu de détruire et recréer tout le SVG, la méthode `update()` utilise le pattern Enter/Update/Exit de D3 pour ne modifier que les éléments qui ont changé.

### Étapes de la méthode

| Étape | Description |
|---|---|
| 1. Vérification | Vérifie l'existence des groupes SVG (`.neighbor-nodes`, `.edges`, `.edge-labels`). Si absents, retourne `null` (fallback vers `render()`) |
| 2. Lecture positions | Lit les positions actuelles des nœuds depuis le DOM via `data-node-id` et `transform` |
| 3. Calcul simNodes | Crée les nouveaux `SimNode` à partir du `graphData` mis à jour |
| 4. Calcul simLinks | Crée les nouveaux `SimLink` à partir du `graphData` mis à jour |
| 5. Positions initiales | Préserve les positions des nœuds existants (depuis le DOM). Positionne les nouveaux nœuds en arc (R1 gauche, R2 droite) |
| 6. Comptage parallèle | Calcule les indices d'arêtes parallèles |
| 7. Data-join nœuds | Clé = `d.id`. Exit → remove, Enter → `drawNodeCircles()`, Update → conserve |
| 8. Data-join arêtes | Clé = `sourceId\|targetId\|edgeType`. Exit → remove, Enter → attributs SVG, Update → mise à jour attributs |
| 9. Data-join labels | Même clé. Exit → remove, Enter → rect + text, Update → texte + couleurs |
| 10. Tooltips | Clear du groupe `.link-labels` |
| 11. Nœud central | Mise à jour du datum et de la position du nœud `.center-node` existant |
| 12. Drag | Appliqué à tous les nœuds voisins (merge enter + update) |
| 13. Hover/Click | Réappliqué à tous les éléments (merge enter + update) |
| 14. Chemins | Calcul initial des `d` attributes |
| 15. Positions initiales | Positionnement des nœuds et arêtes |
| 16. Tick handler | Utilise des sélections fraîches depuis le DOM à chaque tick |
| 17. Auto-zoom | Configuration identique à `render()` |

### Gains attendus

| Métrique | Avant (full rebuild) | Après (incremental update) |
|---|---|---|
| Créations DOM pour toggle filtre | ~100+ éléments | Uniquement les éléments ajoutés/supprimés |
| Transitions visuelles | Flash (destroy + recreate) | Transition fluide (enter/update/exit) |
| Positions des nœuds | Réinitialisées | Préservées depuis le DOM |
| Simulation | Recréée de zéro | Recréée avec positions existantes |

---

## 3. Fallback vers full render

Si `update()` retourne `null` (groupes SVG absents), le composant appelle `renderGraph()` qui effectue un full rebuild. Cela garantit qu'aucun cas ne casse l'affichage.

Cas de fallback :
- Premier rendu (les groupes SVG n'existent pas encore)
- Corruption inattendue du DOM
- Changement de layout mode (géré séparément par `renderGraph()`)

---

## 4. Layouts hiérarchiques — Statut

Les modes Arborescence et Dendrogramme utilisent toujours un full re-render pour les changements de filtre. L'implémentation du pattern Enter/Update/Exit pour ces layouts est prévue dans une itération future.

Pour ces layouts, `incrementalUpdate()` effectue :
1. Sauvegarde des positions
2. Clear du contenu SVG (`g.selectAll("*").remove()`)
3. Recréation des defs/markers
4. Appel à `renderGraph()`

---

## 5. Fichiers modifiés

| Fichier | Modifications |
|---|---|
| `src/app/components/graph/graph.component.ts` | `ngOnChanges()` différencie site change vs data change. Ajout de `fullRebuild()`, `incrementalUpdate()`, `updateForceLayout()` |
| `src/app/services/layout/force-layout.service.ts` | Ajout de la méthode `update()` avec pattern Enter/Update/Exit D3 |

---

## 6. Bug connu — Désélection de nœud impossible après sélection

### Problème

Après clic sur un nœud R1/R2 pour le sélectionner (effet électrique), un second clic sur le même nœud ne désélectionne plus le nœud. La désélection fonctionne uniquement via la recherche SIGMPR (bouton ✕).

### Cause probable

Le handler de clic sur les nœuds voisins est réappliqué dans `ForceLayoutService.update()` via `allNeighborNodes.on("click", ...)`. Or, dans le `render()`, le handler utilise `ctx.selectedNodeId` pour déterminer si le nœud est déjà sélectionné et toggle la sélection :

```typescript
neighborNodes.on("click", (_event: MouseEvent, d: SimNode) => {
  if (d.type === "R1" || d.type === "R2") {
    ctx.onNodeSelect(ctx.selectedNodeId === d.id ? null : d.id);
  }
});
```

Le problème est que `ctx.selectedNodeId` est la valeur au moment de la création du handler. Après une mise à jour incrémentale, le handler est réappliqué avec la valeur de `selectedNodeId` au moment de l'update, mais cette valeur peut ne pas refléter l'état actuel de la sélection (qui est gérée par le composant parent). Le handler capturé la référence `ctx.selectedNodeId` qui est figée dans la closure.

### Solution à implémenter

Le handler de clic doit accéder à l'état de sélection actuel plutôt que de capturer `selectedNodeId` dans la closure. Deux options :

1. **Utiliser une closure dynamique** : Le handler devrait lire `selectedNodeId` depuis le composant (via le callback `onNodeSelect`) au lieu de le capturer.
2. **Réappliquer les handlers après sélection** : Après `applyNodeSelection()`, réappliquer le handler de clic avec la valeur mise à jour de `selectedNodeId`.

Ce bug n'existait pas avant P3 car le handler était recréé à chaque render complet.

### Workaround temporaire

Utiliser la recherche SIGMPR pour désélectionner un nœud (bouton ✕), ou basculer le layout (Force → Tree → Force) qui déclenche un full rebuild.

---

## 7. Critères Platinium — Validation

| Critère | Statut |
|---|---|
| Code production-ready | ⬜ Bugs connus à corriger (désélection nœud) |
| Zéro régression visuelle | ⚠️ Régression : désélection de nœud impossible après clic |
| Zéro dette technique | ⬜ Duplication de code entre `render()` et `update()` — à évaluer |
| Performance mesurée | ⬜ À mesurer |
| Documentation à jour | ✅ Ce document |
| Build OK | ✅ Docker build réussi, 0 erreur TypeScript |