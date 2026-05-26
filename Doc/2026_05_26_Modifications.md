# Journal des modifications — COP Links Visualization

**Date :** 2026-05-26
**Fichier :** 2026_05_26_Modifications.md

---

## Résumé

Correction d'un bug d'affichage : le flux électrique (animation de sélection) apparaissait « coupé » sur les liens logistiques lorsqu'un nœud sélectionné était relié au site central par à la fois un lien d'animation et un lien logistique.

Deux causes identifiées et corrigées :

1. **Chemins LOGISTICS non raccourcis à l'extrémité cible** — le chemin allait jusqu'au centre du nœud cible, passant derrière le cercle, ce qui masquait l'animation
2. **Région du filtre SVG `electric-glow` trop petite** — les pourcentages relatifs à la bounding box du chemin étaient insuffisants pour contenir le flou gaussien sur les chemins fins

---

## 1. Raccourcissement des chemins LOGISTICS à l'extrémité cible

**Fichier :** `src/app/components/graph/graph.component.ts` — méthode `computeEdgePath()`

### Problème

En mode Force, les chemins LOGISTICS étaient raccourcis uniquement à l'extrémité source (pour la flèche inversée `marker-start`), mais pas à l'extrémité cible. Le chemin allait donc du bord du cercle source jusqu'au **centre** du cercle cible, traversant le cercle visuellement.

Les chemins ANIMATION, en revanche, étaient déjà raccourcis à l'extrémité cible, donc l'animation électrique semblait se terminer naturellement au bord du cercle.

Quand un nœud R1/R2 était relié au site central par **les deux types de liens** (ex : r1-6 avec Garage Michael), l'animation sur le lien ANIMATION apparaissait fluide et naturelle, tandis que l'animation sur le lien LOGISTICS semblait « coupée » au niveau du cercle cible. Le contraste entre les deux rendait le défaut très visible.

### Solution

Ajout du raccourcissement à l'extrémité cible pour les chemins LOGISTICS, identique à celui déjà appliqué aux chemins ANIMATION. Le chemin se termine désormais au bord du cercle cible au lieu d'aller jusqu'au centre.

#### Cas single edge (total ≤ 1)

**Avant :**

```typescript
if (isLogistics) {
  const sr = NODE_RADIUS[src.type] || 22;
  const startX = sx + (dx / len) * sr;
  const startY = sy + (dy / len) * sr;
  return `M${startX},${startY}L${tx},${ty}`;
}
```

**Après :**

```typescript
if (isLogistics) {
  const sr = NODE_RADIUS[src.type] || 22;
  const startX = sx + (dx / len) * sr;
  const startY = sy + (dy / len) * sr;
  // Shorten at target end so the path doesn't go behind the target circle
  const tr = targetRadius(d.targetId);
  const ex = tx - (dx / len) * tr;
  const ey = ty - (dy / len) * tr;
  return `M${startX},${startY}L${ex},${ey}`;
}
```

#### Cas parallel edge (total > 1)

**Avant :**

```typescript
if (isLogistics) {
  const sr = NODE_RADIUS[src.type] || 22;
  const sdx = cx - sx;
  const sdy = cy - sy;
  const slen = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
  const startX = sx + (sdx / slen) * sr;
  const startY = sy + (sdy / slen) * sr;
  return `M${startX},${startY}Q${cx},${cy} ${tx},${ty}`;
}
```

**Après :**

```typescript
if (isLogistics) {
  const sr = NODE_RADIUS[src.type] || 22;
  const sdx = cx - sx;
  const sdy = cy - sy;
  const slen = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
  const startX = sx + (sdx / slen) * sr;
  const startY = sy + (sdy / slen) * sr;
  // Shorten at target end so the path doesn't go behind the target circle
  const tdx = tx - cx;
  const tdy = ty - cy;
  const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
  const tr = targetRadius(d.targetId);
  const ex = tx - (tdx / tlen) * tr;
  const ey = ty - (tdy / tlen) * tr;
  return `M${startX},${startY}Q${cx},${cy} ${ex},${ey}`;
}
```

### Résultat

| Type de lien | Avant | Après |
|---|---|---|
| **ANIMATION** | Raccourci à l'extrémité cible uniquement | Inchangé |
| **LOGISTICS** | Raccourci à l'extrémité source uniquement | Raccourci aux **deux** extrémités |

Les deux types de liens se terminent désormais au bord du cercle cible, ce qui rend l'animation électrique fluide et symétrique sur les deux types de liens.

---

## 2. Région du filtre SVG `electric-glow`

**Fichier :** `src/app/components/graph/graph.component.ts` — méthode `addArrowMarkers()`

### Problème

Le filtre SVG `electric-glow` utilisait `filterUnits="objectBoundingBox"` (valeur par défaut), où les attributs `x`, `y`, `width`, `height` sont des pourcentages relatifs à la bounding box de l'élément filtré.

Pour un chemin SVG quasi-horizontal (typique des liens entre nœuds alignés), la bounding box a une hauteur d'environ 1.5px (la largeur du trait). Avec les valeurs précédentes :

| Attribut | Valeur | Hauteur effective (bbox ≈ 1.5px) |
|---|---|---|
| `y` | `-100%` | -1.5px |
| `height` | `300%` | 4.5px |

Le `feGaussianBlur` avec `stdDeviation=5` nécessite environ 15px dans chaque direction pour un rendu complet. La région de filtre de 4.5px était largement insuffisante, ce qui clippait le glow sur les chemins fins.

### Solution

Passage à `filterUnits="userSpaceOnUse"` avec des coordonnées absolues couvrant une zone suffisante pour tout chemin dans le viewport SVG :

**Avant :**

```typescript
defs
  .append("filter")
  .attr("id", "electric-glow")
  .attr("x", "-10%")
  .attr("y", "-100%")
  .attr("width", "120%")
  .attr("height", "300%")
```

**Après :**

```typescript
defs
  .append("filter")
  .attr("id", "electric-glow")
  .attr("filterUnits", "userSpaceOnUse")
  .attr("x", "-5000")
  .attr("y", "-5000")
  .attr("width", "10000")
  .attr("height", "10000")
```

Avec `userSpaceOnUse`, les coordonnées sont dans le système de coordonnées du SVG utilisateur, indépendant de la bounding box de l'élément. La région de (-5000, -5000) à (5000, 5000) couvre largement tout chemin dans le viewport.

### Impact performance

Les navigateurs modernes n'allouent un buffer que pour la zone où l'élément filtré est réellement présent, pas pour toute la région du filtre. Une région large en `userSpaceOnUse` n'impacte donc pas les performances.

---

## Fichiers modifiés

| Fichier | Modifications |
|---|---|
| `src/app/components/graph/graph.component.ts` | Raccourcissement des chemins LOGISTICS à l'extrémité cible (méthode `computeEdgePath`) ; Région du filtre `electric-glow` en `userSpaceOnUse` (méthode `addArrowMarkers`) |