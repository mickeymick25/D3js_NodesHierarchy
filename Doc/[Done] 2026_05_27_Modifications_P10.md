# P10 — Pré-calcul des badges (remplacement de getBBox)

**Date :** 2026-05-27
**Statut :** ✅ Terminé

---

## Problème

`getBBox()` force un layout synchrone du navigateur (reflow). Appelé ~100 fois pour un site avec 50 liens lors du rendu initial, et **~50 fois par tick de simulation** dans `updateEdgeLabelsForce()`. C'est le goulot de performance principal.

## Solution retenue

**Pré-calcul des dimensions via canvas `measureText()`** avec cache.

Principe : remplacer chaque appel `getBBox()` par un calcul mathématique basé sur la largeur mesurée via un canvas hors-écran. Les résultats sont cachés par clé `(fontWeight|fontSize|text)`.

### Fichier ajouté

- `src/app/models/text-measurer.ts` — Utilitaire de mesure de texte (canvas + cache)

### Fonctions exportées

| Fonction | Usage | Text-anchor |
|---|---|---|
| `measureText(text, fontSize, fontWeight)` | Mesure basique, retourne `{width, height}` | — |
| `computeCenteredBadgeRect(text, fontSize, fontWeight, paddingX, paddingY)` | Badges edge labels (Force + Hierarchy) | `middle` |
| `computeCenteredTagRect(text, fontSize, fontWeight, textX, textY, paddingX, paddingY)` | Tags SIGMPR (Force + Dendrogram) | `middle` à position |
| `computeStartAnchorTagRect(text, fontSize, fontWeight, textX, textY, paddingX, paddingY)` | Tags SIGMPR (Tree) | `start` à position |

## Changements par fichier

### `force-layout.service.ts`

| Méthode | Avant | Après |
|---|---|---|
| `drawNodeCircles()` | `getBBox()` sur SIGMPR tags | `computeCenteredTagRect()` |
| `updateEdgeLabelsForce()` | `getBBox()` par tick de simulation | `computeCenteredBadgeRect()` (cache O(1)) |
| `addEdgeTooltip()` | `getBBox()` | **Conservé** (chemin froid : hover only) |

**Impact critique :** `updateEdgeLabelsForce()` est appelé à chaque tick de simulation (~60x/sec). Remplacer `getBBox()` par un lookup cache élimine les reflows synchrones dans la boucle de simulation.

### `hierarchy-layout.service.ts`

| Méthode | Avant | Après |
|---|---|---|
| `drawLinkBadges()` | `getBBox()` sur chaque badge | `computeCenteredBadgeRect()` |
| `drawNodes()` (tree SIGMPR) | `getBBox()` | `computeStartAnchorTagRect()` |
| `drawNodes()` (dendrogram SIGMPR) | `getBBox()` | `computeCenteredTagRect()` |
| `addHoverInteractions()` | `getBBox()` | **Conservé** (chemin froid : hover only) |

### `svg-builder.service.ts`

| Méthode | Statut |
|---|---|
| `setupAutoZoomAndResize()` | **Conservé** — `getBBox()` sur le groupe `<g>` complet (nécessaire pour le zoom) |

## Résumé des appels getBBox restants

| Emplacement | Contexte | Justification |
|---|---|---|
| `addEdgeTooltip()` (Force) | Hover | Chemin froid, 1 appel |
| `addHoverInteractions()` (Hierarchy) | Hover | Chemin froid, 1 appel |
| `setupAutoZoomAndResize()` (SvgBuilder) | Auto-zoom | Mesure du groupe complet, nécessaire |

## Build

- `main.js` = 142.05 kB (inchangé par rapport à P9)
- 0 erreur TypeScript
- Application fonctionnelle sur http://localhost:4200