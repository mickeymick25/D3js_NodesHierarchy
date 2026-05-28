# Journal des modifications — COP Links Visualization

**Date :** 2025-05-21  
**Fichier :** 2025_05_21_Modifications.md

---

## 1. Labels R1/R2 en mode Arborescence — Positionnement à droite

**Fichier :** `src/app/components/graph/graph.component.ts`

Les labels des nœuds R1/R2 en mode arborescence étaient positionnés sous les cercles (`dy: radius + 16`, `text-anchor: middle`). Ils sont désormais positionnés à droite des cercles :

```typescript
// Avant
.attr("dy", radius + 16)
.attr("text-anchor", "middle")

// Après
.attr("dy", "0.35em")
.attr("text-anchor", "start")
.attr("x", radius + 8)
```

---

## 2. Tags Animation/Logistique au-dessus des liens — Mode Arborescence

**Fichier :** `src/app/components/graph/graph.component.ts`

Les rectangles de labels "Animation" et "Logistique" avaient un fond semi-transparent (`fill-opacity: 0.15`) qui laissait les liens SVG apparaître à travers. Ajout d'un rectangle de fond blanc opaque derrière chaque label pour masquer les liens qui passent dessous :

```typescript
// Fond blanc opaque (ajouté avant le rectangle coloré)
g.append("rect")
  .attr("rx", 6).attr("ry", 6)
  .attr("width", 100).attr("height", 28)
  .attr("x", -50).attr("y", -14)
  .attr("fill", "white");

// Rectangle coloré semi-transparent (existant)
g.append("rect")
  .attr("fill", isAnimation ? self.COLOR_TERTIARY : self.COLOR_PRIMARY)
  .attr("fill-opacity", 0.15)
  // ...
```

---

## 3. Initialisation Git et push GitHub

**Repo :** `git@github.com:mickeymick25/D3js_NodesHierarchy.git`

- Initialisation du dépôt Git
- `.gitignore` existant (node_modules, dist, .angular, IDE, OS)
- Commit initial avec 26 fichiers
- Branche `main` poussée sur GitHub

---

## 4. Transitions fluides entre modes de représentation

**Fichier :** `src/app/components/graph/graph.component.ts`

### Problème
Chaque changement de mode détruisait et recréait l'intégralité du SVG, causant un flash visuel complet.

### Solution
Le conteneur SVG persiste désormais entre les changements de mode. Seuls les éléments internes sont remplacés, avec des transitions animées.

### Changements architecturaux

| Élément | Avant | Après |
|---|---|---|
| SVG | Recréé à chaque rendu | Persistant (créé une fois) |
| Zoom | Recréé à chaque rendu | Persistant |
| `ngOnChanges` | Appelait `renderGraph()` pour tout | Différencie données vs layout |
| Positions des nœuds | Perdues entre les rendus | Sauvegardées via `savedPositions` |

### Nouvelles propriétés et méthodes

```typescript
// État persistant
private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
private g: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
private zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;
private savedPositions = new Map<string, { x: number; y: number }>();
private readonly TRANSITION_MS = 600;

// Nouvelles méthodes
private initSvg(): void          // Crée SVG, zoom, defs (une seule fois)
private destroySvg(): void       // Détruit complètement le SVG
private stopSimulation(): void   // Arrête la simulation D3
private saveNodePositions(): void // Extrait les positions depuis le SVG
private getSavedPosition(): void  // Position sauvegardée ou position par défaut
```

### Cycle de vie différencié

- **Changement de site (graphData)** → `destroySvg()` + réinitialisation complète
- **Changement de mode (layoutMode)** → `saveNodePositions()` + transition fluide

### Transitions par mode

| Mode | Comportement |
|---|---|
| **Force** | Nœuds démarrés aux positions sauvegardées, simulation D3 anime vers l'équilibre |
| **Arborescence** | Nœuds partent des positions sauvegardées → transition 600ms vers positions cibles |

Les liens SVG apparaissent en fondu (opacity 0 → 1) pendant la seconde moitié de la transition.

### Attribut `data-node-id`

Ajouté sur tous les groupes de nœuds (force, tree) pour permettre le suivi des positions :

```typescript
.attr("data-node-id", (d) => d.id)       // Force
.attr("data-node-id", (d: any) => d.data.id)  // Tree
```

---

## 5. Liens logistique en ligne continue

**Fichiers :** `graph.component.ts`, `legend.component.ts`

Suppression du style pointillé (`stroke-dasharray`) sur les liens logistique dans les 3 emplacements :

| Mode | Avant | Après |
|---|---|---|
| Force (`createEdgePaths`) | `stroke-dasharray: "12,6"` pour LOGISTICS | Ligne continue |
| Arborescence | `stroke-dasharray: "8,4"` pour LOGISTICS | Ligne continue |

**Légende** : Le trait pointillé (`border-t-2 border-dashed`) est remplacé par une ligne pleine (`h-0.5 rounded-full`) avec `background-color` au lieu de `border-color`.

La distinction entre Animation et Logistique repose désormais uniquement sur la couleur et les badges A/L.

---

## 6. Épaisseur des liens réduite

**Fichier :** `graph.component.ts`

| Mode | Avant | Après |
|---|---|---|
| Force | `stroke-width: 3` | `stroke-width: 1.5` |
| Arborescence | `stroke-width: 2.5` | `stroke-width: 1.5` |

Les épaisseurs de contour des nœuds (`stroke-width: 2.5` pour R1/R2, `1.5` pour SITE) sont inchangées.

---

## 7. Direction des flèches logistique inversée

**Fichier :** `graph.component.ts`

### Problème
Les flèches logistique pointaient du SITE vers R1/R2 (même direction que l'animation). Or, ce sont les sites R1/R2 qui alimentent le site R3.

### Solution

#### Nouveau marqueur SVG inversé

```typescript
// Flèche pointant vers la gauche (vers la source du chemin)
defs.append("marker")
  .attr("id", "arrow-logistics-rev")
  .attr("viewBox", "0 -5 10 10")
  .attr("refX", 2)
  .attr("refY", 0)
  .attr("markerWidth", 7)
  .attr("markerHeight", 7)
  .attr("orient", "auto")
  .append("path")
  .attr("d", "M8,-4L0,0L8,4")  // Triangle inversé ◄
  .attr("fill", this.COLOR_PRIMARY);
```

#### Marqueurs par type de lien

| Type | Marqueur | Position | Direction |
|---|---|---|---|
| Animation | `arrow-animation` | `marker-end` | SITE → R1 |
| Logistique | `arrow-logistics-rev` | `marker-start` | R1/R2 → SITE |

#### Raccourcissement des chemins

`computeEdgePath` différencie désormais le raccourcissement selon le type :

- **Animation** : raccourci à l'extrémité cible (R1/R2), flèche à `marker-end`
- **Logistique** : raccourci à l'extrémité source (SITE), flèche à `marker-start`

#### Tooltip inversé

Pour les liens logistique, le tooltip affiche la direction physique :

```
// Animation : "Animation (Ventes): Site Paris → R1 Île-de-France"
// Logistique : "Logistique: R1 Nantes → Site Paris"
```

---

## 8. Séparation R1/R2 dans le mode Force

**Fichier :** `graph.component.ts`

### Initialisation des positions

| Type | Côté | Plage d'angles | Position cible forceX |
|---|---|---|---|
| R1 | Gauche | 2π/3 à 4π/3 (arc ~126°) | `width/2 - 120` |
| R2 | Droite | -π/3 à π/3 (arc ~126°) | `width/2 + 120` |
| SITE | Centre | — | `width/2` (épinglé) |

### Force de séparation

Ajout d'une `forceX` douce (strength 0.08) qui maintient la séparation R1/R2 pendant la simulation :

```typescript
.force("x", d3.forceX<SimNode>((d) => {
  if (d.type === "R1") return width / 2 - 120;
  if (d.type === "R2") return width / 2 + 120;
  return width / 2;
}).strength(0.08))
```

Les nœuds restent draggables et la simulation continue de fonctionner, mais la séparation est maintenue de façon souple.