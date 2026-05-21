# Journal d'avancement — COP Links Visualization

**Date :** 2025-05-21  
**Fichier :** 2025_05_21_Avancement.md

---

## Résumé du projet

Application Angular 17 de visualisation interactive d'un graphe ego-centered des relations d'un site (COP), avec séparation visuelle entre flux d'animation (ventes) et flux logistiques. Plusieurs modes de représentation disponibles : force-directed, arborescence, radial et pack.

---

## Architecture technique

| Composant | Techno |
|---|---|
| Frontend | Angular 17 (standalone components) |
| Graph rendering | D3.js v7 (force-directed + hierarchy SVG) |
| Styling | Tailwind CSS 3 |
| Runtime | Docker + Docker Compose (Node 20 Alpine) |

---

## Structure du projet

```
CopLinksVisualization/
├── Dockerfile
├── docker-compose.yml
├── angular.json
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json / tsconfig.app.json / tsconfig.spec.json
├── Doc/
│   ├── spec.md
│   └── 2025_05_21_Avancement.md
└── src/
    ├── main.ts
    ├── index.html
    ├── styles.scss
    └── app/
        ├── main.component.ts/html/scss          → Layout (header + graph + légende)
        ├── models/
        │   └── graph.model.ts                → Node, Edge, GraphData, NodeType, EdgeType, LayoutMode, LAYOUT_MODES
        ├── services/
        │   └── graph.service.ts              → Données mock + filtrage 1-hop strict + toggles + layout mode
        └── components/
            ├── graph/
            │   └── graph.component.ts/html/scss  → Rendu D3.js SVG (4 modes)
            ├── legend/
            │   └── legend.component.ts           → Légende cliquable (filtres)
            ├── site-selector/
            │   └── site-selector.component.ts     → Dropdown sélection site
            └── layout-selector/
                └── layout-selector.component.ts   → Dropdown sélection mode de représentation
```

---

## Modes de représentation

| Mode | Label | Description |
|---|---|---|
| `force` | Force | Graphe force-directed ego-centered (mode original) |
| `tree` | Arborescence | Arbre hiérarchique horizontal (Reingold-Tilford, d3.tree) |
| `radial` | Radial | Arbre radial centré sur le site (projection polaire) |
| `pack` | Pack | Arcs groupés par type (R1 en haut, R2 en bas) |

### Structure hiérarchique (modes tree & radial)

```
SITE R3 (racine)
├── Animation (branche bleue)
│   └── R1 Île-de-France
└── Logistique (branche brune)
    ├── R1 Nantes
    ├── R2 Entrepôt Nord
    └── ...
```

---

## Fonctionnalités implémentées

### ✅ Graphe ego-centered strict (spec §2.2)

- Affichage uniquement du site sélectionné et de ses voisins directs (1-hop)
- Aucune propagation aux voisins des voisins
- Aucun graphe global

### ✅ Double typologie de liens (spec §3 & §5)

| Type | Couleur | Style | Direction |
|---|---|---|---|
| **Animation** (ventes) | `#2E2ECA` (Tertiary) | Trait plein | SITE → R1 |
| **Logistique** | `#978B7F` (Primary) | Trait pointillé `12,6` | SITE → R1/R2 |

### ✅ Nœuds — Nouvelle palette Electric

| Type | Fill | Stroke | Badge | Rayon |
|---|---|---|---|---|
| **Site R3** (centre) | `#F7FBFF` (Electric-Container) | `#4B9BF5` (Electric), 1.5px | R3, `#1C5494` (On-Electric-Container) | 30px |
| **Site R1** | `#978B7F` (Primary) | `#DEDAD5` (On-Primary), 2.5px | R1, `#DEDAD5` (On-Primary) | 22px |
| **Site R2** | `#1F1205` (On-Primary-Container) | `#DEDAD5` (On-Primary), 2.5px | R2, `#DEDAD5` (On-Primary) | 22px |

### ✅ Liens parallèles distingués

- Courbure automatique quand 2+ liens relient la même paire de nœuds
- Badge au milieu de chaque lien : **A** (bleu) ou **L** (brun)
- Flèches directionnelles aux extrémités cibles

### ✅ Légende cliquable (spec §6.4)

- Toggle Animation : affiche/masque les liens d'animation
- Toggle Logistique : affiche/masque les liens logistiques
- Les nœuds déconnectés disparaissent automatiquement du graphe

### ✅ Sélecteur de mode de représentation

- Dropdown dans le header avec 4 modes : Force, Arborescence, Radial, Pack
- Changement de mode → recalcul complet du graphe
- Le mode Force conserve le drag interactif, les autres modes sont statiques

### ✅ Interactions

| Interaction | Comportement |
|---|---|
| Hover sur lien | Tooltip : type de relation + source → target |
| Hover sur nœud | Highlight des edges liés, fade des autres |
| Click/toggle légende | Filtrage Animation / Logistique |
| Sélecteur dropdown site | Changement de site → recalcul complet du graphe |
| Sélecteur dropdown mode | Changement de mode de représentation |
| Zoom/Pan | D3 zoom avec molette + drag |
| Resize | ResizeObserver → recentrage + fit automatique |

### ✅ Responsive

- Header responsive (flex-col → flex-row sur mobile)
- Légende responsive (max-w-[280px] sm:max-w-none)
- Sélecteurs responsive (w-full sm:w-64 / w-full sm:w-48)
- Graphe SVG responsive : ResizeObserver + recentrage + fit

### ✅ Spécificités par mode

#### Mode Force (original)

- Nœud central épinglé, force-directed sur les voisins
- Drag interactif sur les nœuds voisins
- Auto-zoom à la fin de la simulation
- Badges A/L au milieu des liens

#### Mode Arborescence (tree)

- Hiérarchie SITE → Animation/Logistique → R1/R2
- Liens courbes (cubic bezier horizontal)
- Nœuds branches (Animation/Logistique) avec label coloré
- Labels R1/R2 à droite des cercles, label R3 à gauche
- Badges A/L au milieu des liens

#### Mode Radial

- Arbre radial centré sur le site (projection polaire)
- Liens courbes (quadratic bezier)
- Nœuds branches colorés
- Badges A/L au milieu des liens

#### Mode Pack

- SITE au centre, R1 en arc supérieur, R2 en arc inférieur
- Labels de zone R1/R2 en surimpression
- Badges A/L, tooltips, hover comme le mode force
- Drag désactivé (layout statique)

---

## Données mock (Site Paris)

### Volume

- **6 sites** (Paris, Lyon, Marseille, Toulouse, Bordeaux, Garage Michael)
- **20 nœuds R1** (villes françaises métropolitaines)
- **30 nœuds R2** (villes françaises métropolitaines)
- **51 liens logistiques** pour Site Paris + liens pour les autres sites
- **6 liens d'animation** (1 par site)

### Site Paris spécifiquement

- 1 lien d'animation → R1 Île-de-France
- 50 liens logistiques vers R1 et R2 couvrant les grandes villes françaises

---

## Décisions de design

### Rendu SVG (ordre Z) — Mode Force

```
1. Nœuds voisins (R1/R2)     → couche inférieure
2. Liens + badges + tooltips  → couche intermédiaire
3. Nœud central (SITE R3)    → couche supérieure (toujours visible)
```

### Raccourcissement des chemins

- Le chemin commence au centre du nœud source (caché par le cercle)
- Le chemin se termine au bord du nœud cible (flèche visible)
- Pas de raccourcissement côté source

### Simulation de force (mode Force uniquement)

- Nœud central épinglé (`fx/fy`) au centre
- Nœuds secondaires initialisés en cercle autour du centre (200px)
- `forceCollide` radius 70, strength 0.8
- `forceManyBody` strength -400
- Link distance : Animation 180px, Logistique 220px
- Drag interactif sur les nœuds voisins

### Palette de couleurs — Design System

| Token | Hex | Usage |
|---|---|---|
| **Electric** | `#4B9BF5` | SITE R3 fill border, liens flèches animation |
| **On-Electric** | `#041A33` | SITE R3 badge texte (non utilisé actuellement) |
| **Electric-Container** | `#F7FBFF` | SITE R3 fond de nœud |
| **On-Electric-Container** | `#1C5494` | SITE R3 label texte |
| Primary | `#978B7F` | SITE R1 fond, liens logistique, flèches logistique |
| On-Primary | `#DEDAD5` | Badges R1, bordures nœuds, texte badges |
| On-Primary-Container | `#1F1205` | SITE R2 fond |
| Tertiary | `#2E2ECA` | Liens animation (badge A) |
| On-Tertiary | `#FFFFFF` | Texte badges Animation |
| On-Secondary-Container | `#1A1A1A` | Labels sous les nœuds R1/R2 |

---

## Problèmes résolus

| Problème | Solution |
|---|---|
| Liens Animation/Logistique confondus | Courbure parallèle, badges A/L, épaisseur uniforme 3px |
| Flèches cachées derrière les nœuds | Raccourcissement côté cible uniquement, refX=8 |
| Nœuds collés quand 1 seul lien | Initialisation circulaire, collision radius 70, link distance augmentée |
| Liens logistiques invisibles seuls | Rendu edges APRÈS nœuds voisins mais AVANT nœud central |
| Site central passé derrière les liens | Nœud central rendu en dernier (au-dessus de tout) |
| Courbure insuffisante | Spacing passé de 30 à 65 |
| Types D3 incompatibles | Utilisation de `any` pour les sélections D3 complexes |
| Shadowing de `this` dans `.each()` | Utilisation de `const self = this` au lieu de `.bind(this)` |
| Layout modes multiples | Refonte en 4 renderers séparés (renderForceLayout, renderTreeLayout, renderRadialLayout, renderPackLayout) |
| Couleurs R3 trop similaires aux autres | Passage à la palette Electric (fond #F7FBFF, bordure #4B9BF5) |
| Labels illisibles en arborescence | Positionnement R1/R2 à droite, R3 à gauche |

---

## Commandes Docker

```bash
# Build & run
docker compose up --build -d

# Logs
docker compose logs -f

# Stop
docker compose down
```

Accès : **http://localhost:4200**