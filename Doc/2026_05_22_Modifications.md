# Journal des modifications — COP Links Visualization

**Date :** 2026-05-22  
**Fichier :** 2026_05_22_Modifications.md

---

## Résumé

Trois séries de modifications ont été apportées :

1. **Alignement des interactions** — Ajout des interactions hover (nœuds + liens) et tooltips aux modes Arborescence, Radial et Pack
2. **Gravité et drag** — Ajout de la simulation D3 (forceX/forceY) et du drag des nœuds pour les modes Pack, Arborescence et Radial
3. **Corrections** — Positionnement du nœud centre en mode Arborescence/Radial, correction du décalage drag, ajustement des forces

---

## 1. Interactions hover alignées (Arborescence, Radial, Pack)

### Problème

Seul le mode Force disposait d'interactions hover (highlight des nœuds/liens, tooltips sur les liens). Les modes Arborescence, Radial et Pack n'avaient aucune interaction au-delà du zoom/pan.

### Solution

#### Méthode partagée `addHierarchyHoverInteractions`

Ajout d'une méthode réutilisable pour les modes hiérarchiques (Arborescence et Radial) :

| Interaction | Comportement |
|---|---|
| Hover sur nœud centre | Fade tous les voisins à 25%, tous les liens restent visibles |
| Hover sur nœud feuille (R1/R2) | Highlight la chaîne ancêtres + descendants, fade le reste |
| Hover sur nœud branche (Animation/Logistique) | Highlight tout le sous-arbre de la branche |
| Hover sur lien | Tooltip avec type de relation et source → target |
| Mouseleave | Restauration de toutes les opacités |

La méthode construit des maps d'ancêtres et de descendants depuis la hiérarchie D3 pour déterminer quels éléments highlighter.

#### Attributs `data-*` sur les liens et badges

- `data-source-id` et `data-target-id` ajoutés sur chaque path de lien (modes Arborescence et Radial)
- `data-target-id` ajouté sur chaque groupe de badge (modes Arborescence et Radial)

Ces attributs permettent au hover de déterminer quels liens et badges sont connectés à un nœud donné.

#### Mode Pack

Le mode Pack disposait déjà des interactions hover complètes (`addNeighborHover`, `addCenterHover`, `addEdgeTooltip`). Aucune modification nécessaire.

### Fichier modifié

- `src/app/components/graph/graph.component.ts`

---

## 2. Gravité (simulation D3) et drag

### Problème

Seul le mode Force permettait de déplacer les nœuds et avait une simulation physique (gravité, collision). Les trois autres modes étaient statiques : positions figées, aucune interaction de mouvement.

### Solution

#### Mode Pack

| Avant | Après |
|---|---|
| Nœuds fixés par `fx`/`fy` | Nœuds attirés vers leurs positions cibles par `forceX`/`forceY` |
| Pas de drag | Drag interactif sur les nœuds voisins |
| Transitions CSS pour le changement de mode | Simulation D3 pour les transitions |
| `setupAutoZoomAndResize(..., false)` | `setupAutoZoomAndResize(..., true)` (auto-zoom après simulation) |

**Détails :**
- `fx`/`fy` supprimés des nœuds R1/R2 (seul le centre reste épinglé)
- `targetPositions` Map pour les cibles de `forceX`/`forceY`
- Simulation : `forceX`(0.1) + `forceY`(0.1) + `forceCollide`(radius 70, strength 0.8)
- Drag : `d3.drag()` avec `alphaTarget(0.3)` au start, relâche à la fin
- Tick handler : mise à jour des positions, chemins et labels

#### Modes Arborescence et Radial

| Avant | Après |
|---|---|
| Positions fixes calculées par `d3.tree()` | Simulation D3 avec gravité vers les positions cibles |
| Transitions CSS pour le changement de mode | Simulation D3 pour les transitions |
| Pas de drag | Drag interactif sur les nœuds feuilles uniquement |
| Nœuds centre non épinglés correctement | Centre épinglé à sa position de layout |

**Détails :**
- Création de `SimNode` pour le centre (épinglé) et les nœuds feuilles (libres)
- Les nœuds branches (Animation, Logistique, R1, R2) ne sont pas dans la simulation — ils restent à leurs positions de layout
- Simulation : `forceX`(0.5) + `forceY`(0.5) + `forceCollide`(radius 10, strength 0.3)
- Drag : uniquement sur les nœuds feuilles (filtrage par `leafNodeIds`)
- Drag container : élément SVG (`d3.pointer(event, svgEl)`) pour corriger le décalage avec le zoom
- Tick handler : mise à jour des positions de nœuds, chemins hiérarchiques et badges
- `targetPositions` Map pour les cibles de `forceX`/`forceY`
- `getPosition()` : lookup hybride (SimNode pour les feuilles, `targetPositions` pour les branches/centre)
- `parentMap` : map parent → enfant pour la mise à jour des badges

#### Transitions entre modes

- Les transitions CSS (`d3.transition`) ont été supprimées pour les modes Pack, Arborescence et Radial
- La simulation D3 assure désormais l'animation : les nœuds partent de leurs positions sauvegardées et sont attirés vers leurs positions cibles
- Les liens et badges sont mis à jour en temps réel pendant la simulation

### Fichier modifié

- `src/app/components/graph/graph.component.ts`

---

## 3. Corrections

### Positionnement du nœud centre (Arborescence/Radial)

**Problème :** Le nœud centre (SITE R3) était épinglé à sa position sauvegardée (potentiellement le centre de l'écran en provenance du mode Force) au lieu de sa position de layout (à gauche en arborescence).

**Correction :** 
- `fx`/`fy` = position de layout (cible)
- `x`/`y` = position sauvegardée (point de départ pour l'animation)

```typescript
// Avant (incorrect)
centerSimNode.fx = savedCenterPos ? savedCenterPos.x : centerTarget.x;
centerSimNode.fy = savedCenterPos ? savedCenterPos.y : centerTarget.y;

// Après (correct)
centerSimNode.fx = centerSimTarget ? centerSimTarget.x : width / 2;
centerSimNode.fy = centerSimTarget ? centerSimTarget.y : height / 2;
centerSimNode.x = savedCenterPos ? savedCenterPos.x : centerSimNode.fx;
centerSimNode.y = savedCenterPos ? savedCenterPos.y : centerSimNode.fy;
```

### Décalage du drag (Arborescence/Radial)

**Problème :** Le drag positionnait les nœuds loin du curseur, particulièrement avec le zoom actif.

**Correction :**
- Ajout de `.container(svgEl)` au comportement de drag pour calculer les coordonnées relativement à l'élément SVG
- Utilisation de `d3.pointer(event, svgEl)` pour obtenir les coordonnées correctes dans l'espace SVG

```typescript
// Avant (incorrect avec zoom)
sn.fx = event.x;
sn.fy = event.y;

// Après (correct)
const [mx, my] = d3.pointer(event, svgEl);
sn.fx = mx;
sn.fy = my;
```

### Ajustement des forces (Arborescence/Radial)

| Paramètre | Avant | Après | Raison |
|---|---|---|---|
| `forceX`/`forceY` strength | 0.1 | **0.5** | Les nœuds doivent rester proches de leurs positions cibles dans un layout structuré |
| `forceCollide` radius | 30 | **10** | Rayon de collision réduit pour les layouts hiérarchiques |
| `forceCollide` strength | 0.8 | **0.3** | Collision moins agressive pour préserver la structure |

---

## Tableau comparatif mis à jour

| Fonctionnalité | Force | Arborescence | Radial | Pack |
|---|:---:|:---:|:---:|:---:|
| **Simulation D3** | ✅ | ✅ | ✅ | ✅ |
| **Gravité (forceX/forceY)** | ✅ | ✅ (0.5) | ✅ (0.5) | ✅ (0.1) |
| **Collision** | ✅ (r70, s0.8) | ✅ (r10, s0.3) | ✅ (r10, s0.3) | ✅ (r70, s0.8) |
| **Drag des nœuds** | ✅ voisins | ✅ feuilles | ✅ feuilles | ✅ voisins |
| **Hover nœud centre** | ✅ | ✅ | ✅ | ✅ |
| **Hover nœud voisin** | ✅ edges liés | ✅ chaîne ancêtres+descendants | ✅ chaîne ancêtres+descendants | ✅ edges liés |
| **Hover nœud branche** | N/A | ✅ sous-arbre | ✅ sous-arbre | N/A |
| **Hover lien → Tooltip** | ✅ | ✅ | ✅ | ✅ |
| **Drag container** | défaut | SVG | SVG | défaut |
| **Transition entre modes** | simulation | simulation | simulation | simulation |
| **Centre épinglé** | ✅ | ✅ (layout position) | ✅ (layout position) | ✅ (centre écran) |