# C5 — Aide à l'identification spectrale (Raman / FTIR) — conception détaillée

**Date :** 2026-10-31
**Statut :**
- Le fondateur délègue les choix techniques ; il testera dans le navigateur après C7, C5 et C6.
- Les huit décisions du contrôleur du 2026-10-31 sont **contraignantes** : ce document les précise sans les renverser (rappel en §0).
- Versions : modèle `c5-spectral` version `s1` (`SPECTRAL_MODEL_VERSION`), indépendant des règles B1 (`RULES_VERSION`) et des règles de qualité (`q1`).

**Sources :**
- `docs/superpowers/specs/2026-10-25-prototype-studio-design.md` : §2 (anti-objectifs), §3 (contrat du moteur), §10 (« Principes communs », « C5 », « Cycle de vie des modèles »), §11 (multi-laboratoires) ;
- `docs/superpowers/specs/2026-10-30-c7-qualite-design.md` et son plan : format, décisions humaines append-only, isolation, arrondi d'affichage ;
- `docs/superpowers/plans/2026-10-23-chantier-a-catalogue-spectral.md`, `reports/baseline/report.md` et `metrics.json` : catalogue, séparations, baseline ;
- `datasets/SOURCES.md` : licences des bibliothèques ;
- code : `core/src/microtrace_core/{catalog,preprocess,spectrum,polymers}.py`, `readers/`, `ml/src/microtrace_ml/{matching,classifier,splits,evaluate}.py`, `engine/src/microtrace_engine/{app,schemas,uploads,quality_text,settings}.py`, `web/src/server/{quality,file-store,audit,members}.ts`, `web/prisma/schema.prisma`, `web/src/server/__tests__/tenant-isolation.test.ts`.

Les chiffres des §3, §5 et §12 ont été **calculés** le 2026-10-31 dans le `.venv` du dépôt, sur le catalogue `data/processed/spectra_catalog.parquet` (construit au commit `70b18f7`, sha256 `f6c1b0da…63dc2` ; le prétraitement n'a pas changé depuis), avec les fonctions de `microtrace_core` et `microtrace_ml`. Ils ne sont pas estimés. La commande d'entraînement (§5) les recalcule ; un écart au-delà des tolérances du plan arrête l'implémentation.

---

## 0. Décisions du contrôleur (rappel)

| # | Décision | Où elle est précisée |
|---|---|---|
| 1 | Pipeline du chantier A (prétraitement, corrélation sur la fenêtre diagnostique, PCA+SVM) réentraîné sur tout le catalogue par une commande de `core` (graine fixe) ; évaluation par bibliothèque tenue à part (LOLO) ; seuils d'abstention choisis sur cette validation ; sortie top-3, 5 références, statut `identifié \| incertain \| non identifié`. Poids dans `models/` (ignoré par Git), sha256 vérifié par le moteur ; manifeste d'entraînement versionné dans `docs/models/`. CPU. Arrêt si la baseline n'est pas reproduite. | §4, §5, §6 |
| 2 | Classe « non plastique » seulement avec des données publiques déjà présentes et de licence compatible ; sinon abstention et phrase « pas de classe non plastique dans cette version ». Aucun téléchargement. | §3.3 |
| 3 | `POST /ai/spectral/identify` et `GET /ai/spectral/model`, limites de taille, textes français dans le moteur, références sous-échantillonnées pour le graphique. | §7 |
| 4 | Onglet « Spectres » : dépôt, proposition, graphique superposé (Recharts, jetons), décision humaine `ModelPrediction` kind `spectral`, fichier dans le magasin existant, badge « Modèle d'essai », limites, lecture seule pour `viewer`, audit, isolation. | §8, §9 |
| 5 | Consentement du laboratoire (désactivé par défaut, `lab_admin`, daté, révocable, audité, visible dans Membres) et export JSON/CSV des décisions acceptées ou corrigées, sans donnée d'un autre laboratoire. Migration Prisma. | §10 |
| 6 | Fiche `docs/models/c5-spectral.md`. | §11 |
| 7 | Points de relecture imposés. | §13 |
| 8 | Découpage en tâches. | plan `docs/superpowers/plans/2026-10-31-c5-spectral.md` |

## 1. Intention

Un chercheur a mesuré une particule en micro-Raman ou en micro-FTIR. Il veut savoir **à quoi ressemble** son spectre parmi les bibliothèques publiques de polymères, avec une réponse honnête :
- les 3 polymères les plus probables et leur score ;
- les 5 spectres de référence les plus proches, superposés au sien, avec leur bibliothèque et leur licence ;
- un statut qui dit clairement quand le modèle **ne sait pas** (abstention).

Il enregistre ensuite sa décision (acceptée, corrigée, rejetée), qui est tracée. Rien n'est jamais enregistré comme mesure. Le laboratoire peut, plus tard et seulement s'il y consent, exporter ses décisions validées pour l'amélioration des modèles.

## 2. Anti-objectifs (un échec même si « ça marche »)

Ceux de la spec §2 et du §10 « Principes communs » s'appliquent. Pour C5 :

1. **Aucune fuite entre bibliothèques à l'évaluation.** Une bibliothèque n'est jamais à la fois dans l'apprentissage (références, PCA, SVM) et dans le test d'un même pli, ni dans le choix des seuils qui servent à estimer sa propre précision (§5.4).
2. **L'abstention est réelle.** Un spectre de bruit, d'un polymère absent, mal réglé (technique, laser) ou trop incomplet donne `non identifié`. Des taux d'abstention mesurés figurent dans la fiche.
3. **Aucune identification de santé**, aucune mesure créée, aucune imputation. Une proposition acceptée n'ajoute rien aux Résultats.
4. **Aucune courbe tierce affichée sans licence confirmée** qui autorise sa diffusion (§3.2).
5. **Aucune règle ni aucun calcul spectral en TypeScript.** Le web transmet le fichier, enregistre la réponse du moteur et l'affiche.
6. **Le moteur ne sert jamais des poids dont l'empreinte diffère** de celle du verrou versionné (§6).
7. **Aucune donnée d'un laboratoire chez un autre**, ni à l'écran, ni dans une décision, ni dans un export ; aucun export sans consentement actif.
8. **Rien n'est modifié ni supprimé** : chaque analyse et chaque décision est une nouvelle ligne `ModelPrediction` ; le journal est en ajout seul.
9. **Aucun contenu de fichier, nom de fichier ou note** dans les journaux du moteur ou dans `console.*`.

## 3. Données

### 3.1 Catalogue utilisé

Spectres retenus : polymère connu (ni `UNKNOWN` ni `OTHER`) et couverture de la fenêtre diagnostique ≥ 0,8 (`MIN_COVERAGE` du chantier A). Les exclusions sont celles de la baseline (FTIR : 3 `OTHER` ; Raman : 14 `UNKNOWN`, 7 `OTHER`).

| Technique | Bibliothèque (`source`) | Spectres | Groupes | Polymères |
|---|---|---|---|---|
| FTIR (ATR) | `flopp` | 185 | 185 | ABS, ACRYLIC, CELLULOSE, EVA, PA, PC, PE, PET, PLA, PP, PS, PU, PVC, RUBBER |
| | `flopp_e` | 193 | 193 | ABS, CA, CELLULOSE, EVA, PA, PC, PE, PET, PMMA, PP, PS, PU, PVC |
| | `mpx` | 3 832 | 17 | PE, PET, PLA, PP, PS |
| | **total** | **4 210** | | 16 polymères |
| Raman | `mpx` (532 et 785 nm) | 1 977 | 19 | PE, PET, PLA, PP, PS |
| | `raman_weathered` | 165 | 165 | ABS, NC, PA, PC, PE, PET, PP, PS, PVC |
| | `raspi` (523 et 633 nm) | 396 | 272 | ABS, PA, PC, PE, PET, PMMA, POM, PP, PS, PTFE, PU, PVC, SILICONE |
| | `slopp` | 148 | 148 | ABS, ACRYLIC, CA, CELLULOSE, EVA, PA, PC, PE, PET, PMMA, PP, PS, PU, PVC |
| | `slopp_e` | 106 | 106 | ABS, ACRYLIC, CA, CELLULOSE, PA, PC, PE, PET, PMMA, PP, PS, PU, PVC, RUBBER |
| | **total** | **2 792** | | 20 polymères |

Aucun spectre brut n'est identique d'une bibliothèque à l'autre (vérifié sur `y_raw`) ; un seul doublon interne (RaSPI `PET5a/b`, déjà signalé dans `SOURCES.md`).

### 3.2 Licences et affichage des références

| Code | Bibliothèque | Citation | Licence (`SOURCES.md`) | Courbe affichée |
|---|---|---|---|---|
| `mpx` | MicroPlastiX SpecDB | Lenz R. et al. (2023), doi:10.22000/1820 | CC BY-SA 4.0 | **oui**, avec l'attribution |
| `flopp`, `flopp_e` | FLOPP / FLOPP-e | De Frond H., Rubinovitz R., Rochman C. (2021) | à compléter | non |
| `slopp`, `slopp_e` | SLoPP / SLoPP-E | Munno K. et al. (2020) | à compléter | non |
| `raspi` | RaSPI | à compléter | à compléter | non |
| `raman_weathered` | Base Raman de microplastiques vieillis en milieu naturel | à compléter | à compléter | non |

Règle (décision R-C5-1) :
- toutes les bibliothèques servent au modèle d'essai (usage de recherche interne, déjà celui de la baseline) ;
- une référence est **citée** (bibliothèque, identifiant, polymère, score, licence) quelle que soit sa licence ;
- sa **courbe** n'est renvoyée et affichée que si sa licence est confirmée et autorise la diffusion avec attribution (`curve_allowed`). Sinon la ligne porte « Licence à confirmer : courbe non affichée. » ;
- la table vit dans `core` (`microtrace_core.spectral.libraries.LIBRARIES`) et un test la confronte à `SOURCES.md` : une licence « À compléter » impose `curve_allowed = False`.

La confirmation des licences « À compléter » avant toute présentation aux laboratoires est une question pour le fondateur (§14).

### 3.3 Classe « non plastique » : non retenue

Données locales examinées :
- **RaMPI** : `SOURCES.md` et le dossier ne contiennent que les **métadonnées** (34 cartes), pas les spectres ;
- **`raw.rds`, `nobaseline.rds`, `derivative.rds`** (probablement Open Specy, qui contient des matériaux non plastiques) : licence « À compléter », format R illisible sans une nouvelle dépendance (`pyreadr`) ;
- les bibliothèques cataloguées n'ont ni protéine, ni minéral, ni fond. Seule la **cellulose** (coton, cellulose teinte : 26 spectres FTIR, 21 Raman) est une fibre naturelle : elle reste une classe nommée, libellée « Cellulose (fibre naturelle, non plastique) ».

Conséquence : **pas de classe non plastique dans cette version**. Le modèle s'abstient hors des polymères connus (§4.4), la fiche et l'écran le disent, et les corrections humaines peuvent déjà porter le code `NOT_PLASTIC` (§8.3), qui alimentera une future classe négative. Le suivi reçoit : « classe non plastique : spectres RaMPI à télécharger et bibliothèques Open Specy (`pyreadr`), licences à confirmer ».

## 4. Le modèle `s1`

### 4.1 Pipeline d'une requête

1. **Lecture** du fichier texte à deux colonnes (§7.3), puis construction d'un `Spectrum` (technique, unité de l'axe, unité de l'ordonnée, laser).
2. **Prétraitement** : `preprocess` du chantier A, **inchangé** (conversion nm → cm⁻¹ par le laser, transmittance → absorbance, tri, rééchantillonnage sur la grille de la technique, ligne de base ALS, min-max). La requête et les références passent par exactement la même fonction.
3. **Couverture** de la fenêtre diagnostique (`diagnostic_coverage`) : < 0,8 → abstention `low_coverage`.
4. **Corrélation de Pearson sur la fenêtre diagnostique** (Raman 400–1 800 cm⁻¹, 351 points ; FTIR 600–1 800 cm⁻¹, 301 points) avec chaque spectre de référence, sur les points finis communs, recouvrement minimal 0,5 de la fenêtre (`correlation_matrix`, extraite de `CorrelationMatcher`).
5. **Score par polymère** = meilleure corrélation parmi ses références. Top-3 des polymères ; marge = score n° 1 − score n° 2.
6. **5 références les plus proches** = les 5 meilleures corrélations individuelles (tous polymères).
7. **Second avis** : PCA (30 composantes, `svd_solver="full"`) puis SVM RBF équilibré, appris sur la fenêtre diagnostique (NaN → 0). Il donne un polymère, sans score.
8. **Garde de technique** (§4.3), puis **statut** (§4.2).

**Pourquoi la fenêtre diagnostique et non la grille entière** (la baseline corrélait sur toute la grille) : sur la validation LOLO, l'exactitude du rang 1 est équivalente ou meilleure (FTIR 0,858 contre 0,849 ; Raman 0,889 contre 0,890), et l'abstention devient efficace en Raman : 88,3 % des spectres de polymères absents de l'apprentissage tombent sous 0,5 (contre 17 % sur la grille entière, où le PLA absent se corrèle à 0,83–0,86 par sa région C–H).

**Pourquoi le SVM ne décide pas seul :** en LOLO, il fait moins bien que la corrélation (FTIR 0,768, Raman 0,776), mais quand il est d'accord avec la corrélation, celle-ci a raison à 93,6 % (FTIR) et 96,0 % (Raman), contre 55,7 % et 62,8 % en désaccord. L'accord est donc une condition de « identifié ».

### 4.2 Statut

Pour la technique de la requête, avec ses seuils `T_unc ≤ T_id` et `M_id` (§5.3) et `s1`, `s2` arrondis à 12 chiffres significatifs (règle R-C7-1) :

| Statut | Condition |
|---|---|
| `not_identified` | couverture < 0,8 (`low_coverage`) ; ou aucune paire valide (`no_overlap`) ; ou garde de technique (`technique_mismatch`) ; ou `s1 < T_unc` (`low_score`) |
| `identified` | `s1 ≥ T_id` **et** `s1 − s2 ≥ M_id` **et** le SVM propose le même polymère que la corrélation |
| `uncertain` | sinon (`s1 ≥ T_unc`) |

Comparaisons : `≥` inclusif pour « identifié » et l'entrée en « incertain », `<` strict pour l'abstention ; des tests vérifient les bornes exactes. Le texte affiché ne contredit jamais le statut (même règle d'arrondi que C7, fonction `_vs_threshold` déplacée dans `microtrace_engine/numbers.py`).

Sens donné aux statuts (repris dans la fiche, avec les chiffres mesurés) :
- **identifié** : en LOLO, le polymère proposé était juste dans au moins 95 % des cas, et dans au moins 90 % pour chaque bibliothèque tenue à part ;
- **incertain** : le bon polymère figurait parmi les 3 propositions dans au moins 95 % des cas où le score dépasse `T_unc` ; c'est une piste, pas une réponse ;
- **non identifié** : aucune proposition n'est faite. Les 3 polymères et les 5 références restent visibles « à titre indicatif » (sauf `low_coverage` et `no_overlap`, où il n'y en a pas).

### 4.3 Garde de technique (mauvaise technique déclarée)

Pour un axe en cm⁻¹ et une ordonnée qui n'est pas une transmittance, le spectre est aussi prétraité comme l'**autre** technique (FTIR → ordonnée « absorbance », Raman → « intensité ») et corrélé à l'autre bibliothèque. Si, pour l'autre technique, la couverture est ≥ 0,8, `s1_autre ≥ T_unc(autre)` et `s1_autre − s1 ≥ TECHNIQUE_MISMATCH_MARGIN = 0,10`, le statut est `not_identified` (`technique_mismatch`) : « ce spectre ressemble davantage à un spectre FTIR ; vérifiez la technique choisie ».

Mesures du 2026-10-31 (200 spectres tirés au hasard, graine 1 et 2, référence identique exclue) : un spectre FTIR déclaré Raman est signalé 199 fois sur 200, un Raman déclaré FTIR 184 fois sur 200 ; faux signalements sur des spectres bien déclarés : 0/200 en FTIR, 5/200 en Raman. Un faux signalement donne une abstention (prudente), et la fiche le dit.

### 4.4 Ce qui provoque une abstention (mesuré)

| Cas | Comportement attendu |
|---|---|
| bruit (100 tirages, grilles Raman et FTIR) | `s1` maximal 0,30 (Raman) et 0,29 (FTIR) : `low_score` partout |
| polymère absent de l'apprentissage (LOLO) | Raman : 88,3 % `non identifié`, 2,5 % `identifié` (sur 315) ; FTIR : 48 % `non identifié`, 8 % `identifié` (sur 25) |
| spectre Raman en nm, laser 532 déclaré 785 ou 633 nm | couverture 0 à 0,23 : `low_coverage` (100 sur 100) |
| mauvaise technique | §4.3 |
| FTIR en transmittance déclaré absorbance | bandes inversées, corrélation négative ou faible : abstention attendue ; condition d'échec écrite dans la fiche |

### 4.5 Constantes

Dans `microtrace_core.spectral` (la fiche les reprend) :

| Constante | Valeur |
|---|---|
| `SPECTRAL_MODEL_NAME`, `SPECTRAL_MODEL_VERSION` | `"c5-spectral"`, `"s1"` |
| `SEED` | 0 |
| `MIN_COVERAGE` | 0,8 (fenêtre diagnostique) |
| `MIN_OVERLAP` | 0,5 |
| `PCA_COMPONENTS` | 30 (`svd_solver="full"`) |
| SVM | `SVC(kernel="rbf", C=1.0, gamma="scale", class_weight="balanced")` |
| `N_CANDIDATES`, `N_REFERENCES` | 3, 5 |
| `TECHNIQUE_MISMATCH_MARGIN` | 0,10 |
| `PLOT_STRIDE` | 2 (un point sur deux de la grille, soit 8 cm⁻¹) |
| `MAX_SPECTRUM_BYTES`, `MAX_POINTS`, `MIN_POINTS`, `MAX_HEADER_LINES` | 2 Mio, 100 000, 10 (`spectrum.MIN_POINTS`), 50 |
| `LASER_NM_RANGE` | [200, 1 100] |

## 5. Entraînement et évaluation

### 5.1 Commande

```
python -m microtrace_core train-spectral --catalog data/processed/spectra_catalog.parquet \
  --baseline reports/baseline/metrics.json --models models \
  --manifest docs/models/c5-spectral-manifest.json --data-list docs/models/c5-spectral-s1-data.sha256 \
  --lock engine/src/microtrace_engine/spectral_model.lock.json --card docs/models/c5-spectral.md [--check]
```
- CPU, graine 0, déterministe : deux exécutions sur la même machine donnent des poids **identiques à l'octet** (test).
- `scikit-learn` n'est importé que par `microtrace_core.spectral.train` (extra `core[train]`). L'inférence n'utilise que numpy (§6) : le moteur ne gagne aucune dépendance et `engine/constraints.txt` ne change pas.
- `--check` réentraîne en mémoire et compare l'empreinte au manifeste, sans rien écrire (code 4 si elle diffère).
- Codes de sortie : 0 ; 3 baseline non reproduite ; 4 empreinte différente (`--check`) ; 5 aucun seuil ne satisfait les critères.

### 5.2 Étapes

1. **Porte de reproduction de la baseline.** La corrélation `correlation@0` sur la **grille entière**, en LOLO, est recalculée et comparée à `reports/baseline/metrics.json` (`loso.pooled["correlation@0"].accuracy`) : FTIR **0,848746**, Raman **0,890190**. Écart > 0,005 → arrêt (code 3), rien n'est écrit. Mesuré le 2026-10-31 : 0,849 et 0,890, identiques.
2. **LOLO du modèle `s1`.** Par technique, pour chaque bibliothèque `h` : références, PCA et SVM appris **sans** `h` ; prédictions sur `h`. Une requête dont le polymère n'existe pas hors de `h` est comptée « hors bibliothèque » (`out_of_library`) : elle mesure le comportement face à un polymère absent.
3. **Choix des seuils** sur toutes les prédictions LOLO (§5.3).
4. **Estimation imbriquée** (§5.4).
5. **Garde de technique en LOLO** : chaque requête est aussi corrélée à l'autre technique **sans la bibliothèque `h`** (pour `mpx`, présente dans les deux) ; ses signalements entrent dans les taux de statut publiés.
6. **Mauvaise technique** : chaque requête LOLO en cm⁻¹ est soumise comme l'autre technique (références de l'autre technique sans `h`) ; la part de `non identifié` est publiée.
7. **Modèle final** : appris sur tout le catalogue retenu (§3.1), avec les seuils de l'étape 3. Contrôle : les prédictions du SVM numpy (§6) sont identiques à celles de scikit-learn sur tout l'apprentissage, sinon arrêt.
8. **Écritures** : poids, manifeste, liste des empreintes des données, verrou du moteur, bloc de métriques de la fiche (entre `<!-- BEGIN:metrics -->` et `<!-- END:metrics -->`, rendu par `render_card_metrics(manifest)` ; un test vérifie que le bloc versionné est à jour).

### 5.3 Procédure de choix des seuils (déterministe)

Sur les prédictions LOLO **dans la bibliothèque** d'une technique :

- **`T_id`, `M_id`** : parmi `T_id ∈ {0,70 ; 0,75 ; … ; 0,95}` et `M_id ∈ {0 ; 0,01 ; 0,02 ; 0,03 ; 0,05 ; 0,10}`, on garde le couple qui **maximise la part de « identifié »** sous trois contraintes :
  1. précision globale de « identifié » ≥ 0,95 ;
  2. précision ≥ 0,90 pour chaque bibliothèque tenue à part qui a au moins 20 « identifié » ;
  3. part de « identifié » parmi les requêtes hors bibliothèque ≤ 0,10 (si elles sont au moins 20).
  En cas d'égalité : `T_id` puis `M_id` les plus grands. Aucun couple → code 5. Le plancher 0,70 est un choix de prudence : en dessous, une corrélation n'est jamais appelée « identifié ».
- **`T_unc`** : le plus petit `T ∈ {0,50 ; 0,55 ; … ; 0,95}`, `T ≤ T_id`, tel que, parmi les requêtes de score ≥ `T`, le bon polymère est dans le top-3 dans ≥ 95 % des cas au global et ≥ 90 % par bibliothèque (au moins 20 requêtes) ; à défaut, `T_unc = T_id`. Le plancher 0,50 : sous r = 0,5, les deux spectres partagent moins d'un quart de leur variance.

Valeurs **attendues** (exploration du 2026-10-31 ; la commande les recalcule) :

| Technique | `T_unc` | `T_id` | `M_id` | « identifié » (dans la bibliothèque) | précision | pire bibliothèque | hors bibliothèque « identifié » |
|---|---|---|---|---|---|---|---|
| FTIR | 0,85 | 0,85 | 0,10 | 63,2 % | 97,6 % | 97,5 % | 8 % (2/25) |
| Raman | 0,50 | 0,70 | 0,00 | 73,1 % | 97,7 % | 95,7 % | 2,5 % |

Répartition attendue des statuts (dans la bibliothèque, avant la garde) : FTIR 63,2 % identifié, 15,1 % incertain, 21,7 % non identifié ; Raman 73,1 %, 22,0 %, 4,9 %. Le FTIR s'abstient beaucoup plus : ses polymères absents (caoutchouc, acrylique) se corrèlent fortement au PE, et seul un seuil haut les écarte. La fiche le dit.

### 5.4 Estimation imbriquée (sans fuite du seuil)

Les seuils du §5.3 sont choisis et mesurés sur les mêmes prédictions : la précision affichée serait optimiste. La commande refait donc, pour chaque bibliothèque `h`, le choix des seuils **sur les prédictions des autres bibliothèques seulement**, l'applique à `h`, et publie la précision de « identifié » ainsi obtenue. Exploration : FTIR 97,2 à 98,1 % selon la bibliothèque, Raman 95,7 à 98,3 %. C'est ce chiffre que l'écran et la fiche donnent comme « précision estimée ».

### 5.5 Manifeste et données

`docs/models/c5-spectral-manifest.json` (versionné) :
- `model` : `name`, `version`, `file` (`c5-spectral-s1.npz`), `sha256`, `size_bytes` ;
- `trained_at` (date ISO), `code` : `git_commit`, `git_dirty`, `preprocess_version`, versions de numpy, scipy, scikit-learn et Python ;
- `data` : sha256 du catalogue Parquet, `built_at` et `git_commit` de `catalog_meta.json`, effectifs par technique, bibliothèque et polymère, exclusions, chemin et sha256 de la liste des empreintes ;
- `params` : constantes du §4.5, grilles et critères du §5.3 ;
- `thresholds` par technique ;
- `baseline_reproduction` : attendu, mesuré, écart ;
- `metrics` par technique : LOLO global et par bibliothèque (n, dans la bibliothèque, hors bibliothèque, top-1, top-3, exactitude du SVM, parts des trois statuts dans et hors bibliothèque, précision de « identifié » et précision imbriquée, top-1 et top-3 des « incertain », signalements de la garde), mauvaise technique, rappel par polymère.

`docs/models/c5-spectral-s1-data.sha256` (versionné, format `sha256sum`) : une ligne `<sha256>  Spectres/<fichier>` par fichier source contribuant au moins une référence (colonne `file_sha256` du catalogue ; environ 6 600 lignes). Un test marqué `data` relit les fichiers de `datasets/` et vérifie la liste.

La **date** et le **commit** ne sont que dans le manifeste, jamais dans les poids : sinon l'empreinte changerait à chaque commit.

## 6. Poids, empreinte et chargement

**Format :** une archive `.npz` (zip de `.npy`) écrite par `write_archive` de façon **déterministe** (noms triés, date fixe 1980-01-01, `ZIP_DEFLATED` niveau 6), et lue **uniquement** par `np.load(..., allow_pickle=False)`. Aucun pickle, aucun objet scikit-learn : un fichier de poids ne peut pas exécuter de code.

Contenu, par technique `t` :
- `t/refs` (float32, références sur la fenêtre, NaN conservés), `t/plot` (float16, courbes sur la grille au pas de 8 cm⁻¹), `t/plot_x`, `t/ids`, `t/labels`, `t/sources` (tableaux unicode) ;
- `t/pca_mean`, `t/pca_components`, `t/svm_support_vectors`, `t/svm_dual_coef`, `t/svm_intercept`, `t/svm_n_support`, `t/svm_classes`, `t/svm_gamma` ;
- `meta` : JSON (0-d unicode) avec nom, version, grilles, fenêtres, constantes, seuils et le résumé des métriques du §5.5 (sans date ni commit).

Taille attendue : environ 15 Mo non compressés. Au-delà de 50 Mo, arrêt.

**Inférence numpy :** `pca_transform(mean, components, X) = (nan_to_num(X) − mean) @ componentsᵀ` ; `svm_predict` = décision un-contre-un de libsvm (noyau RBF, votes, premier maximum), testée égale à `SVC.predict` (synthétique, et sur tout l'apprentissage réel).

**Verrou :** `engine/src/microtrace_engine/spectral_model.lock.json` (versionné, données du paquet) = `{name, version, file, sha256}`, écrit par la commande ; un test vérifie qu'il est égal au manifeste.

**Chargement par le moteur** (`SpectralModelStore`) :
- dossier `ENGINE_MODELS_DIR` (défaut `models`, relatif au dossier courant ; les tests de bout en bout et `docker compose` le fixent) ;
- au premier appel d'une route spectrale : lecture des octets, sha256, comparaison au verrou **avant** tout `np.load` (sur ces mêmes octets en mémoire, sans relecture), puis contrôle de forme ;
- états : `ok`, `missing` (fichier absent), `sha_mismatch`, `invalid` (archive illisible ou incomplète) ; l'état est mis en cache jusqu'au redémarrage du moteur ;
- le moteur démarre toujours : les autres routes ne dépendent pas du modèle.

## 7. Contrat du moteur

Points communs avec les autres routes : secret `X-Engine-Secret`, `SecretAndSizeGate`, `ErrorModel` en français, aucun contenu de fichier ni nom de fichier dans les journaux (test d'hygiène étendu), OpenAPI régénéré puis `npm run gen:engine`.

### 7.1 `POST /ai/spectral/identify`

Corps multipart :

| Partie | Valeurs |
|---|---|
| `file` | texte à deux colonnes, 2 Mio au plus |
| `technique` | `raman` \| `ftir_atr` |
| `x_unit` | `cm-1` \| `nm` (nm : Raman seulement) |
| `y_unit` | `intensity` (Raman) \| `absorbance` \| `transmittance_pct` (FTIR) |
| `laser_nm` | obligatoire en Raman, nombre entre 200 et 1 100 ; interdit en FTIR |

Les parties sont lues comme du texte et validées par le moteur, avec des messages fixes (422) :
- « Technique inconnue : choisissez Raman ou FTIR (ATR). »
- « Unité de l'axe inconnue. » ; « Un axe en longueur d'onde (nm) n'est possible qu'en Raman. »
- « Unité de l'ordonnée incompatible avec la technique. »
- « Indiquez la longueur d'onde du laser (nm) pour un spectre Raman. » ; « Longueur d'onde du laser invalide (entre 200 et 1 100 nm). » ; « Pas de laser pour un spectre FTIR. »
- fichier > 2 Mio : 413 « Fichier trop volumineux (limite : 2 Mo). »
- modèle indisponible : **503** avec le message de l'état (§7.2).

Réponse `SpectralIdentifyResponse` :

| Champ | Contenu |
|---|---|
| `model` | `{name, version, sha256}` |
| `trial_label`, `trial_sentence` | « Modèle d'essai » ; « Modèle d'essai : entraîné sur des données publiques, pas encore sur les vôtres. » |
| `input` | `sha256`, `size`, `n_points`, `x_min`, `x_max`, `technique`, `technique_label`, `x_unit`, `y_unit`, `laser_nm`, `diagnostic_coverage`, `window_min`, `window_max` |
| `status`, `status_label` | `identified` « Identifié (proposition) » \| `uncertain` « Incertain » \| `not_identified` « Non identifié (abstention) » |
| `abstention` | `null` \| `low_score` \| `low_coverage` \| `technique_mismatch` \| `no_overlap` |
| `explanation` | phrase française (§7.4) |
| `candidates` | ≤ 3 × `{rank, polymer, label, score, score_text}` (`score_text` à 3 décimales) |
| `margin` | nombre ou `null` |
| `classifier_polymer`, `classifier_label` | second avis PCA+SVM, ou `null` |
| `references` | ≤ 5 × `{rank, spectrum_id, library, library_name, citation, licence_text, polymer, label, score, score_text, curve: {x, y} \| null, curve_note}` |
| `query_curve` | `{x, y}` : spectre prétraité, pas de 8 cm⁻¹, points finis seulement |
| `x_label`, `y_label` | « Déplacement Raman (cm⁻¹) » ou « Nombre d'onde (cm⁻¹) » ; « Intensité normalisée (après prétraitement) » |
| `thresholds` | `{uncertain_min_score, identified_min_score, identified_min_margin, classifier_agreement_required: true}` |
| `limits` | phrases françaises (§7.4) |
| `correction_vocabulary` | `[{code, label}]` : les 20 codes canoniques, `OTHER` « Autre polymère », `NOT_PLASTIC` « Non plastique », triés par libellé |

Taille : 6 courbes de 369 à 426 points, soit environ 40 Ko de JSON.

### 7.2 `GET /ai/spectral/model`

`SpectralModelInfo` (toujours 200) :
- `available`, `reason` (`missing` \| `sha_mismatch` \| `invalid` \| `null`), `message` :
  - « Modèle spectral absent : lancez l'entraînement (python -m microtrace_core train-spectral). »
  - « Le fichier du modèle spectral ne correspond pas à l'empreinte attendue : il n'est pas utilisé. »
  - « Le fichier du modèle spectral est illisible : il n'est pas utilisé. » ;
- `name`, `version`, `expected_sha256` (du verrou), `sha256` (`null` si indisponible) ;
- `trial_label`, `trial_sentence`, `limits`, `card_path` (`docs/models/c5-spectral.md`), `max_bytes`, `max_points` ;
- `techniques` (vide si indisponible) : `technique`, `label`, `n_references`, `polymers [{code, label}]`, `window_min`, `window_max`, `thresholds`, `metrics` (top-1, top-3, parts des statuts dans et hors bibliothèque, précision imbriquée de « identifié », effectifs) ;
- `libraries` : `code`, `name`, `citation`, `licence_text`, `curve_allowed`, `n_ftir_atr`, `n_raman`.

### 7.3 Lecture du fichier (`microtrace_core.spectral.reading.parse_two_columns`)

Formats acceptés : un seul spectre, deux colonnes numériques (x, y), en-tête facultatif. Cela couvre les fichiers à spectre unique lus par le chantier A : FLOPP (CSV sans en-tête), SLoPP (tabulation), MicroPlastiX (CSV, une ligne d'en-tête), base Raman vieillie (blancs). Le fichier multi-spectres RaSPI, JCAMP-DX (`.dx`, `.jdx`) et `.spa` (binaire Thermo) ne sont pas acceptés dans cette version.

Règles :
- décodage UTF-8 (BOM accepté), sinon Latin-1 ; un octet nul → `binary` ;
- une ligne commençant par `##` avant toute donnée → `jcamp` ;
- séparateur par ligne : tabulation, `;`, `,` ou blancs. Avec `;`, tabulation ou blancs, la virgule décimale est acceptée ;
- jusqu'à 50 lignes d'en-tête non numériques avant la première ligne de données (`too_many_header_lines` au-delà) ;
- après le début des données : lignes vides ignorées, cellules vides finales ignorées ; exactement deux nombres par ligne. Une ligne non numérique → `non_numeric_row` (numéro de ligne, **jamais son contenu**) ; plus de deux nombres → `too_many_columns` ;
- 10 à 100 000 points (`too_few_points`, `too_many_points`) ; aucune ligne de données → `no_numeric_rows` ; fichier vide → `empty`.

`core` lève `SpectrumReadError(issue, line, count)` ; le moteur rédige les messages (422) :
- « Fichier vide. » ;
- « Fichier binaire non reconnu : déposez un fichier texte à deux colonnes (CSV ou TXT). » ;
- « Format JCAMP-DX non pris en charge dans cette version : exportez le spectre en CSV à deux colonnes. » ;
- « Aucune ligne de deux nombres trouvée. » ;
- « Plus de 50 lignes d'en-tête avant les données. » ;
- « Ligne {n} : valeurs non numériques. » ;
- « Ligne {n} : plus de deux colonnes de valeurs ; un seul spectre (deux colonnes) est attendu. » ;
- « Spectre trop court : {n} points, il en faut au moins 10. » ;
- « Spectre trop long : plus de 100 000 points. »

### 7.4 Les mots à un seul endroit

`microtrace_engine/spectral_text.py` rédige : libellés des polymères, des techniques, des statuts et des bibliothèques, explications, messages d'erreur et d'indisponibilité, limites, `trial_label`, `trial_sentence`, libellés d'axes. `core` ne produit que des structures (statut, raison, nombres).

Libellés des polymères : « Polyéthylène (PE) », « Polypropylène (PP) », « Polyéthylène téréphtalate (PET) », « Polystyrène (PS) », « Polychlorure de vinyle (PVC) », « Polyamide (PA) », « Polyuréthane (PU) », « Polycarbonate (PC) », « Polyméthacrylate de méthyle (PMMA) », « Acrylonitrile butadiène styrène (ABS) », « Acide polylactique (PLA) », « Polytétrafluoroéthylène (PTFE) », « Polyoxyméthylène (POM) », « Silicone », « Éthylène-acétate de vinyle (EVA) », « Acrylique », « Acétate de cellulose (CA) », « Cellulose (fibre naturelle, non plastique) », « Caoutchouc », « Nitrocellulose (NC) », « Autre polymère », « Non plastique ».

Modèles d'explication (scores à 3 décimales, seuils sans décimale superflue) :
- identifié : « Polyéthylène (PE) : corrélation 0,996 avec la référence la plus proche (seuil d'identification 0,70), écart de 0,326 avec Polyamide (PA) ; le classifieur PCA+SVM propose aussi Polyéthylène (PE). Proposition à valider par une personne compétente. »
- incertain : « Proposition incertaine : Polypropylène (PP) en tête (corrélation 0,812), mais {le classifieur PCA+SVM propose Polyéthylène (PE) | l'écart avec Polyéthylène (PE) n'est que de 0,021 (il faut 0,10) | la corrélation est sous le seuil d'identification 0,85}. Le bon polymère figure le plus souvent parmi les 3 propositions. »
- `low_score` : « Aucune proposition fiable : la meilleure corrélation (0,312) est sous le seuil de 0,50. Le matériau peut être absent des bibliothèques (il n'y a pas de classe non plastique dans cette version), ou le spectre mal réglé (technique, laser) ou trop bruité. »
- `low_coverage` : « Aucune proposition : le spectre couvre 23 % de la fenêtre diagnostique (400–1 800 cm⁻¹) ; il en faut 80 %. Vérifiez l'unité de l'axe et la longueur d'onde du laser. »
- `technique_mismatch` : « Aucune proposition : ce spectre ressemble davantage à un spectre FTIR (corrélation 0,951, contre 0,548 en Raman). Vérifiez la technique choisie. »
- `no_overlap` : « Aucune proposition : le spectre n'a pas assez de points communs avec les spectres de référence. »

Limites (`limits`, dans cet ordre) :
1. « Modèle d'essai : entraîné sur des données publiques, pas encore sur les vôtres. »
2. « Le modèle n'a pas vu de particules extraites de sang : ses performances sur ce cas sont inconnues. »
3. « Il n'y a pas de classe non plastique dans cette version : un matériau absent des bibliothèques (protéine, minéral, fond…) devrait conduire à une abstention, mais peut être confondu avec le polymère le plus proche. »
4. « Les performances viennent d'une validation où chaque bibliothèque est tenue à part ; elles décrivent surtout MicroPlastiX, majoritaire. »
5. « Une proposition n'est jamais enregistrée comme mesure : elle est à valider par une personne compétente. »

## 8. Application web : service

### 8.1 `web/src/server/spectral.ts` (`server-only`)

```ts
getSpectralModel(ctx): Promise<SpectralModelState>                                   // viewer
listSpectralAnalyses(ctx, studyId): Promise<SpectralAnalysisRow[]>                   // viewer
getSpectralAnalysis(ctx, studyId, analysisId): Promise<SpectralAnalysisView | null>  // viewer
analyzeSpectrum(ctx, studyId, input): Promise<{ id: string; existing: boolean }>     // researcher
recordSpectralDecision(ctx, studyId, analysisId, input): Promise<{ id: string }>     // researcher
```

**`analyzeSpectrum`**
1. Rôle `researcher` ; champs dans les listes fermées (sinon « Paramètres d'analyse invalides. ») ; fichier non vide (« Aucun fichier reçu. ») et ≤ 2 Mio (« Fichier trop volumineux (2 Mo maximum). »).
2. Étude du laboratoire (« Étude introuvable. ») et non archivée (« Étude archivée : lecture seule. »), **avant** tout appel au moteur.
3. `engineClient.identifySpectrum` : 422 et 413 → `DomainError(detail)` (message français du moteur) ; 503 → `SPECTRAL_MODEL_UNAVAILABLE` ; autre erreur → `SPECTRAL_REFUSED` ; injoignable → `EngineUnavailableError`.
4. `response.input.sha256` doit égaler le sha256 local, sinon « Le moteur n'a pas analysé le fichier déposé : recommencez. ».
5. **Idempotence** : une analyse existante de la même étude, même sha256, mêmes paramètres et même `modelSha256` (celui de la réponse) renvoie `{ id, existing: true }` sans écriture (double clic, nouvel envoi).
6. `storeFile(sha256, bytes)` (magasin adressé par contenu de C3, hors transaction ; un orphelin est toléré comme en C3).
7. Transaction : `loadWritable`, création de la ligne d'analyse, `recordAudit`.

Pas de `DataFile` : cette table appartient aux imports (unique par étude et sha256, liée aux `ImportRun`). Le fichier du spectre est référencé par `inputFileSha256` et `input.storagePath`.

### 8.2 Correspondance avec `ModelPrediction`

Une **analyse** et chaque **décision** sont des lignes distinctes, jamais modifiées.

| Colonne | Analyse | Décision |
|---|---|---|
| `kind` | `spectral` | `spectral` |
| `status` | `proposed` (toujours) | `accepted` \| `corrected` \| `rejected` (jamais `proposed`) |
| `inputFileSha256` | sha256 du fichier | celui de l'analyse |
| `input` | `{ role: "analysis", fileName, sizeBytes, mimeType, storagePath, technique, xUnit, yUnit, laserNm }` | `{ role: "decision", analysisId, decision, polymer }` (`polymer` : top-1 si acceptée, code choisi si corrigée, `null` si rejetée) |
| `output` | la réponse du moteur, telle quelle | `{ analysisId, proposedPolymer, proposedStatus }` |
| `score` | score n° 1, ou `null` | celui de l'analyse |
| `modelName`, `modelVersion`, `modelSha256` | de la réponse | ceux de l'analyse |
| `decidedById`, `decidedAt`, `decisionNote` | `null` | l'utilisateur, maintenant, la note |

Au sein du kind `spectral`, une analyse est donc une ligne `status = proposed` ; une décision, une ligne d'un autre statut avec `input.analysisId`. La **plus récente** décision d'une analyse fait foi (`createdAt` puis `id` décroissants) ; l'historique complet est dans le Journal.

### 8.3 `recordSpectralDecision`

1. Rôle `researcher`.
2. `decision ∈ {accepted, corrected, rejected}`, sinon « Décision inconnue. » ; note rognée, ≤ 1 000 caractères (« La note dépasse 1 000 caractères. »).
3. Étude du laboratoire et non archivée ; analyse de **cette étude** (`kind: spectral`, `status: proposed`, `study: { laboratoryId }`), sinon « Analyse introuvable. ».
4. Règles, lues dans l'`output` **enregistré** de l'analyse (écrit par le serveur, jamais renvoyé par le navigateur) — aucun appel au moteur :
   - `accepted` sur une analyse `not_identified` → « Aucune proposition à accepter : corrigez ou rejetez. » ;
   - `corrected` sans polymère → « Choisissez le polymère retenu. » ; code hors de `correction_vocabulary` → « Polymère inconnu. » ; code égal au top-1 d'une analyse non abstenue → « Le polymère choisi est celui proposé : choisissez « Acceptée ». » ;
   - note obligatoire pour `rejected` (« Une note est obligatoire pour rejeter une proposition. ») et pour une correction en `OTHER` ou `NOT_PLASTIC` (« Une note est obligatoire pour « Autre polymère » ou « Non plastique ». »).
5. Transaction : `loadWritable`, verrou `SELECT … FOR UPDATE` sur l'étude, `createdAt = max(maintenant, dernière décision de l'analyse + 1 ms)` (même mécanisme que C7), création, audit.

Les libellés et badges des décisions vivent dans `web/src/lib/spectral.ts` (importable côté client) : « Acceptée » (`positive`), « Corrigée » (`warning`, suivi du libellé du polymère retenu), « Rejetée » (`neutral`) ; sans décision : « Non examinée » (`outline`).

### 8.4 Audit

| Action | `entityType` / `entityId` | `after` |
|---|---|---|
| `spectral.analysis` « Analyse spectrale enregistrée » | `ModelPrediction` / id de l'analyse | `{ kind: "spectral", studyId, technique, status, proposedPolymer, proposedLabel, modelVersion, inputSha256 }` |
| `spectral.decision` « Décision spectrale enregistrée » | `ModelPrediction` / id de la décision | `{ kind: "spectral", studyId, analysisId, decision, polymer, polymerLabel, proposedPolymer, modelVersion, hasNote }` |

- Ni nom de fichier ni texte de note dans l'audit (un nom de fichier peut porter un nom de personne ; la note est conservée une fois, dans `ModelPrediction`).
- `listAuditEvents` couvre déjà toutes les `ModelPrediction` de l'étude.
- `audit-labels.ts` : les deux actions ; l'entité vaut « Analyse spectrale » quand `after.kind === "spectral"` (« Signal de qualité » sinon) ; l'objet vaut « {technique} — {proposedLabel} » (par exemple « Raman — Polyéthylène (PE) »), ou « {technique} — aucune proposition » ; `analysisId`, `inputSha256` et `kind` dans `HIDDEN_FIELDS`.

### 8.5 Isolation

- Chaque lecture filtre `study: { laboratoryId: ctx.laboratoryId }`. Un identifiant d'analyse d'une autre étude ou d'un autre laboratoire répond « Analyse introuvable. » ou « Étude introuvable. », jamais « interdit ».
- Les deux modules (`spectral`, `training-consent`) entrent dans `tenant-isolation.test.ts` (`MODULES`, `CASES`, `WRITES`, `ADMIN_WRITES`, lecteurs) ; le simulacre `engineClient` reçoit `spectralModel` et `identifySpectrum`.
- Tests ajoutés : une analyse de B citée dans une étude de A → « Analyse introuvable. », sans écriture ; une décision de B sur une analyse de A est impossible ; l'export de A ne contient jamais une ligne de B, même quand B a consenti.

## 9. Écran « Spectres »

**Onglet :** `{ segment: "spectres", label: "Spectres" }`, entre « Qualité » et « Rapport ». Adresses :
- `/labo/[labSlug]/etudes/[studyId]/spectres` (liste et dépôt) ;
- `/labo/[labSlug]/etudes/[studyId]/spectres/[analysisId]` (une analyse) ;
- `POST …/spectres/analyser` (gestionnaire de route, multipart borné, même analyseur que le dépôt d'import, extrait dans `web/src/server/multipart.ts` sans changement de comportement).

Conventions de la passe de design et de C7 : `Section`, `Alert`, `Badge`, `EmptyState`, `Table` avec `TableCaption sr-only`, jetons de couleur seulement, un seul `h1`, `h2` pour les sections, tablette 768 et 1024. **Aucun lien dont le nom contient « Rapport » ou « Résultats »** : le lien vers une analyse s'appelle « Voir » avec `aria-label` « Ouvrir l'analyse du {date} » (jamais le nom du fichier, qui pourrait contenir ces mots).

### 9.1 Page liste

1. **`Alert info`** avec le badge `outline` « Modèle d'essai » : `trial_sentence` ; « Chaque proposition est à valider par une personne compétente ; elle n'est jamais enregistrée comme mesure. » ; la limite 2 (sang) ; la limite 3 (classe non plastique) ; « Pendant la phase d'essai, aucune donnée de laboratoire ne sert à entraîner un modèle. » ; l'état du consentement du laboratoire, en lecture seule : « Utilisation des données validées de ce laboratoire pour améliorer les modèles : désactivée. » ou « … : activée depuis le {date} (réglage du responsable du laboratoire). ».
2. **Modèle indisponible** : `Alert destructive` avec le `message` du moteur, ou `ENGINE_DOWN` ; le formulaire disparaît, la liste reste.
3. **Étude archivée** : `Alert info` « Étude archivée : les analyses et décisions sont en lecture seule. ».
4. **`Section` « Analyser un spectre »** (`researcher` ou plus, étude non archivée, modèle disponible) : formulaire client `AnalyzeForm` :
   - `input type="file"` étiqueté « Fichier du spectre » (`.csv,.txt,.tsv,.dat,.asc`) ;
   - `fieldset` « Technique » : « Raman », « FTIR (ATR) » ;
   - Raman : « Unité de l'axe » (« Déplacement Raman (cm⁻¹) », « Longueur d'onde (nm) ») et « Longueur d'onde du laser (nm) » (obligatoire) ;
   - FTIR : « Ordonnée » (« Absorbance », « Transmittance (%) ») ;
   - bouton « Analyser le spectre » (« Analyse en cours… ») ; erreur du serveur dans `FormError`, saisie conservée ; succès → page de l'analyse.
5. **`Section` « Analyses de l'étude »** : table Date, Fichier, Technique, Proposition (libellé du top-1, ou « Aucune proposition fiable »), Statut (badge : `positive` identifié, `warning` incertain, `neutral` non identifié), Décision (badge), lien « Voir ». Au plus 500 lignes, puis « {n} analyses plus anciennes non affichées. ». Vide : `EmptyState` (`ScanLine`) « Aucun spectre analysé dans cette étude. ».
6. **`Section` « Fiche du modèle (version s1) »** : pour chaque technique, polymères connus, seuils, top-1 LOLO, précision estimée de « identifié », part d'abstention ; les bibliothèques avec citation et licence ; la phrase « Fiche complète : docs/models/c5-spectral.md (documentation du projet). ».

### 9.2 Page d'une analyse

1. `h2` « Analyse du {DateTimeFr} » ; `dl` : fichier, taille, sha256 (abrégé, complet en `title`), technique, unité de l'axe, laser, couverture de la fenêtre, modèle (nom, version, sha256 abrégé) et badge « Modèle d'essai ». Si la version enregistrée diffère du modèle actuel : `Alert info` « Analyse faite avec la version {v} du modèle ; version actuelle : {w}. ».
2. **`Section` « Proposition »** : badge de statut, `explanation` mot pour mot, table « Polymères proposés » (Rang, Polymère, Corrélation = `score_text`), ligne « Avis du classifieur PCA+SVM : {label} ». En abstention, la table est titrée « Polymères les plus proches (à titre indicatif) ».
3. **`Section` « Spectre et références »** : `SpectrumChart` (client, Recharts) :
   - `LineChart`, axe x numérique (`x_label`), axe y (`y_label`) ;
   - spectre déposé en `var(--foreground)` (trait 2), références affichables en `var(--chart-1)` à `var(--chart-5)` (trait 1), fenêtre diagnostique en `ReferenceArea` `var(--muted)` ;
   - conteneur `role="img"`, `aria-label` « Spectre déposé superposé aux spectres de référence affichables ({k}) » ; légende en liste HTML ;
   - table équivalente « Spectres de référence les plus proches » : Rang, Bibliothèque, Identifiant, Polymère, Corrélation, Licence, Courbe (« affichée », ou `curve_note`) ; la citation de chaque bibliothèque citée suit la table.
4. **`Section` « Décision »** : dernière décision (badge, polymère retenu, note, « par {nom}, le {DateTimeFr} », « ({k} décisions, voir le Journal) » si k > 1) ou « Non examinée » ; pour `researcher`+ sur étude non archivée, `DecisionForm` (client, `ActionForm`) :
   - `fieldset` « Décision » : « Acceptée » (absent si `not_identified`), « Corrigée », « Rejetée » ;
   - `select` « Polymère retenu » (`correction_vocabulary`, visible pour « Corrigée ») ;
   - `Textarea` « Note » (obligatoire selon la décision, indiqué à côté) ;
   - « Enregistrer la décision » (« Enregistrement… ») ; champs cachés `studyId`, `analysisId` ; `FormError`.
5. Lien « Toutes les analyses ».

États : analyse introuvable → `notFound()` (« Page introuvable ») ; viewer et étude archivée → aucun formulaire.

## 10. Consentement du laboratoire et export

### 10.1 Schéma (migration `20261031000000_lab_training_consent`)

Champs sur `Laboratory` (un seul état courant ; l'historique est l'audit) :
```prisma
trainingConsentAt      DateTime?   // null = désactivé (défaut)
trainingConsentById    String?
trainingConsentVersion String?     // version du texte accepté, "c1"
```
```sql
ALTER TABLE "Laboratory" ADD COLUMN "trainingConsentAt" TIMESTAMP(3),
  ADD COLUMN "trainingConsentById" TEXT, ADD COLUMN "trainingConsentVersion" TEXT;
ALTER TABLE "Laboratory" ADD CONSTRAINT "Laboratory_training_consent_complete" CHECK (
  ("trainingConsentAt" IS NULL) = ("trainingConsentById" IS NULL)
  AND ("trainingConsentAt" IS NULL) = ("trainingConsentVersion" IS NULL));
```
Choix des champs plutôt que d'une table : un seul état par laboratoire, daté et attribué ; l'historique (accord, retrait, exports) est déjà append-only dans `AuditEvent`. Contrôle de dérive : `prisma migrate diff` de la base migrée vers `schema.prisma` ne doit rien produire d'autre que l'écart connu de l'index partiel `ImportRun_one_active_per_file` (SQL brut de C3), avant comme après la migration.

### 10.2 Service `web/src/server/training-consent.ts`

```ts
getTrainingConsent(ctx): Promise<TrainingConsentView>                              // viewer (historique : lab_admin seulement)
setTrainingConsent(ctx, granted: boolean): Promise<void>                           // lab_admin
buildTrainingExport(ctx, format: "json" | "csv"): Promise<DownloadFile>            // lab_admin
```
- `setTrainingConsent` : transaction, `SELECT … FOR UPDATE` sur le laboratoire ; « Le consentement est déjà donné. » / « Le consentement n'est pas donné. » ; audit `lab.training_consent.grant` (« Consentement donné (amélioration des modèles) ») ou `lab.training_consent.revoke` (« Consentement retiré (amélioration des modèles) »), `entityType: "Laboratory"`, `before`/`after` = `{ name, granted, at, version }`.
- `buildTrainingExport` :
  - consentement relu en base ; désactivé → « Consentement non donné : aucun export. », sans audit ;
  - lignes : la **dernière** décision de chaque analyse spectrale des études **du laboratoire**, si elle est `accepted` ou `corrected` (une analyse rejetée en dernier, ou sans décision, est exclue) ; au plus 1 000 lignes, les plus récentes ;
  - jamais : nom de fichier, note, titre d'étude, nom de personne, mesure ;
  - JSON : `{ format: "microtrace.spectral-training-export", version: 1, exported_at, laboratory: { slug, name }, consent: { granted_at, version }, notice, rows }`, chaque ligne avec `file_base64` (fichier du magasin, sha256 revérifié ; absent → `null` et `file_missing: true`) ; total des fichiers > 50 Mo → « Export trop volumineux (50 Mo maximum) : contactez l'équipe MicroTrace. » ;
  - CSV (`toCsv`) : mêmes colonnes sans le fichier ;
  - colonnes : `analysis_id, decision_id, study_id, study_nature, decided_at, decision, label, proposed_polymer, proposed_status, score, technique, x_unit, y_unit, laser_nm, file_sha256, file_size, model_name, model_version, model_sha256` ;
  - `notice` : « Données d'un seul laboratoire, exportées avec son consentement. Aucun réentraînement avant la validation du cadre légal (loi 18-07, ANPDP) et du contrat. » ;
  - nom : `microtrace-{labSlug}-entrainement-spectral-{AAAA-MM-JJ}.{json|csv}` ;
  - audit `lab.training_export` (« Export des données consenties ») : `{ format, rows, consentVersion }`.
- Route `GET /labo/[labSlug]/membres/export-entrainement?format=json|csv` : non-membre ou non-responsable → 404 ; consentement absent → 403 texte brut ; HEAD → 405 ; en-têtes de `download-response.ts`.

### 10.3 Écran (page Membres, `lab_admin` seulement)

Nouvelle `Section` « Données et amélioration des modèles » :
- l'intitulé `TRAINING_CONSENT_LABEL` « Autoriser l'utilisation des données validées de ce laboratoire pour améliorer les modèles » et l'état : badge `neutral` « Désactivé », ou `positive` « Activé » avec « depuis le {date}, par {nom} (texte c1) » ;
- ce qui serait utilisé : les spectres déposés et le polymère retenu des analyses **acceptées ou corrigées** ; jamais les noms de fichiers, les notes ni les mesures ; « Le retrait s'applique aux prochains entraînements. » ; « Pendant la phase d'essai, aucune donnée de laboratoire ne sert à entraîner un modèle. Aucun réentraînement n'aura lieu avant la validation du cadre légal (loi 18-07) et du contrat avec le laboratoire. » ;
- bouton « Activer le consentement » ou « Retirer le consentement », avec `ConfirmDialog` ;
- si activé : liens « Exporter les données consenties (JSON) » et « Exporter les données consenties (CSV) » ;
- table « Historique » : les 20 derniers événements de consentement et d'export (date, action, par).

Les textes vivent dans `web/src/lib/training-consent.ts` (`TRAINING_CONSENT_VERSION = "c1"`, `TRAINING_CONSENT_LABEL`, `TRAINING_CONSENT_DETAILS`).

## 11. Fiche du modèle `docs/models/c5-spectral.md`

Plan :
1. Objet et statut : **modèle d'essai**, aide à l'identification, jamais une mesure ni un diagnostic ;
2. Version, date, sha256 des poids, commit, verrou ;
3. Données et licences par bibliothèque (§3.1, §3.2), règle d'affichage des courbes, « pas de classe non plastique dans cette version » (§3.3) ;
4. Pipeline et constantes (§4) ;
5. Protocole : porte de reproduction, LOLO sans fuite, choix des seuils et estimation imbriquée (§5) ;
6. **Bloc de métriques généré** : par technique et par bibliothèque tenue à part (top-1, top-3, SVM, statuts, précision imbriquée), hors bibliothèque, mauvaise technique, rappel par polymère, taux d'abstention ;
7. Conditions d'échec connues : particules extraites de sang ; matériaux non plastiques ; polymère absent (en FTIR, le caoutchouc et l'acrylique ressemblent au PE) ; mélange de polymères ou particule pigmentée ; vieillissement et biofilm au-delà de ceux des bibliothèques ; mauvaise technique (faux signalement 2,5 % en Raman) ; erreur de laser ; transmittance déclarée absorbance ; spectre tronqué hors de la fenêtre ; domination de MicroPlastiX (92 % des requêtes FTIR, 71 % des Raman) ; étiquettes de référence issues de recherches en bibliothèque (raman_weathered, FLOPP-e, SLoPP-E) ; un spectre de la bibliothèque déposé tel quel se retrouve lui-même (corrélation 1) ;
8. Décisions humaines, traçabilité, consentement et export (§8, §10) ;
9. Ce qui change la version : seuils, données, prétraitement, fenêtre, modèle → `s2` ;
10. Relecture avant présentation aux chercheurs (spec §10).

## 12. Résultats attendus (exploration du 2026-10-31)

**Porte de reproduction** (grille entière, `correlation@0`, LOLO) : FTIR 0,849 (4 185 requêtes, 25 hors bibliothèque), Raman 0,890 (2 477, 315).

**LOLO du modèle `s1`** (fenêtre diagnostique) :

| Technique | Bibliothèque tenue à part | Dans la bibliothèque | Hors bibliothèque | Top-1 corrélation |
|---|---|---|---|---|
| FTIR | `flopp` | 164 | 21 | 0,921 |
| | `flopp_e` | 189 | 4 | 0,931 |
| | `mpx` | 3 832 | 0 | 0,852 |
| | **global** | 4 185 | 25 | **0,858** (top-3 0,919) |
| Raman | `mpx` | 1 759 | 218 | 0,898 |
| | `raman_weathered` | 164 | 1 | 0,829 |
| | `raspi` | 309 | 87 | 0,887 |
| | `slopp` | 143 | 5 | 0,860 |
| | `slopp_e` | 102 | 4 | 0,882 |
| | **global** | 2 477 | 315 | **0,889** (top-3 0,938) |

Hors bibliothèque : FTIR = caoutchouc 15, acrylique 6, acétate de cellulose 2, PMMA 2 ; Raman = PLA 218, PTFE 41, silicone 25, POM 21, EVA 5, caoutchouc 4, nitrocellulose 1.

**Seuils et statuts :** §5.3. **Estimation imbriquée :** §5.4. **Abstention :** §4.4. **Garde de technique :** §4.3.

**Spectre de bout en bout :** `VLFR_02-HDPE_nobio_Raman_dc1c0b0b.csv` de MicroPlastiX (CC BY-SA 4.0, Lenz et al. 2023), Raman, axe en nm (526,508 à 663,087 nm, une ligne d'en-tête `nm,Intensity`), laser 532 nm, 1 024 points, 14 283 octets, sha256 `36d2f382b66b680d8d204ab900ac0fbb6d8a93ae6bbea6495ba95dc22e57ce19`. Attendu : **identifié**, top-1 **Polyéthylène (PE)** ; première référence `mpx:VLFR_02-HDPE_nobio_Raman_dc1c0b0b` (le spectre lui-même, corrélation « 1,000 », licence « CC BY-SA 4.0 », courbe affichée). Sans lui-même (exploration) : PE à 0,996, marge 0,326 sur PA, SVM PE : le résultat ne dépend pas de l'auto-correspondance.

## 13. Points de relecture et preuves

| Point (décision 7) | Preuve |
|---|---|
| Fuite de bibliothèque à l'évaluation | pytest : un espion sur l'apprentissage vérifie, pour chaque pli, qu'aucun identifiant de la bibliothèque tenue à part n'entre dans les références, la PCA ou le SVM, ni dans l'autre technique de la garde ; l'estimation imbriquée choisit ses seuils sans la bibliothèque évaluée |
| L'abstention est réellement utilisée | manifeste : parts d'abstention publiées (FTIR ≈ 21,7 %, Raman ≈ 4,9 % dans la bibliothèque) ; pytest : bruit → `low_score` ; e2e : un fichier de bruit donne « Non identifié (abstention) » et pas d'« Acceptée » |
| Polymère absent de l'apprentissage | pytest synthétique (classe C absente) → `not_identified` ; manifeste : part de « identifié » hors bibliothèque ≤ 10 % (contrainte du choix des seuils) |
| Mauvaise technique ou mauvais laser | pytest synthétique (`technique_mismatch`, `low_coverage`) ; tests `data` sur 200 spectres réels (≥ 90 % non identifiés) et 100 spectres en nm au laser faux (100 %) ; 422 du moteur pour nm en FTIR, laser absent ou hors plage |
| Fichiers malformés ou énormes | pytest de `parse_two_columns` (chaque `ReadIssue`) ; moteur 422 et 413 ; route web 413 sans appel au moteur ; aucun contenu ni nom de fichier dans les journaux |
| Licence des références affichées | test de la table contre `SOURCES.md` ; moteur : `curve` null et `curve_note` pour une bibliothèque non confirmée ; page : la courbe n'est pas tracée et la table le dit |
| Prédiction, décision ou export inter-laboratoires impossibles | `tenant-isolation.test.ts`, tests des services, e2e « Page introuvable » |
| Consentement désactivé → export refusé | test du service (refus, aucun audit), route 403, e2e avant et après retrait |
| Empreinte des poids différente → refus de servir | moteur : octet modifié → `GET` `available: false, reason: sha_mismatch`, `POST` 503, `np.load` jamais appelé ; verrou égal au manifeste |

## 14. Hors périmètre (à reporter au suivi) et question pour le fondateur

- **Avant toute présentation aux laboratoires :** confirmer les licences « À compléter » de FLOPP, FLOPP-e, SLoPP, SLoPP-E, RaSPI et de la base Raman vieillie (usage dans un modèle d'essai, affichage des courbes). D'ici là, leurs courbes ne sont pas affichées.
- Classe non plastique (RaMPI, Open Specy, `pyreadr`, licences).
- Formats JCAMP-DX, `.spa`, multi-spectres, cartes Raman ; plusieurs spectres par dépôt.
- Report d'une identification acceptée vers une mesure (identification confirmée) : non-objectif.
- Le marquage « résultats validés » d'une étude, l'exclusion par les signaux C7 et la vérification de pseudonymisation exigés par le cycle de vie : à faire dans le sous-projet de réentraînement, avant toute utilisation de l'export.
- Téléchargement du fichier déposé depuis l'écran ; plafond du nombre d'analyses par étude ; pagination au-delà de 500.
- Rechargement à chaud du modèle (aujourd'hui : redémarrer le moteur après un réentraînement).
- Empreinte des poids dépendante de la plateforme de calcul (BLAS) : un réentraînement sur une autre machine peut donner un autre sha256, que le moteur refuse jusqu'à la mise à jour du verrou.
- Seuils et fenêtres fixes, non réglables par laboratoire ; aucune calibration par instrument.
