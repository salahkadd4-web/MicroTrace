# MicroTrace Studio v0 — conception

**Date :** 2026-10-24
**Statut :** conception décidée par l'équipe technique (le fondateur a délégué les choix : « décide toi »). Chaque choix ci-dessous est un choix de l'équipe technique, pas une validation du fondateur ni d'un biologiste.
**Source :** `MicroTrace_AI_plan_projet.md` (sections 3.1, 5, 9, 13) ; résultats du chantier A (`reports/baseline/report.md`).

## 1. Intention

Le plan fixe la priorité : **MicroTrace Studio**, un outil qui permet à un chercheur d'importer ses résultats analytiques (microplastiques dans le sang ou d'autres matrices), de les valider, de les tracer et d'en tirer des graphiques et un rapport **reproductibles**. L'IA spectrale (chantier A) reste un module secondaire.

Le chantier A a montré que la valeur se joue dans les détails invisibles : unités mal déclarées, conventions de fichiers, étiquettes ambiguës. Studio doit donc rendre ces détails **explicites et bloquants** plutôt que silencieux.

Critère de réussite du MVP (plan §5) : un chercheur importe un jeu réel sans assistance constante ; les erreurs sont détectées de façon reproductible ; chaque graphique et rapport est relié aux données sources et aux transformations.

## 2. Jeu de données de référence

- **Réel publié :** Leslie H.A. et al. (2022), *Discovery and quantification of plastic particle pollution in human blood*, Environment International 163:107199, https://doi.org/10.1016/j.envint.2022.107199, **CC BY 4.0**. Sang total, 22 donneurs, aliquotes en double (a/b) sauf donneurs 6, 9, 15 et 18, Py-GC/MS en double injection, concentrations **massiques** (µg/mL) pour PMMA, PP, PS (somme des styréniques), PE, PET. LOD et LOQ par polymère (Tableau 3 de l'article). 31 blancs de procédure, corrigés par la moyenne des blancs. Les valeurs entre LOD et LOQ sont marquées d'un astérisque dans le tableau S2. Les valeurs par donneur sont dans le tableau supplémentaire S2 (fichier `mmc1`, à télécharger manuellement par le fondateur depuis la page de l'article).
- **Fictif, pour les tests :** un fichier synthétique qui reproduit la structure de Leslie 2022 (aliquotes, notations `<LOD`, astérisques, blancs), plus un fichier synthétique en **nombre de particules** par mL (format µFTIR ou Raman). Les deux sont étiquetés `simulated`, partout.

## 3. Objectifs, non-objectifs, anti-objectifs

**Objectifs v0**
1. Modèle de résultats analytiques standard avec dictionnaire de données exportable.
2. Import CSV et XLSX : lecture, aperçu, correspondance des colonnes (proposition automatique et correction manuelle), validation ligne par ligne avec des messages en français qui indiquent la ligne et la colonne.
3. Règles scientifiques explicites : unités, censure (LOD/LOQ), doublons d'aliquotes, blancs, nature des données.
4. Persistance traçable : fichier original conservé tel quel avec son sha256, chaque import enregistré comme un traitement, journal d'audit en ajout seul.
5. API HTTP et interface web simple en français : études, imports, tableau des résultats, graphiques, rapport téléchargeable (Markdown et HTML) et export CSV avec son dictionnaire.

**Non-objectifs v0** (prévus plus tard) : rôles et permissions fins, multi-laboratoire, export PDF, module IA intégré à Studio, conversion masse ↔ nombre de particules, déploiement en ligne.

**Anti-objectifs** (un échec même si « ça marche ») :
- convertir, imputer ou fusionner des valeurs sans règle documentée et visible ;
- mélanger des concentrations massiques et des comptages de particules dans un même agrégat ou graphique ;
- remplacer une valeur `<LOD` par un nombre (0, LOD/2…) sans que l'utilisateur l'ait choisi et que le rapport le dise ;
- stocker un identifiant personnel direct (nom, date de naissance, adresse e-mail, téléphone, numéro de dossier) ;
- présenter des données simulées comme réelles ;
- modifier ou perdre un fichier source.

## 4. Découpage

Trois sous-projets, chacun livrable et testable seul, dans cet ordre :

| Sous-projet | Contenu | Dépend de |
|---|---|---|
| **B1 — domaine « résultats » dans `core/`** | vocabulaires, unités, censure, schéma standard et dictionnaire, lecture CSV/XLSX, correspondance des colonnes, validation, agrégation des aliquotes, statistiques descriptives honnêtes | rien (Python pur) |
| **B2 — persistance et API (`app/`)** | PostgreSQL, modèle de données §9, migrations, magasin de fichiers, journal d'audit, API FastAPI avec authentification par jeton | B1 |
| **B3 — interface et rapports (`app/`)** | interface Streamlit en français, graphiques, rapport Markdown et HTML, export CSV et dictionnaire | B2 |

**Prérequis A-bis (petit, plan séparé, exécuté avant B1 mais sans le bloquer)** : clôturer le chantier A. Rien n'en est encore fait : aujourd'hui, la couverture est calculée sur toute la grille.
- Règle de couverture : la couverture minimale se mesure sur la **fenêtre diagnostique** de chaque technique, et non plus sur toute la grille : Raman 400–1 800 cm⁻¹, FTIR 600–1 800 cm⁻¹, avec un seuil de 0,8. C'est un choix scientifique : la région d'empreinte digitale porte l'essentiel de l'identification des polymères, et les spectres limités à cette région (environ la moitié de SLoPP) sont légitimes.
- Laser à 785 nm de MicroPlastiX : non documenté dans le dépôt MPX_specDB. Il reste « déduit, à confirmer », et un courriel aux auteurs est à préparer par le fondateur.
- Régénération du rapport de référence.

## 5. Règles scientifiques (le cœur de B1)

**5.1 Grandeurs et unités.** Chaque mesure a une *grandeur* ∈ {`mass_concentration`, `number_concentration`} et une *base* ∈ {`per_volume`, `per_mass`}. Unités acceptées (vocabulaire fermé, avec synonymes pour la saisie) :
- masse par volume : µg/mL (canonique), ng/mL, mg/L (= µg/mL), µg/L ;
- masse par masse : µg/g (canonique), ng/g, mg/kg (= µg/g) ;
- nombre par volume : particules/mL (canonique), particules/L ;
- nombre par masse : particules/g (canonique).

Une conversion n'est permise qu'à l'intérieur d'un même couple (grandeur, base), avec un facteur exact. Tout autre cas est une erreur. La valeur rapportée et son unité d'origine sont toujours conservées. La valeur canonique est calculée et marquée comme calculée.

**5.2 Censure.** Chaque mesure a un *statut* : `quantified` (≥ LOQ), `between_lod_loq`, `below_lod`, `not_analysed`. La lecture accepte les notations courantes : `<LOD`, `< 0,68`, `<LOQ`, `n.d.`, `nd`, `ND`, la virgule décimale, et l'astérisque de Leslie (`*1.2` ou `1.2*`, qui signifie entre LOD et LOQ). Si une LOD et une LOQ sont fournies (par ligne ou par méthode × polymère), le statut déduit de la valeur doit concorder avec le statut déclaré. Sinon, c'est un avertissement (incohérence), jamais une correction silencieuse. Une valeur `below_lod` n'a pas de valeur numérique. Elle peut porter la LOD comme borne supérieure.

**5.3 Aliquotes et doublons.** Un échantillon (donneur × prélèvement) peut avoir plusieurs aliquotes (`a`, `b`…). Agrégation par défaut, documentée et reprise dans le rapport : la moyenne des aliquotes `quantified`. Si aucune aliquote n'est `quantified`, le statut agrégé est le « plus haut » statut observé (`between_lod_loq` > `below_lod`), sans valeur. C'est la règle conservatrice de Leslie 2022.

**5.4 Blancs et contrôles.** Les lignes de contrôle (blanc de procédure, blanc de terrain, matériau dopé) sont importées comme des contrôles qualité, pas comme des échantillons. La correction des blancs n'est **jamais automatique** en v0. Les valeurs sont importées telles que rapportées, avec un champ `blank_corrected` (oui / non / inconnu) déclaré à l'import et affiché dans le rapport.

**5.5 Polymères.** On utilise le vocabulaire `core.polymers`, auquel B1 ajoute un code propre aux résultats : `PS_SUM`. Il désigne la somme des polymères styréniques (PS, PSE, ABS…) mesurée par les techniques thermoanalytiques. La méthode d'analyse porte une technique ∈ {`py_gc_ms`, `ted_gc_ms`, `micro_ftir`, `micro_raman`, `other`}. Pour `py_gc_ms` et `ted_gc_ms`, un polymère « PS » est **toujours** enregistré comme `PS_SUM`, avec un message d'information. Les deux codes ne sont jamais agrégés ensemble. Un polymère `OTHER` est un avertissement.
Une mesure porte un statut d'identification. Par défaut, il est déduit de la technique : `confirmed` pour les quatre techniques d'identification chimique, `candidate` pour `other`. Une colonne `identification_status` explicite l'emporte sur ce défaut.

**5.6 Matrices.** `whole_blood`, `plasma`, `serum`, `other` (texte libre obligatoire si `other`).

**5.7 Données personnelles.** Est bloquante toute colonne dont le nom ou le contenu évoque un identifiant direct : nom, prénom, date de naissance, e-mail, téléphone, adresse, numéro de sécurité sociale ou de dossier. La détection combine des noms en français et en anglais et des motifs d'e-mail, de téléphone et de date complète. L'identifiant d'échantillon doit être pseudonymisé. Le logiciel ne peut pas le vérifier, mais l'utilisateur coche une déclaration.

**5.8 Nature des données.** Chaque étude a une nature ∈ {`published`, `laboratory`, `simulated`}, obligatoire et affichée sur chaque écran, graphique et rapport. Une étude `published` exige une référence : DOI et licence.

**5.9 Statistiques honnêtes.** Pour chaque (polymère, grandeur, unité canonique), on calcule : le nombre d'échantillons par statut, puis le minimum, la médiane, la moyenne et le maximum **sur les seules valeurs quantifiées**, avec cette mention. On n'impute aucune valeur, et on ne fait aucun test statistique en v0.

## 6. Schéma standard (dictionnaire)

Champs obligatoires : `sample_id`, `matrix`, `polymer`, `reported_value` (texte brut, peut contenir `<LOD`), `unit`, `method`.
Champs facultatifs : `aliquot`, `record_type` (`sample` par défaut, ou `procedural_blank`, `field_blank`, `spiked`), `lod`, `loq`, `detection_status` (si déclaré à part), `size_min_um`, `size_max_um`, `identification_status`, `analysis_date`, `batch`, `lab`, `comment`.
Le dictionnaire (nom, libellé en français, type, obligatoire, description, valeurs permises) est généré par le code et exportable en CSV et en Markdown. C'est la même source que celle de la validation.

**Formats longs et larges.** Les tableaux de laboratoire sont souvent « larges » : une colonne par polymère, une ligne par échantillon ou aliquote. La correspondance des colonnes propose donc deux modes :
- *long* : une colonne `polymer` et une colonne `reported_value` ;
- *large* : l'utilisateur associe plusieurs colonnes à des polymères, et l'importeur les dépile en lignes longues, avec la colonne et la ligne d'origine conservées.
Les deux modes produisent la même table standard.

**Limites LOD/LOQ.** Elles proviennent, par ordre de priorité, des colonnes `lod`/`loq` de la ligne si elles sont associées, sinon d'une **table de limites de l'étude** (méthode × polymère → LOD, LOQ, unité), saisie par formulaire ou importée en petit CSV. Si les deux existent et diffèrent, c'est un avertissement. Les limites doivent être dans la même grandeur et la même base que la mesure : une LOD en µg/mL pour une mesure en particules/mL est une erreur.

**Contrôles qualité résumés.** Quand les blancs ne figurent pas ligne par ligne dans le fichier (cas de Leslie 2022 : moyenne, écart-type et n des blancs donnés dans le texte), on les saisit comme des contrôles qualité résumés, par polymère (type, n, moyenne, écart-type, unité, source). Ils apparaissent dans le rapport.

**Double injection.** Les « shots » d'une Py-GC/MS en double injection relèvent de la méthode. Ce ne sont pas des réplicats : une ligne du fichier correspond à une mesure. Il n'y a pas de champ `injection`.

## 7. Choix techniques (décision de l'équipe technique)

- **Langage et structure :** Python ≥ 3.12, dans le même monorepo. B1 vit dans `core/` (package `microtrace_core.results`), sans dépendance web. B2 et B3 vivent dans un nouveau composant `app/` (package `microtrace_app`, sous-packages `db`, `api`, `ui`). `app` dépend de `core` et **jamais** de `ml`.
- **B2 :** FastAPI, SQLAlchemy 2 (ORM typé), Alembic, psycopg 3, Pydantic v2, pydantic-settings.
  - PostgreSQL 17 via `docker compose`, avec une image à version fixée. Les tests utilisent une base dédiée créée et détruite par session pytest ; les tests marqués `db` s'arrêtent avec un message clair si la base est injoignable.
  - Magasin de fichiers : un répertoire adressé par sha256 (`var/files/`, ignoré par Git, configurable).
  - Authentification : entité `User` (nom affiché, jeton haché, actif, date de création). Un seul laboratoire et un seul rôle en v0. Les jetons sont créés par une commande CLI. Chaque écriture enregistre son auteur. Streamlit demande le jeton à la connexion et le garde en mémoire de session, jamais sur disque.
  - Cible de déploiement v0 : une seule machine (poste du laboratoire), avec `docker compose` (PostgreSQL, API, interface). En développement, l'API et l'interface tournent en Python local et seule la base est dans Docker. L'intégration continue est hors périmètre.
- **B3 :** Streamlit (interface en français) qui appelle l'API, avec des graphiques Altair. Le rapport est généré côté API en Markdown, puis converti en HTML autonome.
- **Ce qui est laissé au constructeur :** les noms de modules internes, la mise en page de l'interface, le style du rapport, les index de la base, les détails de configuration de pytest.

## 8. Modèle de données (B2, reprise du plan §9)

`Project` → `Study` (nature, référence, `blank_corrected`, déclaration de pseudonymisation) → `Sample` (`sample_id` pseudonymisé, matrice, type d'enregistrement) → `Measurement` (aliquote, polymère, valeur rapportée brute, valeur numérique, unité d'origine, valeur canonique, unité canonique, statut, LOD, LOQ, statut d'identification, ligne source). Entités associées :
- `AnalyticalMethod` (technique, paramètres, version du protocole, laboratoire) ;
- `QualityControl` (lignes de contrôle reliées à l'étude) ;
- `DataFile` (nom d'origine, sha256, taille, date, auteur) ;
- `ImportRun` (le `ProcessingRun` du plan : fichier, correspondance des colonnes, version du code et des règles, issues de validation, décision, date) ;
- `Reference` (DOI, licence) ;
- `AuditEvent` (auteur, action, entité, identifiant, avant/après en JSON, horodatage) en **ajout seul** : aucune mise à jour ni suppression par l'API.

Un import ne crée des mesures que s'il n'a **aucune erreur bloquante**, et seulement après une acceptation explicite des avertissements.

**Corrections.** Une mesure n'est jamais modifiée sur place. Pour corriger, on **retire** l'import concerné : son statut passe à `retired`, avec un motif obligatoire et un événement d'audit. Ses mesures sont conservées mais exclues des vues, graphiques et rapports. On réimporte ensuite le fichier corrigé. Réimporter un fichier de même sha256 dans la même étude est refusé tant que l'import précédent n'est pas retiré. Une étude peut être archivée, jamais supprimée.

Entités ajoutées par ces décisions : `User` (voir §7), `DetectionLimit` (table de limites de l'étude : méthode × polymère → LOD, LOQ, unité, source), `QualityControlSummary` (contrôles résumés par polymère), et le statut `active | retired` de `ImportRun`, avec son motif.

## 9. Réussite mesurable

- **B1 :** le fichier synthétique « façon Leslie » s'importe avec 0 erreur. Chaque piège injecté (unité inconnue, mélange masse/nombre, `<LOD` avec valeur, colonne « nom », LOD > LOQ, doublon d'aliquote) produit exactement l'issue attendue, avec sa ligne et sa colonne.
- **B2 :** un aller-retour import → lecture via l'API restitue les valeurs rapportées à l'identique. Chaque écriture produit un événement d'audit. Le fichier original est récupérable octet pour octet.
- **B3 :** à partir du tableau S2 réel de Leslie 2022, un utilisateur produit le rapport. Ses **fréquences de quantification par donneur** concordent exactement avec l'article (§3.2). Le comptage se fait par donneur : un donneur compte pour un polymère si au moins une de ses aliquotes est `quantified`. Les valeurs attendues sont : 77 % des donneurs (17/22) avec au moins un polymère > LOQ ; PET 50 % (11/22), PS 36 % (8/22), PE 23 % (5/22), PMMA 5 % (1/22), PP 0 % (0/22). Les maxima par mesure doivent aussi concorder : PET 2,4, PS 4,8 et PE 7,1 µg/mL.
  - Cette « fréquence de quantification par donneur » est une statistique à part entière de B1, distincte de l'agrégation des valeurs (§5.3).
  - L'article ne donne pas de médianes, donc il n'y a pas de critère sur les médianes.
  - La moyenne de 1,6 µg/mL de l'article traite les valeurs < LOQ comme des zéros. C'est une imputation, que v0 ne fait pas : elle n'est pas un critère.
  - Si le tableau S2 n'est pas disponible au moment de B3, le critère s'applique à un fichier synthétique construit pour reproduire ces fréquences et ces maxima, étiqueté `simulated`. Le critère réel reste à vérifier dès que S2 est fourni.
