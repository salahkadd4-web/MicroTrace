# MicroTrace AI
## Document de cadrage du projet, plan de réalisation et répartition des rôles

**Version :** 1.0 — document de travail  
**Contexte :** projet de startup en Algérie  
**Domaine :** informatique, intelligence artificielle, bio-informatique et recherche sur les microplastiques dans les matrices biologiques humaines

---

## 1. Résumé exécutif

**MicroTrace AI** est un projet de plateforme logicielle destinée aux chercheurs et aux laboratoires qui étudient les microplastiques dans les matrices biologiques humaines, notamment le sang. La plateforme vise à structurer les données expérimentales, documenter les méthodes d'analyse, améliorer la traçabilité et le contrôle qualité, faciliter l'analyse statistique et, lorsque des données appropriées sont disponibles, assister certaines tâches d'analyse à l'aide de l'intelligence artificielle.

Le projet associe deux compétences complémentaires :

- **Informatique :** développement logiciel, gestion de données, statistiques, visualisation et apprentissage automatique.
- **Biologie et chimie analytique :** conception des protocoles scientifiques, compréhension des échantillons, méthodes d'identification des polymères, prévention des contaminations et interprétation biologique.

### Positionnement initial

MicroTrace AI doit d'abord être présenté comme **un outil de recherche et de gestion de données scientifiques**, et non comme un dispositif médical ni comme une méthode validée de diagnostic. Le premier produit ne réalisera pas lui-même de prélèvements ou d'analyses physiques : il exploitera des données produites par des laboratoires compétents.

### Problème à résoudre

Les études sur les microplastiques peuvent utiliser des méthodes, des unités, des seuils de détection et des procédures de préparation différents. Les résultats peuvent donc être difficiles à comparer. Les risques de contamination, les données manquantes et les métadonnées incomplètes compliquent aussi l'interprétation.

MicroTrace AI cherchera à aider les équipes de recherche à :

1. centraliser les métadonnées et les résultats analytiques ;
2. documenter la provenance et la méthode de chaque mesure ;
3. signaler les problèmes potentiels de qualité des données ;
4. produire des graphiques et des rapports reproductibles ;
5. comparer les résultats avec prudence, en tenant compte des différences méthodologiques ;
6. évaluer, dans une phase ultérieure, des outils d'IA pour les spectres ou les images annotés par des spécialistes.

---

## 2. Le problème scientifique et ses limites

Des publications scientifiques ont rapporté la détection de particules ou de matériaux associés aux plastiques dans des échantillons humains. Cependant, les méthodes d'échantillonnage, de préparation et d'identification varient, et la mesure des particules très petites présente des difficultés importantes.

Il faut distinguer plusieurs notions :

- **Détection :** observation ou mesure d'un signal compatible avec la présence d'une particule ou d'un polymère.
- **Identification :** détermination du matériau par une méthode analytique appropriée.
- **Quantification :** mesure du nombre de particules ou de la quantité de matériau, selon une méthode et une unité définies.
- **Exposition :** contact d'une personne avec une source ou une voie d'exposition potentielle.
- **Accumulation biologique :** présence ou rétention dans un organisme au fil du temps, ce qui ne peut pas être démontré par une mesure isolée dans le sang.
- **Effet sur la santé :** conséquence biologique qui doit être étudiée par des méthodes adaptées ; une association statistique ne prouve pas à elle seule une causalité.

**Conséquence pour le projet :** MicroTrace AI ne doit pas assimiler une mesure ponctuelle dans le sang à une preuve d'accumulation à long terme, ni conclure qu'une concentration donnée provoque une maladie. La plateforme doit documenter les limites des données et les incertitudes.

### Les méthodes analytiques

Selon les objectifs de l'étude et les équipements disponibles, des spécialistes peuvent envisager des techniques telles que la spectroscopie Raman, la micro-FTIR ou la pyrolyse couplée à la chromatographie et à la spectrométrie de masse. Ces méthodes ne mesurent pas exactement les mêmes propriétés et ne sont pas interchangeables.

Le choix de la méthode, la préparation des échantillons, les contrôles de contamination, les blancs analytiques, les contrôles de récupération et les limites de détection relèvent du laboratoire partenaire et de son équipe scientifique.

---

## 3. Vision du produit

La vision à long terme est une plateforme modulaire appelée **MicroTrace AI**, composée de trois modules.

### 3.1 MicroTrace Studio — gestion et analyse des données

Fonctions principales :

- création de projets et d'études ;
- enregistrement pseudonymisé des échantillons ;
- importation de fichiers CSV et Excel ;
- validation des colonnes, formats, unités et valeurs manquantes ;
- enregistrement de la méthode analytique et de ses paramètres ;
- suivi des contrôles qualité ;
- visualisation des résultats ;
- export de rapports et de jeux de données documentés ;
- historique des modifications et traçabilité des analyses.

### 3.2 MicroTrace Intelligence — assistance par l'IA

Fonctions possibles, après validation de la disponibilité et de la qualité des données :

- prétraitement et comparaison de spectres ;
- classification exploratoire de spectres ou d'images annotés par des experts ;
- signalement des résultats incertains ou atypiques ;
- aide au tri des données pour accélérer la revue humaine ;
- mesure des performances du modèle sur un jeu de test indépendant.

L'IA doit afficher les limites et le niveau d'incertitude. Elle ne doit pas confirmer seule la nature plastique d'une particule sur la base d'une photographie microscopique ordinaire. L'identification nécessite une méthode analytique adaptée.

### 3.3 MicroTrace Atlas — base de données scientifique

Fonctions possibles :

- enregistrement de données publiées et de données expérimentales autorisées ;
- métadonnées relatives à la matrice, à la méthode, aux unités et aux limites de détection ;
- liens vers les références bibliographiques ;
- comparaison des résultats compatibles ;
- recherche et export de données selon les droits d'accès ;
- séparation claire entre données publiées, données de laboratoire et données simulées de démonstration.

Les données issues de publications ne doivent être importées que dans le respect des licences, droits d'auteur et conditions de réutilisation. Les données humaines doivent être traitées selon les règles éthiques, juridiques et de sécurité applicables.

---

## 4. Utilisateurs et clients potentiels

Les premiers utilisateurs à interroger sont :

1. chercheurs en santé environnementale ;
2. chercheurs en chimie analytique et science des polymères ;
3. équipes universitaires en biologie et toxicologie ;
4. laboratoires qui réalisent des analyses pertinentes ;
5. équipes de recherche qui effectuent des revues de littérature ou des analyses de données.

Les clients payants potentiels pourraient être des universités, des laboratoires ou des projets de recherche. Ce modèle économique reste une hypothèse à vérifier par des entretiens et des pilotes. Il ne faut pas supposer qu'un marché solvable existe avant d'avoir confirmé les besoins, les budgets et les solutions concurrentes.

### Questions à poser pendant les entretiens

- Comment les résultats sont-ils actuellement stockés et analysés ?
- Quelles difficultés rencontrent les chercheurs lorsqu'ils comparent plusieurs études ?
- Quels contrôles qualité sont consignés et dans quel format ?
- Quelles tâches prennent le plus de temps ?
- Quels logiciels sont déjà utilisés ?
- Les données peuvent-elles être partagées pour tester un prototype ?
- Qui décide de l'achat d'un logiciel et quel budget peut être envisagé ?
- Quelle validation serait nécessaire avant une utilisation dans un laboratoire ?

---

## 5. Périmètre du MVP

Le **MVP** (produit minimum viable) est la première version qui permet de vérifier qu'un utilisateur réel obtient une valeur du produit.

### Fonctions incluses

1. **Gestion des études**
   - créer une étude ;
   - décrire son objectif ;
   - enregistrer la source et la version des données.

2. **Import de données**
   - importer CSV et Excel ;
   - afficher un aperçu ;
   - détecter les colonnes manquantes, types incorrects et valeurs impossibles selon les règles définies ;
   - permettre le mapping des colonnes vers un schéma standard.

3. **Registre des échantillons**
   - utiliser un identifiant de recherche pseudonymisé ;
   - enregistrer la matrice biologique, la méthode, la date d'analyse et les métadonnées utiles ;
   - éviter de collecter des identifiants personnels non nécessaires.

4. **Contrôle qualité**
   - enregistrer les blancs analytiques et les contrôles ;
   - documenter les résultats exclus et les raisons de l'exclusion ;
   - signaler les données manquantes, incohérentes ou hors des limites configurées ;
   - garder une trace des modifications.

5. **Visualisation**
   - distributions et statistiques descriptives ;
   - résultats par polymère, méthode, étude ou autre variable disponible ;
   - filtres et export.

6. **Rapports**
   - générer un rapport comprenant la source des données, la méthode, les unités, les contrôles qualité et les limites ;
   - exporter en CSV et PDF si cette fonction est réalisable dans le délai.

7. **Documentation**
   - dictionnaire de données ;
   - explication des calculs ;
   - version du logiciel et des règles appliquées.

### Fonctions exclues du premier MVP

- prélèvements sanguins réalisés par l'équipe informatique ;
- développement d'un appareil de laboratoire ;
- diagnostic médical ou estimation individuelle du risque ;
- affirmation qu'un modèle détecte définitivement les microplastiques ;
- étude clinique sur des personnes sans protocole, autorisations et partenaire compétent ;
- modèle prédictif sur la santé sans données appropriées et validation scientifique.

### Critères de réussite du MVP

Le MVP sera considéré comme prometteur si :

- un chercheur peut importer un jeu de données réel ou autorisé sans assistance constante ;
- les erreurs et valeurs manquantes sont détectées de façon reproductible ;
- chaque graphique ou rapport peut être relié aux données sources et aux transformations ;
- un partenaire scientifique juge les résultats et la traçabilité utiles ;
- plusieurs utilisateurs pilotes peuvent réaliser un cas d'usage concret ;
- un client potentiel exprime un intérêt suffisamment précis pour un pilote ou un achat.

---

## 6. Répartition des rôles

Le projet a besoin au minimum d'un responsable informatique et d'un partenaire scientifique en biologie ou en chimie analytique. Les responsabilités doivent être documentées et les décisions scientifiques ne doivent pas être prises uniquement par le développeur.

### 6.1 Rôle de l'informaticien / développeur IA

**Responsabilité générale :** concevoir et maintenir la plateforme logicielle, la chaîne de traitement des données et les composants informatiques de l'IA.

#### A. Compréhension et conception

- rencontrer les utilisateurs avec le biologiste ;
- transformer les besoins en spécifications fonctionnelles ;
- proposer l'architecture du logiciel ;
- définir les rôles et permissions ;
- concevoir le modèle de données avec le partenaire scientifique ;
- identifier les exigences de confidentialité et de sécurité.

#### B. Développement de la plateforme

- créer l'interface web ;
- développer l'API et les services de traitement ;
- créer la base de données ;
- implémenter l'import CSV/Excel et le mapping des colonnes ;
- construire les tableaux de bord et les visualisations ;
- générer les rapports ;
- créer les fonctions d'export ;
- gérer les erreurs et les journaux techniques.

#### C. Qualité et traçabilité des données

- développer des validations déterministes ;
- enregistrer la provenance des données ;
- versionner les transformations et les paramètres ;
- documenter les opérations qui modifient les données ;
- distinguer les données originales, nettoyées, calculées et simulées ;
- assurer la reproductibilité des calculs.

#### D. IA et statistiques

- préparer les pipelines de prétraitement ;
- examiner la disponibilité de jeux de données annotés ;
- construire des références simples avant un modèle complexe ;
- entraîner et évaluer les modèles si le volume et la qualité des données le permettent ;
- séparer les données d'entraînement, de validation et de test ;
- mesurer les faux positifs, faux négatifs et autres métriques pertinentes ;
- exposer les incertitudes et limites du modèle ;
- documenter la version du modèle et ses conditions d'utilisation.

Le développeur ne doit pas définir seul la vérité biologique d'un jeu de données ou les critères scientifiques d'identification des polymères.

#### E. Déploiement et maintenance

- mettre en place les environnements de développement et de production ;
- gérer les sauvegardes et la restauration ;
- contrôler les accès ;
- chiffrer les communications et protéger les secrets ;
- surveiller les erreurs ;
- maintenir les dépendances ;
- documenter les procédures de déploiement et de récupération.

#### Livrables de l'informaticien

- architecture technique ;
- application web ;
- API documentée ;
- schéma de base de données ;
- pipeline d'import et de validation ;
- rapports et visualisations ;
- tests automatisés ;
- documentation utilisateur et technique ;
- documentation des modèles d'IA, si développés.

### 6.2 Rôle du biologiste / chercheur scientifique

**Responsabilité générale :** garantir la pertinence biologique et analytique des données, des métadonnées, des contrôles qualité et de l'interprétation scientifique.

Le profil le plus adapté pourrait être un chercheur en santé environnementale, en chimie analytique, en toxicologie ou en science des polymères. Un biologiste généraliste peut contribuer, mais certaines décisions nécessiteront une expertise spécifique en analyse instrumentale.

#### A. Cadrage scientifique

- préciser les questions de recherche ;
- définir les termes utilisés : microplastiques, nanoplastiques, détection, identification, quantification et exposition ;
- examiner la littérature scientifique ;
- identifier les limites actuelles des méthodes ;
- définir ce que le logiciel peut ou ne peut pas conclure ;
- proposer les variables pertinentes à enregistrer.

#### B. Méthodes analytiques et données

- décrire les méthodes utilisées par les laboratoires ;
- définir les métadonnées nécessaires pour interpréter chaque résultat ;
- documenter les unités et limites de détection ;
- expliquer les contrôles analytiques nécessaires ;
- déterminer quelles données peuvent être comparées ;
- vérifier les règles scientifiques utilisées dans le logiciel ;
- identifier les cas où un résultat doit être marqué comme incertain ou non comparable.

#### C. Validation des résultats

- vérifier les calculs scientifiques et les unités ;
- examiner les graphiques et rapports générés ;
- annoter ou faire annoter les données de référence par des experts qualifiés ;
- contribuer à la définition des classes et critères de référence ;
- analyser les erreurs du modèle ;
- participer à l'évaluation de la sensibilité, de la spécificité et de la reproductibilité lorsque ces métriques sont appropriées ;
- documenter les limites et les cas d'échec.

#### D. Collaboration avec le laboratoire

- identifier les équipements et méthodes disponibles ;
- établir les conditions de transfert de données ;
- coordonner avec les personnes habilitées toute éventuelle étude expérimentale ;
- vérifier les autorisations, procédures éthiques et règles de sécurité applicables ;
- superviser les aspects biologiques et analytiques des études pilotes.

#### E. Recherche et publications

- construire la bibliographie ;
- vérifier la qualité et la provenance des publications ;
- proposer des protocoles de comparaison ;
- interpréter les résultats sans extrapolation abusive ;
- contribuer aux rapports scientifiques et publications ;
- distinguer les résultats exploratoires des conclusions validées.

#### F. Jeux de données à rechercher et à demander au biologiste

**Objectif :** identifier les données réellement disponibles auprès du laboratoire ou dans la littérature, afin de construire un MVP utile et de déterminer si une future fonction d’IA est scientifiquement faisable. Il n’est pas nécessaire que le partenaire possède tous les types de données ci-dessous. Il doit préciser ce qui existe, ce qui est accessible et sous quelles conditions.

##### 1. Tableau de résultats analytiques

C’est le premier jeu de données à rechercher pour le MVP de gestion et d’analyse. Demander, si disponible, un tableau CSV ou Excel contenant une ligne par échantillon, mesure ou résultat, avec un dictionnaire de variables. Les champs possibles sont à valider scientifiquement :

- identifiant de recherche pseudonymisé de l’échantillon ou de la mesure ;
- matrice analysée (par exemple sang total, plasma ou sérum), si applicable ;
- type de particule ou polymère identifié/candidat (par exemple PET, PE, PP), avec le statut de confirmation ;
- résultat mesuré et unité exacte (nombre de particules, concentration massique ou autre mesure — ne pas mélanger ces mesures) ;
- méthode instrumentale et protocole de préparation ;
- taille ou plage de tailles des particules, si mesurée ;
- limites de détection et de quantification, si disponibles ;
- date ou lot d’analyse, laboratoire et version de méthode, selon les autorisations ;
- résultats des blancs et contrôles qualité associés ;
- données manquantes, résultats exclus et motif d’exclusion ;
- référence bibliographique ou provenance du jeu de données.

Les données d’exemple créées pour tester l’application doivent être clairement étiquetées comme **fictives/simulées** et ne doivent jamais être présentées comme des résultats scientifiques réels.

##### 2. Spectres de référence annotés (Raman, FTIR ou autre méthode adaptée)

Ce jeu de données est particulièrement pertinent si l’équipe souhaite étudier ultérieurement une classification assistée par IA. Demander, si disponibles et partageables :

- fichiers de spectres bruts ou exportés dans leur format d’origine, ainsi que les formats tabulaires disponibles ;
- identification de référence du matériau, idéalement confirmée par une méthode appropriée ;
- annotations réalisées ou vérifiées par une personne compétente ;
- méthode instrumentale, paramètres d’acquisition et prétraitements déjà appliqués ;
- origine de l’échantillon ou du matériau et conditions de mesure ;
- informations sur les mélanges, spectres ambigus, contaminants et cas non identifiés ;
- licence, droits d’utilisation et possibilité de réutilisation pour la recherche ou l’entraînement d’un modèle.

Préciser si les spectres proviennent de polymères de référence purs, de matériaux environnementaux ou d’échantillons biologiques. Ces catégories ne sont pas équivalentes et doivent rester identifiables dans la plateforme.

##### 3. Images microscopiques annotées

Si le laboratoire dispose d’images, demander les fichiers originaux ou la meilleure qualité disponible, accompagnés des annotations et du contexte d’acquisition :

- identifiant du fichier et lien avec l’échantillon ou la lame, via un identifiant non identifiant ;
- échelle ou calibration permettant d’estimer la taille, si disponible ;
- annotations des particules candidates et catégories utilisées par l’expert ;
- forme, couleur ou dimensions, uniquement si ces caractéristiques sont réellement observées et documentées ;
- méthode de confirmation de la composition du matériau, lorsqu’elle existe ;
- paramètres du microscope, grossissement et protocole de préparation ;
- statut des cas incertains ou non confirmés.

**Important :** une image microscopique seule ne suffit généralement pas à confirmer la composition chimique d’une particule. Le logiciel doit distinguer « particule candidate observée » et « polymère identifié par une méthode adaptée ».

##### 4. Données de contrôle qualité et de contamination

Demander les enregistrements disponibles concernant :

- blancs de procédure et blancs instrumentaux ;
- contrôles positifs ou matériaux de référence ;
- essais de récupération, si réalisés ;
- répétitions, réplicats et variabilité des mesures ;
- limites de détection/quantification et critères d’acceptation ;
- mesures de prévention de la contamination et incidents documentés ;
- règles utilisées pour accepter, corriger, signaler ou exclure un résultat.

Ces informations sont essentielles pour interpréter les résultats et éviter que le logiciel compare des données de qualité ou de nature différentes.

##### 5. Données issues d’études publiées sur l’exposition humaine

Si le laboratoire ne possède pas de résultats propres, le biologiste peut identifier des jeux de données publiés et réutilisables. Demander les tableaux supplémentaires des articles, les métadonnées, les méthodes, les unités, les limites de détection, les contrôles qualité et les références bibliographiques. Toute restriction de licence ou de réutilisation doit être vérifiée avant import.

Les variables d’exposition ou les données cliniques ne doivent être utilisées que si elles sont pertinentes, autorisées et suffisamment documentées. Une association observée ne doit pas être interprétée automatiquement comme une relation de cause à effet.

##### Informations à demander pour chaque jeu de données

Pour chaque jeu proposé, le biologiste précisera :

1. **Disponibilité :** existe-t-il déjà, peut-il être obtenu auprès d’un laboratoire ou provient-il d’une publication ?
2. **Format et volume :** CSV, Excel, TXT, fichiers spectraux, images, nombre approximatif de lignes/fichiers et taille totale.
3. **Provenance :** laboratoire, publication, matériau de référence ou autre source, avec référence vérifiable.
4. **Méthode :** protocole, instrument, unités, paramètres et limites connues.
5. **Annotations :** qui a identifié ou annoté les résultats, selon quels critères et avec quel niveau de confiance ?
6. **Qualité :** présence de blancs, contrôles, répétitions, données manquantes et résultats ambigus.
7. **Droits d’accès :** données publiques, autorisées pour le projet, soumises à un accord, ou non partageables.
8. **Usage autorisé :** démonstration logicielle, analyse statistique, publication, entraînement ou évaluation d’une IA.
9. **Confidentialité et éthique :** présence éventuelle de données humaines, autorisations nécessaires et procédure de pseudonymisation.

##### Priorité recommandée pour démarrer

- **Priorité 1 — MVP :** un tableau de résultats analytiques documenté, même de taille modeste, avec unités, méthodes, provenance et contrôles qualité ; à défaut, un jeu publié dont la réutilisation est permise.
- **Priorité 2 — faisabilité de l’IA :** des spectres de référence annotés et/ou des images annotées, avec méthode de confirmation et conditions d’acquisition.
- **Priorité 3 — renforcement scientifique :** contrôles qualité détaillés et données provenant de plusieurs études, sans fusionner des mesures incompatibles.

Si aucun jeu de données sur le sang humain n’est disponible, le projet peut commencer avec des données de référence sur des polymères ou des données publiées autorisées. Elles devront être identifiées comme telles et ne pas être présentées comme des mesures de microplastiques dans le sang humain. L’absence de données adaptées peut conduire à reporter le module IA tout en poursuivant le MVP de gestion des données.

##### Message court que le fondateur peut envoyer au biologiste

> Pour cadrer MicroTrace AI, pourriez-vous m’indiquer quels jeux de données vous avez déjà ou pourriez obtenir légalement : (1) tableaux de résultats analytiques, notamment avec la méthode, les unités et les contrôles qualité ; (2) spectres Raman/FTIR ou autres spectres de référence annotés ; (3) images microscopiques annotées ; et (4) données de blancs, contrôles positifs ou essais de récupération ? Pour chaque jeu, j’aurais besoin de connaître le format, le volume approximatif, la méthode de mesure, la qualité des annotations, la provenance et les conditions d’accès/réutilisation. Des données publiques ou non identifiantes conviennent pour commencer. Pour toute donnée humaine, il faudra confirmer les autorisations, les exigences éthiques et les mesures de protection avant de la partager ou de l’utiliser. Le premier objectif est de construire un outil de gestion, de contrôle qualité et d’analyse ; l’IA ne sera envisagée qu’après vérification de la qualité et de la pertinence des données.

#### Livrables du biologiste / chercheur

- note de cadrage scientifique ;
- bibliographie commentée ;
- dictionnaire des variables biologiques et analytiques ;
- fiche de description des méthodes ;
- règles de contrôle qualité validées ;
- données de référence autorisées et annotations documentées ;
- rapport de validation scientifique ;
- limites d'interprétation et recommandations de recherche.

### 6.3 Responsabilités partagées

Les tâches suivantes nécessitent un travail conjoint :

- définition du schéma de données ;
- sélection des premiers cas d'usage ;
- définition des critères de réussite ;
- choix des règles de qualité ;
- préparation et revue du jeu de données de test ;
- analyse des erreurs ;
- préparation du pilote ;
- présentation aux partenaires et incubateurs ;
- décision de mise en production d'une fonction d'IA.

**Règle de gouvernance :** le biologiste valide la signification et la pertinence scientifiques ; l'informaticien garantit la qualité de l'implémentation et la reproductibilité informatique. Les décisions concernant l'éthique, la sécurité des échantillons ou les autorisations relèvent aussi des institutions et professionnels compétents.

---

## 7. Équipe minimale recommandée

| Rôle | Implication initiale | Mission prioritaire |
|---|---|---|
| Fondateur / développeur | Forte | Prototype, architecture et gestion du projet |
| Biologiste ou chercheur partenaire | Régulière | Cadrage scientifique et revue des données |
| Expert en chimie analytique / polymères | Ponctuelle à régulière | Méthodes d'identification et limites instrumentales |
| Encadrant universitaire ou conseiller en recherche | Ponctuelle | Méthodologie, partenariats et validation |
| Conseiller juridique / éthique et sécurité | Selon les besoins | Données humaines, contrats et autorisations |

Il n'est pas nécessaire de recruter immédiatement chaque rôle. Des collaborations universitaires peuvent être explorées, sous réserve d'accords formels et de disponibilités réelles.

---

## 8. Plan de réalisation

Les délais ci-dessous sont des estimations de planification. Ils supposent un périmètre limité, un accès aux données et une disponibilité raisonnable des partenaires.

### Phase 1 — Validation du besoin (semaines 1 à 3)

**Informaticien**
- rédiger une première description du produit ;
- préparer des maquettes simples ;
- identifier les fonctions techniquement réalisables ;
- dresser une première liste des logiciels comparables.

**Biologiste**
- définir le problème scientifique prioritaire ;
- identifier les méthodes analytiques pertinentes ;
- préparer une liste des métadonnées essentielles ;
- examiner les principales limites scientifiques.

**Ensemble**
- interroger 8 à 15 chercheurs ou professionnels ;
- choisir un seul cas d'usage ;
- documenter les critères de réussite.

**Livrable :** note de cadrage validée et décision de poursuivre ou de réviser l'idée.

### Phase 2 — Données et conception (semaines 4 à 5)

**Informaticien**
- concevoir le modèle de données ;
- préparer l'environnement de développement ;
- choisir la structure de l'API et de la base de données ;
- concevoir l'import et les contrôles techniques.

**Biologiste**
- fournir un dictionnaire de données ;
- définir les unités, méthodes et métadonnées ;
- préciser les contrôles qualité nécessaires ;
- identifier un jeu de données autorisé.

**Ensemble**
- valider le schéma de données ;
- documenter les règles de comparaison.

**Livrable :** schéma de base de données, spécifications et jeu de données de test autorisé.

### Phase 3 — Développement du MVP (semaines 6 à 9)

**Informaticien**
- développer l'authentification et les permissions ;
- implémenter l'import ;
- développer la validation et la traçabilité ;
- créer les graphiques et rapports ;
- automatiser les tests.

**Biologiste**
- vérifier les règles de validation ;
- examiner les résultats sur des cas connus ;
- vérifier les unités, libellés et avertissements ;
- préparer des cas de test scientifiques.

**Livrable :** prototype fonctionnel sans prétention diagnostique.

### Phase 4 — Évaluation avec un partenaire (semaines 10 à 12)

**Informaticien**
- corriger les erreurs ;
- mesurer les temps de traitement ;
- renforcer la sécurité et les sauvegardes ;
- améliorer la documentation.

**Biologiste**
- vérifier les rapports ;
- documenter les limites ;
- comparer les résultats du logiciel aux analyses de référence disponibles ;
- identifier les améliorations prioritaires.

**Ensemble**
- recueillir les retours des utilisateurs ;
- mesurer la valeur apportée ;
- décider des prochaines fonctionnalités.

**Livrable :** rapport de test, démonstration et plan d'amélioration.

### Phase 5 — IA expérimentale (mois 4 à 6, si les données le permettent)

- obtenir des spectres ou images avec des droits d'utilisation et des annotations de qualité ;
- définir la tâche exacte de classification ;
- créer des références de comparaison ;
- séparer les jeux d'entraînement et de test au niveau approprié pour éviter les fuites de données ;
- évaluer le modèle sur des données indépendantes ;
- comparer ses performances à une méthode de référence ;
- documenter les incertitudes et les cas où l'IA ne doit pas fournir de réponse.

**Condition de démarrage :** ne pas développer un modèle uniquement pour ajouter de l'IA au produit. Il faut d'abord disposer d'un besoin réel, de données adaptées et d'une méthode d'évaluation.

### Phase 6 — Pilote et lancement (mois 6 à 9)

- finaliser les conditions de collaboration ;
- faire tester le produit par une ou deux équipes pilotes ;
- mesurer le gain de temps et la qualité des rapports ;
- vérifier les exigences de protection des données ;
- définir l'offre commerciale ;
- préparer un dossier d'incubation et les démarches de création d'entreprise.

---

## 9. Architecture de données recommandée

Le schéma exact doit être validé par l'équipe scientifique. Une première version peut contenir les entités suivantes :

- **Project** : titre, objectif, responsable, version et statut ;
- **Study** : protocole, population ou contexte de recherche, dates et référence ;
- **Sample** : identifiant pseudonymisé, matrice, métadonnées autorisées et statut ;
- **AnalyticalMethod** : technique, paramètres, version du protocole et laboratoire ;
- **Measurement** : valeur, unité, polymère candidat, taille ou autre mesure disponible ;
- **QualityControl** : type de contrôle, résultat, seuil et commentaire ;
- **DataFile** : fichier source, format, provenance, empreinte numérique et date d'import ;
- **ProcessingRun** : transformations, paramètres, version du code et date ;
- **ModelPrediction** : résultat de l'IA, version du modèle, score et niveau d'incertitude ;
- **Reference** : DOI ou autre référence bibliographique, licence et métadonnées de provenance ;
- **AuditEvent** : action effectuée, date, utilisateur et objet modifié.

Les données originales doivent rester préservées. Toute transformation doit être traçable et reproductible. Les unités ne doivent pas être converties automatiquement sans règle documentée. Les résultats de méthodes différentes ne doivent pas être fusionnés sans vérifier leur comparabilité.

### Protection des données

Pour le MVP, privilégier les données publiques, synthétiques ou non identifiantes. Si des données humaines sont utilisées :

- appliquer les autorisations et exigences éthiques pertinentes ;
- limiter la collecte au strict nécessaire ;
- pseudonymiser les données et conserver séparément toute clé de réidentification ;
- définir les droits d'accès et les durées de conservation ;
- chiffrer les données en transit et au repos lorsque possible ;
- établir un accord précisant la propriété, l'accès, la publication et la suppression des données ;
- ne pas déposer de données sensibles dans des services externes sans autorisation appropriée.

La pseudonymisation ne rend pas automatiquement les données anonymes.

---

## 10. Évaluation du module IA

L'IA est une hypothèse de développement, pas une garantie d'innovation ou de performance.

### Étapes d'évaluation

1. définir une tâche limitée et mesurable ;
2. choisir un jeu de données pertinent ;
3. faire annoter les données par des spécialistes ;
4. vérifier la cohérence des annotations ;
5. établir une méthode de référence simple ;
6. entraîner le modèle uniquement si cela est justifié ;
7. évaluer sur des données indépendantes ;
8. mesurer les erreurs et analyser leurs causes ;
9. documenter les conditions dans lesquelles le modèle échoue ;
10. décider si l'IA apporte une amélioration réelle par rapport à la méthode de référence.

Les métriques peuvent inclure la sensibilité, la spécificité, la précision, le rappel, le F1-score ou les erreurs quantitatives, selon la tâche. Il faut choisir les métriques avant l'évaluation et expliquer les conséquences des faux positifs et faux négatifs.

Une image microscopique peut montrer une particule candidate sans suffire à confirmer sa composition chimique. Toute prétention d'identification doit être liée à une méthode de référence adaptée.

---

## 11. Budget prévisionnel

Les montants suivants sont des **enveloppes de planification**, pas des prix vérifiés ni des devis. Ils doivent être remplacés par des devis et des accords réels.

| Poste | Première enveloppe indicative |
|---|---:|
| Développement réalisé par le fondateur | 0 à 150 000 DA de dépenses directes |
| Hébergement, domaine et outils | 0 à 60 000 DA |
| Déplacements et réunions | 20 000 à 80 000 DA |
| Expertise scientifique | À négocier selon l'accord |
| Analyses expérimentales | Sur devis du laboratoire |
| Éthique, contrats et conseil spécialisé | À estimer selon le protocole |
| Recrutement ou rémunération d'une équipe | Non inclus |

### Stratégie de réduction des coûts

- commencer par une plateforme logicielle ;
- utiliser des données publiques ou synthétiques pour les tests techniques ;
- chercher un partenaire disposant déjà des équipements requis ;
- obtenir des devis avant de planifier une étude expérimentale ;
- ne pas acheter de matériel analytique au stade du MVP ;
- distinguer les dépenses directes du coût réel du temps de travail du fondateur.

Le budget d'une étude impliquant des échantillons humains ne peut pas être déterminé correctement sans connaître le protocole, le nombre d'échantillons, les méthodes, les contrôles, les autorisations et les prestations nécessaires.

---

## 12. Modèle économique

Modèles à tester auprès des utilisateurs :

1. **Abonnement logiciel** pour une équipe ou un laboratoire ;
2. **Licence institutionnelle** pour une université ou un centre de recherche ;
3. **Prestation d'analyse de données** pour des projets de recherche ;
4. **Accompagnement à la structuration des données** et à la reproductibilité ;
5. À long terme, module IA spécialisé, uniquement si sa valeur et ses performances sont validées.

### Validation commerciale

Avant de fixer un prix :

- identifier la personne qui décide de l'achat ;
- comprendre les budgets et les cycles d'achat ;
- vérifier les logiciels déjà utilisés ;
- proposer une démonstration à partir d'un cas concret ;
- obtenir un engagement pour un pilote ;
- mesurer la valeur obtenue par l'utilisateur.

Ne pas considérer un intérêt académique comme une preuve de volonté de payer.

---

## 13. Risques et mesures de réduction

| Risque | Mesure proposée |
|---|---|
| Peu de données exploitables | Commencer par l'import, la traçabilité et l'analyse statistique plutôt que par un modèle complexe |
| Méthodes analytiques non comparables | Conserver les métadonnées et définir des règles de comparabilité |
| Contamination des échantillons | Documenter les contrôles réalisés par le laboratoire et les limites de chaque étude |
| Faux positifs de l'IA | Utiliser des références validées, mesurer les erreurs et maintenir une revue humaine |
| Absence de clients payants | Interroger les utilisateurs et tester un pilote avant d'investir davantage |
| Données humaines sensibles | Minimiser, pseudonymiser, contrôler les accès et respecter les autorisations |
| Conclusions sanitaires exagérées | Distinguer observation, association, causalité et diagnostic |
| Dépendance à un seul partenaire | Documenter les accords et rechercher progressivement plusieurs collaborations |
| Propriété intellectuelle floue | Convenir par écrit des droits sur le code, les données, les annotations et les résultats |

---

## 14. Plan d'action immédiat : les 30 prochains jours

### Semaine 1 — Cadrage

- [ ] Rédiger une fiche projet d'une page.
- [ ] Définir le problème principal que MicroTrace AI veut résoudre.
- [ ] Préparer une première bibliographie scientifique.
- [ ] Lister les fonctions du MVP et celles qui en sont exclues.

### Semaine 2 — Recherche de partenaires

- [ ] Identifier des chercheurs en santé environnementale.
- [ ] Identifier des spécialistes de chimie analytique et des polymères.
- [ ] Contacter un laboratoire universitaire potentiel.
- [ ] Préparer une liste de questions pour les entretiens.

### Semaine 3 — Validation des besoins et des données

- [ ] Réaliser plusieurs entretiens.
- [ ] Identifier les formats de données utilisés par les chercheurs.
- [ ] Vérifier les possibilités d'accès à des données autorisées.
- [ ] Définir les métadonnées et contrôles qualité prioritaires.

### Semaine 4 — Prototype de conception

- [ ] Créer une maquette de l'interface.
- [ ] Définir le modèle de données initial.
- [ ] Construire un exemple d'import CSV.
- [ ] Préparer une démonstration avec des données synthétiques clairement identifiées.
- [ ] Présenter la maquette à un chercheur et intégrer ses retours.

### Objectif à 30 jours

Avoir une note de cadrage scientifique, des retours d'utilisateurs potentiels, un schéma de données initial, une maquette et une première décision sur le cas d'usage à développer.

---

## 15. Indicateurs de réussite

### Scientifiques

- provenance et méthode documentées pour chaque résultat ;
- règles de qualité revues par un spécialiste ;
- unités et limites correctement présentées ;
- résultats reproductibles à partir des mêmes données et paramètres ;
- limites scientifiques clairement indiquées.

### Techniques

- import fiable des formats ciblés ;
- traçabilité des transformations ;
- tests automatisés des calculs ;
- sauvegarde et restauration testées ;
- gestion des permissions et des accès.

### Commerciaux

- entretiens réalisés avec des utilisateurs cibles ;
- problème prioritaire confirmé par plusieurs utilisateurs ;
- au moins une équipe pilote intéressée ;
- retours documentés sur la valeur du produit ;
- première hypothèse de tarification testée.

---

## 16. Conclusion

MicroTrace AI peut devenir un projet crédible à l'intersection de l'informatique et de la biologie si l'équipe commence par un problème concret : **rendre les données sur les microplastiques plus structurées, traçables et exploitables par les chercheurs**.

La priorité n'est pas de promettre une nouvelle méthode de détection ni de créer immédiatement un modèle d'IA. Elle est de trouver un partenaire scientifique, d'accéder légalement à des données pertinentes et de démontrer que le logiciel facilite réellement le travail de recherche.

Le rôle du développeur est de construire une plateforme fiable et reproductible. Le rôle du biologiste et des spécialistes analytiques est de garantir la pertinence scientifique, les règles de contrôle qualité et l'interprétation. C'est cette collaboration qui permettra de décider, sur des bases concrètes, si un module IA spécialisé et une startup commercialement viable sont réalisables.

---

## Ressources à consulter

- [Startup.dz — Label Projet innovant](https://startup.dz/label-projet/)
- [Université Oran 1 — Laboratoires](https://univ-oran1.dz/laboratories/)
- [Université Oran 1 — portail de la vice-rectorat concerné](https://vrre.univ-oran1.dz/)
- [Direction générale des impôts — informations sur les avantages fiscaux pour les startups](https://www.mfdgi.gov.dz/fr/professionnels/avantages-investissement/avantages-fiscaux-startup-et-incubateur-fr)

**Note :** ce document constitue un cadrage initial. Les hypothèses scientifiques, la disponibilité des laboratoires, les coûts, les obligations réglementaires et l'éligibilité aux dispositifs de soutien doivent être confirmés auprès des spécialistes et organismes concernés avant toute étude ou dépense importante.
