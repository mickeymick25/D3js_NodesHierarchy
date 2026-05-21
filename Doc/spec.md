📌 SPEC — Site Relationship Graph (COP)
1. Objectif

Fournir une visualisation interactive des relations d’un site sous forme de graphe, permettant de distinguer clairement :

les flux d’animation (ventes)
les flux logistiques

Le composant est destiné à une page profile site et ne montre que les relations directes du site sélectionné.

2. Périmètre fonctionnel
2.1 Vue unique
La vue est toujours centrée sur un site sélectionné
Aucun autre mode de navigation globale n’est inclus
2.2 Règle de visibilité (STRICTE)

Le graphe affiche uniquement :

le site courant
ses voisins directs (1-hop)
Interdictions :
❌ pas de voisins des voisins
❌ pas de propagation des relations R1/R2/R3
❌ pas de clustering global
❌ pas de vue réseau complète
3. Modèle de données
3.1 Nodes
type NodeType = 'SITE' | 'R1' | 'R2';

interface Node {
  id: string;
  label: string;
  type: NodeType;
}
3.2 Edges
type EdgeType = 'ANIMATION' | 'LOGISTICS';

interface Edge {
  source: string;
  target: string;
  type: EdgeType;
}
3.3 Contraintes métier
ANIMATION (ventes)
obligatoire pour chaque site
exactement 1 lien sortant par site
cible obligatoire : R1
direction : SITE → R1
LOGISTICS
minimum 1 lien par site
cible : R1 ou R2
multi-liens autorisés
direction libre ou bidirectionnelle selon modèle métier
4. Règles de filtrage (backend ou frontend)
4.1 Construction du graphe
function buildGraph(site, nodes, edges) {
  const directEdges = edges.filter(e => e.source === site.id);

  const nodeIds = new Set([site.id]);
  directEdges.forEach(e => nodeIds.add(e.target));

  return {
    center: site,
    nodes: nodes.filter(n => nodeIds.has(n.id)),
    edges: directEdges
  };
}
4.2 Règle de non-propagation

Les nodes cibles (R1/R2) :

ne doivent PAS afficher leurs propres relations
sont considérés comme “terminaux dans la vue”
5. Règles de rendu visuel
5.1 Nodes
Type	Style
SITE	noir / gris foncé, node central
R1	bleu
R2	orange
5.2 Edges
Type	Couleur	Style
ANIMATION	bleu	ligne pleine
LOGISTICS	orange	ligne pointillée
5.3 Direction
ANIMATION : direction obligatoire SITE → R1
LOGISTICS : direction visible si définie, sinon non directionnel
6. UX / Interaction
6.1 Focus central
le site sélectionné est toujours centré
auto-zoom sur chargement
6.2 Hover

Sur edge :

type de relation
source → target
6.3 Click node (optionnel)
highlight des edges liés au site
fade des autres éléments
6.4 Légende obligatoire

Afficher en permanence :

🔵 Animation = flux de ventes vers R1
🟠 Logistique = relations opérationnelles
7. Comportement graphique (D3.js)
7.1 Layout
force-directed graph contrôlé
centre fixe sur SITE
distance standardisée :
SITE → R1 : courte distance
SITE → R2 : distance moyenne
7.2 Forces
center force sur SITE
charge négative modérée
link distance custom selon type
8. Contraintes techniques
Frontend
Angular 17
D3.js pour rendering SVG
Tailwind CSS pour layout UI
Performance
support jusqu’à ~200 nodes (non requis ici mais safe design)
recalcul uniquement à changement de site
pas de recalcul global du graphe réseau
State management
input principal : selectedSiteId
recalcul du graph à chaque changement de site
9. Non-objectifs

Cette feature ne doit PAS :

afficher un graphe global entreprise
permettre navigation multi-hop
représenter les clusters R1/R2 complets
exposer le réseau complet logistique
10. Critères d’acceptation

La feature est validée si :

un site affiche uniquement ses relations directes
les liens ANIMATION et LOGISTICS sont visuellement distincts
aucun nœud n’expose ses propres voisins
le site reste toujours centré
la lecture du graphe est possible en < 3 secondes
11. Résumé conceptuel

“Un graphe ego-centered strict où chaque site est une vue isolée de ses relations directes, avec une séparation visuelle forte entre flux d’animation et flux logistique.”
