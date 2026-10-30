# C7 — Assistant qualité des résultats — conception détaillée

**Date :** 2026-10-30
**Statut :**
- Le fondateur délègue les choix techniques ; il testera dans le navigateur après C7, C5 et C6.
- Les huit décisions du contrôleur du 2026-10-30 sont **contraignantes** : ce document les précise sans les renverser (rappel en §0).
- Versions : règles de qualité `q1` (`QUALITY_RULES_VERSION`), indépendantes des règles d'import B1 (`RULES_VERSION`).

**Sources :**
- `docs/superpowers/specs/2026-10-25-prototype-studio-design.md` : §2 (anti-objectifs), §3 (contrat du moteur), §6 (« Calcul des résultats »), §10 (« Principes communs » et « C7 »), §11 (multi-laboratoires) ;
- `docs/superpowers/specs/2026-10-30-passe-design.md` : conventions d'interface en vigueur ;
- `docs/superpowers/plans/2026-10-30-c4-resultats.md` : ce que C4 a construit (`loadActiveResultsInput`, onglet Résultats) ;
- code : `core/src/microtrace_core/results/{records,censoring,units,summary,vocab,issues}.py`, `engine/src/microtrace_engine/{app,schemas,convert,report}.py`, `web/src/server/{results,report-download,studies,imports,audit}.ts`, `web/prisma/schema.prisma`, `web/src/server/__tests__/tenant-isolation.test.ts`.

Les chiffres des §4 et §10 ont été **calculés** sur les jeux d'exemple avec les fonctions de B1 (`run_import`, `aggregate_aliquots`) et `scipy.stats.fisher_exact`, dans le `.venv` du dépôt. Ils ne sont pas estimés.

---

## 0. Décisions du contrôleur (rappel)

| # | Décision | Où elle est précisée |
|---|---|---|
| 1 | Règles = statistiques robustes dans `core` (`microtrace_core.results.quality`), fonctions pures testées par pytest, `QUALITY_RULES_VERSION = "q1"`. Ni apprentissage, ni imputation, ni prédiction de santé. Des signaux expliqués, jamais des verdicts. | §2, §4 |
| 2 | Quatre signaux : discordance entre aliquotes, valeur proche des blancs, valeur atypique, taux de < LOD inhabituel. Chaque seuil est justifié. | §4 |
| 3 | Route `POST /quality` du moteur (secret, 75 Mo, Pydantic, OpenAPI régénéré). Clé stable, règle, catégorie sans gravité, explication française écrite par le moteur, chiffres, mesures concernées, `quality_rules_version`. | §5, §6 |
| 4 | Onglet « Qualité » entre Résultats et Rapport, lisible par un `viewer`, calculé à la demande depuis `loadActiveResultsInput`. Seules les décisions humaines sont enregistrées (`ModelPrediction`, kind `quality`), et elles sont auditées. Les décisions dont la clé a disparu sont listées, jamais supprimées. Isolation multi-laboratoires. | §7, §8 |
| 5 | Fiche des règles `docs/models/c7-qualite.md`. L'écran affiche la version et un résumé des limites. | §9 |
| 6 | Hors périmètre : les signaux dans le rapport téléchargeable, des seuils réglables par laboratoire, les notifications. | §12 |
| 7 | Points de relecture imposés. | §11 |
| 8 | Six tâches. | plan `docs/superpowers/plans/2026-10-30-c7-qualite.md` |

## 1. Intention

Avec quelques dizaines d'échantillons, un chercheur a besoin d'un **second regard systématique** sur ses mesures :
- deux aliquotes du même sang qui ne disent pas la même chose ;
- une valeur à peine au-dessus de la contamination de la paillasse ;
- un donneur très loin des autres ;
- un lot d'analyse où presque tout est < LOD.

L'assistant ne décide rien et ne corrige rien. Il **montre** chaque cas avec ses chiffres et les cellules du fichier d'origine. Une personne compétente l'examine, puis enregistre sa décision, qui est tracée. Une erreur de saisie se corrige comme aujourd'hui : on retire l'import, puis on réimporte le fichier corrigé (l'édition des mesures reste un non-objectif, spec §2).

## 2. Anti-objectifs (un échec même si « ça marche »)

Ceux de la spec §2 et du §10 « Principes communs » s'appliquent. Pour C7, cela veut dire :

1. **Une valeur censurée n'est jamais un nombre.** Seules les mesures `status == quantified` (avec `canonical_value`) entrent dans un calcul. Une valeur entre LOD et LOQ (`*0,3`) porte pourtant un `value` dans le record ; elle n'est **jamais** lue par les règles (test dédié). Une valeur < LOD ne compte que dans la règle d) comme *statut*, jamais comme valeur.
2. **Aucun groupe mélangé.** Unités, grandeurs (`kind`), bases (`basis`), méthodes, matrices et détails de matrice ne sont jamais regroupés. Une conversion n'a lieu qu'entre unités de même (grandeur, base) (`units.convert`). Sinon, aucun signal, et une note l'explique.
3. **Aucune imputation, aucune correction de valeur, aucune prédiction** de concentration ou d'effet sanitaire.
4. **Aucune gravité.** Un signal n'est ni une erreur ni un avertissement. Il n'a pas de couleur d'alerte à l'écran, et il porte une *catégorie* descriptive.
5. **Aucun stockage des signaux.** Ils sont recalculés à chaque ouverture (spec §6). Seule une décision humaine crée une ligne, et elle embarque alors une copie du signal tel qu'il était.
6. **Aucune règle en TypeScript.** Le web transmet, associe des clés et affiche. Associer une décision à un signal par l'égalité de la clé n'est pas une règle scientifique.
7. **Le navigateur ne fournit jamais le signal.** À l'enregistrement d'une décision, le serveur recalcule les signaux et ne retient que celui dont la clé correspond.

## 3. Données d'entrée

| Entrée | Origine | Usage |
|---|---|---|
| Mesures des imports `active` (`records`, échantillons) | `loadActiveResultsInput` (instantané `RepeatableRead`, déjà utilisé par Résultats et Rapport) | les quatre règles |
| Identité de chaque mesure : `import_id`, `file_sha256`, `sheet`, `source_row`, `source_column` | `ResultsImport` (`id`, `sha256`, `sheet`) via `recordImportIds` | clé du signal, renvoi vers la cellule |
| Contrôles qualité résumés (`QualityControlSummary` : polymère, type, n, moyenne, écart type, unité, source) | **nouvelle option** `withQcSummaries` de `loadActiveResultsInput`, lue dans le même instantané | règle b) |
| `blank_corrected` de l'étude (yes / no / unknown) | `input.context.blank_corrected` (valeur actuelle) | phrase de prudence de la règle b) |

**Non utilisés en q1, et dits dans la fiche :**
- les blancs mesurés importés (`qc_records`) ;
- les issues d'import ;
- le `QcMeasurement`.

Ils sont reportés au suivi (§12).

**Unicité de l'identité.** Dans l'étude, `(file_sha256, sheet, source_row, source_column)` identifie une seule mesure active :
- un même sha256 n'a jamais deux imports actifs (index partiel de C3) ;
- une cellule donne une seule mesure, ce qui a été vérifié sur les deux exemples (200 identités pour 200 mesures).

Le moteur refuse une requête où une identité apparaît deux fois (422, §6), pour que la clé reste univoque.

## 4. Les règles q1

Toutes les règles ne portent que sur les mesures d'échantillon (`record_type == sample`). Les constantes sont des noms de module dans `microtrace_core.results.quality`, et la fiche les reprend.

| Constante | Valeur | Comparaison |
|---|---|---|
| `QUALITY_RULES_VERSION` | `"q1"` | — |
| `ALIQUOT_RPD_THRESHOLD` | `0.50` (50 %) | signal si écart relatif **>** seuil |
| `NEAR_BLANK_FACTOR` | `3.0` | signal si valeur **<** 3 × moyenne du blanc |
| `MAD_CONSTANT` | `0.6745` | — |
| `OUTLIER_Z_THRESHOLD` | `3.5` | signal si \|M\| **>** 3,5 |
| `OUTLIER_MIN_SAMPLES` | `5` | règle appliquée si n ≥ 5 et MAD > 0 |
| `LOD_RATE_ALPHA` | `0.01` | signal si p **<** 0,01 |
| `LOD_RATE_MIN_STRATUM` | `5` | lot comparé si n ≥ 5, et s'il reste au moins 5 autres mesures |

Toutes les comparaisons sont **strictes**. Une valeur exactement au seuil ne déclenche pas de signal, et des tests le vérifient avec des nombres exacts en binaire.

**Groupe d'analyse** (`QualityGroup`) : `(polymer, method, matrix, matrix_detail, kind, basis, canonical_unit)`.
- `matrix_detail` est normalisé comme dans `summary` : rogné pour `other`, vide pour les matrices nommées.
- Le prédicat « quantifié » et la normalisation du détail de matrice sont **ceux de `summary.py`**. Ses deux fonctions privées `_is_quantified` et `_detail` deviennent publiques (`is_quantified`, `matrix_detail_key`), et `summary` les utilise lui-même : c'est une refonte sans changement de comportement.

### a) Discordance entre aliquotes (`aliquot_discordance`, catégorie `replicates`)

- **Population :** les mesures d'un même échantillon dans un même groupe, avec au moins **2 aliquotes quantifiées**.
- **Formule :** écart relatif = (max − min) / moyenne des valeurs quantifiées (en unité canonique). Pour deux aliquotes, c'est exactement le RPD (*relative percent difference*) des doublons : |x₁ − x₂| / ((x₁ + x₂)/2).
- **Seuil : > 50 %.** Justification :
  1. Les guides de validation de données de l'US EPA (*National Functional Guidelines for Inorganic Superfund Methods Data Review*) fixent pour les doublons de laboratoire un écart relatif de l'ordre de **20 % pour les eaux et 35 % pour les sols**, au-dessus de 5 fois la limite de quantification. Les sols y ont un critère plus large parce que la matrice est hétérogène. *L'édition et les valeurs exactes sont à vérifier lors de la relecture de la fiche.*
  2. Les microplastiques dans le sang sont plus hétérogènes encore. La masse d'une aliquote peut dépendre de quelques particules, qui sont présentes ou absentes, ce qui donne un bruit d'échantillonnage de type comptage (Brander et al. 2020, *Appl. Spectrosc.* 74:1099 ; Hermsen et al. 2018, *Environ. Sci. Technol.* 52:10230). Le critère des sols (35 %) signalerait la plupart des paires ordinaires.
  3. Sur les données réelles de Leslie et al. 2022 (Tableau S2), les trois paires de doublons quantifiés ont des écarts de 8,7 %, 112,7 % et 120 %. Le seuil de 50 % ne retient que les deux écarts manifestes. À 35 %, le résultat serait le même sur ces données réelles, mais l'exemple fictif donnerait 3 signaux de plus pour des paires banales (35,3 % à 45,2 %).
  4. 50 % est un **point de départ documenté**. Des seuils par laboratoire sont hors périmètre (§12).
- **Aliquote censurée :** une paire « 2,2 et < LOD » ne donne **pas** de signal. q1 n'utilise jamais une valeur censurée, et c'est une condition d'échec connue de la fiche. L'explication indique le nombre d'aliquotes non quantifiées laissées de côté.
- **Mesures concernées :** les aliquotes quantifiées du groupe.
- **Chiffres :** `n_aliquots`, `n_quantified`, `min`, `max`, `mean`, `rpd_percent`, `threshold_percent`.

### b) Valeur proche des blancs (`near_blank`, catégorie `blanks`)

- **Population :** chaque mesure quantifiée, comparée à chaque contrôle qualité résumé :
  - de type `procedural_blank` ;
  - au même polymère. Le polymère du contrôle (texte libre) est normalisé par `normalize_result_polymer(label, record.technique)` de B1 : « PS » devient `PS_SUM` pour une technique thermo-analytique ;
  - à la moyenne renseignée et strictement positive.
- **Méthode :** `QualityControlSummary` n'a pas de champ méthode dans le prototype. Le contrôle s'applique donc à toutes les méthodes du polymère dont l'unité est convertible. C'est une limite écrite dans la fiche, et l'ajout d'une méthode au contrôle est reporté au suivi. Le schéma Prisma n'est pas modifié.
- **Unités :** l'unité du contrôle est lue par `parse_unit`. Elle doit avoir la même (grandeur, base) que le groupe ; la moyenne est alors convertie par `convert` dans l'unité canonique du groupe. Sinon, il n'y a pas de signal et une note est produite (`blank_unit_mismatch` ou `blank_unit_unknown`).
- **Formule :** rapport = valeur canonique / moyenne canonique du blanc. Il y a signal si rapport < 3.
- **Seuil 3 × :**
  1. Il est fixé par la spec §10.
  2. Il correspond au rapport signal/bruit de 3 de la définition classique de la détection (IUPAC : LOD = moyenne du blanc + 3 σ ; Long & Winefordner 1983, *Anal. Chem.* 55:712A ; MacDougall et al. 1980, *Anal. Chem.* 52:2242).
  3. Il est **plus permissif** que la règle de qualification des guides de l'US EPA pour la chimie organique (résultat < 5 × le blanc, ou < 10 × pour les contaminants courants de laboratoire). q1 produit donc moins de signaux, et la fiche le dit.
- **Étude déclarée corrigée du blanc** (`blank_corrected == "yes"`) : la règle s'applique à l'identique. L'explication ajoute alors que la valeur est déjà corrigée, et que le rapport valeur/blanc compare donc une valeur nette à un blanc brut.
- **Notes :**
  - `no_blank_summary` : aucun blanc de procédure résumé ; la règle n'est pas appliquée ;
  - `polymers_without_blank` : la liste des polymères mesurés sans blanc ;
  - `blank_unit_mismatch`, `blank_unit_unknown` ;
  - `blank_mean_missing` : moyenne vide, nulle ou négative ;
  - les blancs de terrain et les échantillons dopés sont ignorés en q1, et la fiche le dit.
- **Mesures concernées :** la mesure. **Chiffres :** `value`, `blank_mean` (canonique), `blank_mean_reported` (unité du contrôle), `blank_n`, `ratio`, `factor`.

### c) Valeur atypique (`robust_outlier`, catégorie `distribution`)

- **Population :** les résultats **par échantillon** de `aggregate_aliquots` (B1, la règle d'agrégation affichée par Résultats). La valeur d'un échantillon est la moyenne de ses aliquotes quantifiées ; seuls les échantillons au statut `quantified` comptent. **Aucune seconde règle d'agrégation** n'est écrite.
- **Formule :** score z modifié Mᵢ = 0,6745 · (xᵢ − médiane) / MAD, avec MAD = médiane(|xᵢ − médiane|) (Iglewicz & Hoaglin 1993, *How to Detect and Handle Outliers*, ASQC). 0,6745 est le quantile 0,75 de la loi normale centrée réduite : MAD / 0,6745 estime σ pour des données normales.
- **Seuil :** |Mᵢ| > 3,5. C'est la valeur recommandée par Iglewicz & Hoaglin. Le test est bilatéral : une valeur basse anormale est aussi signalée.
- **Conditions :** n ≥ 5 échantillons quantifiés dans le groupe et MAD > 0. Avec moins de 5 valeurs, la médiane et le MAD reposent sur 2 ou 3 nombres et ne sont pas stables.
- **Notes :**
  - `too_few_samples` : une note par groupe ayant des mesures d'échantillon et moins de 5 échantillons quantifiés, **y compris 0**. Exemple : « PMMA … : 1 échantillon quantifié, il en faut au moins 5 ; pas de recherche de valeur atypique. » ;
  - `zero_mad` : au moins la moitié des valeurs sont identiques, le score n'est pas calculable.
- **Mesures concernées :** les aliquotes quantifiées de l'échantillon, retrouvées avec la même clé de regroupement que `aggregate_aliquots`.
- **Chiffres :** `value`, `median`, `mad`, `z`, `n`, `threshold`.
- **Conditions d'échec connues** (fiche) :
  1. **Petit n avec des valeurs groupées.** Le MAD devient minuscule et l'on sur-signale. C'est le cas du PE dans l'exemple fictif : MAD = 0,1, et l'échantillon 4 (3,6 µg/mL) est signalé avec z = 7,42.
  2. **Forte censure à gauche.** Seules les valeurs quantifiées forment la distribution. Elle est tronquée, la médiane est tirée vers le haut, et une valeur basse anormale est presque indétectable.

### d) Taux de < LOD inhabituel par lot ou par date d'analyse (`unusual_lod_rate`, catégorie `batches`)

- **Dimensions :** `batch`, puis `analysis_date`, évaluées séparément. La valeur est rognée. `analysis_date` est la date normalisée par B1 (ISO), donc la comparaison se fait au jour près.
- **Population :** dans un groupe, les mesures **analysées** (statut ≠ `not_analysed`). « < LOD » veut dire statut `below_lod`. Les statuts `not_quantified` et `between_lod_loq` comptent comme « non < LOD ».
- **Valeur vide :** une mesure sans lot (ou sans date) n'entre dans **aucune** des deux parties de la comparaison, ni comme strate ni dans le « reste ».
  - Si aucune mesure de l'étude n'a de lot, la note `dimension_empty` est produite : « le lot n'est renseigné pour aucune mesure ; comparaison par lot impossible ». C'est le cas des deux exemples. La date suit la même règle.
  - Si un groupe a des lots mais aucun ne remplit les conditions, la note `too_few_in_strata` est produite.
- **Formule :** pour chaque strate s d'au moins 5 mesures analysées, quand il reste au moins 5 mesures analysées dans les **autres strates renseignées** du groupe, la table 2 × 2 est [[k_s, n_s − k_s], [k_r, n_r − k_r]]. Le test est le **test exact de Fisher bilatéral** (`scipy.stats.fisher_exact`, scipy est déjà une dépendance de `core`). Il y a signal si p < 0,01.
- **Deux strates seulement :** la comparaison est symétrique. Une seule est faite, et le signal porte sur la strate au taux le plus élevé (ordre alphabétique en cas d'égalité ; à taux égaux, p = 1 et il n'y a pas de signal).
- **Seuils :**
  - **α = 0,01** plutôt que 0,05, parce que le nombre de comparaisons (groupes × lots × 2 dimensions) multiplie les faux signaux. Il n'y a pas de correction de Bonferroni : un signal est une invitation à regarder, pas une inférence. La note `tests_performed` donne le nombre de comparaisons faites (« environ 1 faux signal attendu pour 100 comparaisons »).
  - **Minimum 5 :** à 5 contre 5, seule la répartition extrême (5/5 contre 0/5, p = 0,0079) atteint le seuil, et 4/5 contre 0/5 donne p = 0,048. Le test est donc prudent aux petits effectifs.
- **Mesures concernées :** toutes les mesures analysées de la strate, censurées comprises. Leur `canonical_value` est **null** dans la réponse si elles ne sont pas quantifiées.
- **Chiffres :** `k_stratum`, `n_stratum`, `k_rest`, `n_rest`, `rate_stratum_percent`, `rate_rest_percent`, `p_value`, `alpha`. Le rapport des cotes n'est pas exposé : il est infini quand une case est nulle, et un `Number` du moteur refuse l'infini.

## 5. Clé de signal

```
key = sha256_hex( json canonique {
  "v": "q1",
  "rule": "<rule>",
  "group": [polymer, method, matrix, matrix_detail, kind, basis, canonical_unit],
  "subject": { selon la règle },
  "records": trié([[file_sha256, sheet, source_row, source_column], …])
} )
```
Le JSON canonique s'écrit avec `sort_keys=True`, `ensure_ascii=False` et `separators=(",", ":")`. La clé fait 64 caractères hexadécimaux.

Le sujet dépend de la règle :

| Règle | `subject` | `records` |
|---|---|---|
| a | `{"sample": id}` | aliquotes quantifiées |
| b | `{"sample": id, "aliquot": a, "blank": id du QualityControlSummary}` | la mesure |
| c | `{"sample": id}` | aliquotes quantifiées de l'échantillon |
| d | `{"dimension": "batch" ou "analysis_date", "stratum": valeur}` | mesures analysées de la strate |

**Propriétés (testées) :**
- **Stable au rechargement :** la clé ne dépend que du contenu, ni de l'ordre des mesures ni d'un horodatage. Des mesures mélangées donnent les mêmes clés.
- **Stable face à un import sans rapport :** l'identité d'un import n'entre que par les mesures qui *contribuent* au signal. Un import d'un autre polymère, ou d'autres lots, ne change pas la clé. Il peut en revanche changer les chiffres (médiane, p), voire faire disparaître le signal, et c'est voulu.
- **L'empreinte du fichier, pas l'identifiant d'import.** Retirer un import puis réimporter **le même fichier** et la même feuille redonne les mêmes clés, et les décisions réapparaissent : ce sont les mêmes cellules. Un fichier corrigé a un autre sha256 : ses signaux sont nouveaux, et l'ancienne décision passe dans « signaux disparus ».
- **La version entre dans la clé.** Un passage à q2 change toutes les clés. Les décisions prises en q1 sont alors listées comme disparues, avec leur version, au lieu d'être rattachées en silence à une règle dont le sens a changé.
- **Le chiffre n'entre pas dans la clé.** Un signal recalculé avec d'autres chiffres reste le même signal. Les chiffres du moment de la décision sont conservés dans `ModelPrediction.output`.

## 6. Contrat du moteur : `POST /quality`

Les points communs aux autres routes :
- route synchrone (exécutée dans le pool de threads) ;
- secret `X-Engine-Secret` et barrière `SecretAndSizeGate` (limite déclarée de 75 Mo) ;
- `extra="forbid"`, et nombres finis (`Number`) ;
- erreurs `ErrorModel` en français ; une `ValueError` de B1 donne un 422 ;
- schéma régénéré dans `engine/openapi.json`, puis `npm run gen:engine`.

**Requête `QualityRequest`**

| Champ | Type |
|---|---|
| `records` | `list[QualityRecordModel]` : `MeasurementRecordModel` + `import_id: str` (non vide), `file_sha256: str` (64 hex), `sheet: str = ""` |
| `qc_summaries` | `list[QcSummaryModel]` = `[]` : `id`, `polymer`, `kind: str`, `n: int ≥ 1`, `mean: Number \| None`, `sd: Number \| None`, `unit_code: str`, `source: str` |
| `blank_corrected` | `"yes" \| "no" \| "unknown"` = `"unknown"` |

- `unit_code` et `kind` sont du texte libre : une ancienne ligne de contrôle à l'unité inconnue donne une **note**, pas un 422 pour toute l'étude.
- Une identité de mesure en double donne un 422 « Mesures en double dans la requête (même fichier, feuille, ligne et colonne). ».

**Volume :** 50 000 mesures (le plafond de C4) d'environ 600 octets avec les trois champs d'identité, soit environ 30 Mo, sous la limite de 75 Mo. La réponse n'est pas plafonnée ; sa taille est bornée par le nombre de mesures quantifiées multiplié par le nombre de blancs (§12).

**Réponse `QualityResponse`**

| Champ | Contenu |
|---|---|
| `quality_rules_version` | `"q1"` |
| `signals` | `list[QualitySignalModel]`, triés par règle (a, b, c, d), groupe puis sujet |
| `notes` | `list[QualityNoteModel]` : `rule`, `reason` (liste fermée du §4), `group: QualityGroupModel \| None`, `message` (français) |
| `rules` | `list[QualityRuleModel]` : `rule`, `title`, `description` (formule et seuil), `limits: list[str]` (conditions d'échec) |

`QualitySignalModel` :

| Champ | Contenu |
|---|---|
| `key` | 64 hex (§5) |
| `rule` | `aliquot_discordance \| near_blank \| robust_outlier \| unusual_lod_rate` |
| `category` | `replicates \| blanks \| distribution \| batches` (sans gravité) |
| `title` | « Discordance entre aliquotes », « Valeur proche des blancs », « Valeur atypique », « Taux de < LOD inhabituel » |
| `subject_label` | « Échantillon 12 », « Échantillon 4, aliquote a », « Lot B7 », « Date d'analyse 2026-03-04 » |
| `explanation` | phrase française, nombres par `fmt_fr` |
| `group` | `QualityGroupModel` (codes : polymère, méthode, matrice, détail, kind, basis, unité canonique) |
| `sample_id`, `aliquot`, `blank_id`, `dimension`, `stratum` | facultatifs selon la règle |
| `figures` | `list[QualityFigureModel {name, label, value: Number, unit: UnitCode \| None}]` : valeurs exactes, non arrondies |
| `records` | `list[QualityRecordRefModel {import_id, file_sha256, sheet, source_row, source_column, sample_id, aliquot, status, canonical_value: Number \| None, canonical_unit}]`, où `canonical_value` est **null si `status != quantified`** |

**Les mots à un seul endroit.** Toute la rédaction française vit dans un nouveau module, `microtrace_engine/quality_text.py` : titres, `subject_label`, explications, notes, libellés des chiffres, descriptions et limites des règles.
- `core` ne produit que des structures : règle, raison, groupe, chiffres.
- Le libellé des polymères (« PS (somme) », « Au moins un polymère ») sort de `report.py` vers `microtrace_engine/labels.py` (`polymer_label`). Le rapport et la qualité l'utilisent tous les deux, sans changement du rapport.
- Arrondis des explications :
  - pourcentages à 0,1 près ;
  - z à 0,01 près ;
  - rapports au blanc à 0,1 près ;
  - p à deux chiffres significatifs ;
  - valeurs telles quelles, par `fmt_fr`, c'est-à-dire 6 chiffres significatifs.

Modèles d'explication (a à c : textes attendus sur l'exemple fictif ; d : cas de test synthétique du §4) :
- a) « Échantillon 12 — PS (somme), Py-GC/MS, sang total : aliquotes quantifiées a = 4,8 et b = 2,6 µg/mL, écart relatif 59,5 % (étendue / moyenne), au-delà du seuil de 50 %. »
- b) « Échantillon 4, aliquote a — PET, Py-GC/MS, sang total : 0,6 µg/mL, soit 2,4 fois la moyenne des blancs de procédure (250 ng/mL, soit 0,25 µg/mL ; n = 3) ; seuil : moins de 3 fois. »
- c) « Échantillon 16 — PE, Py-GC/MS, sang total : 5,55 µg/mL (moyenne des aliquotes quantifiées), score z modifié 20,57 (médiane 2,5, écart absolu médian 0,1, n = 5 échantillons quantifiés) ; seuil : |z| > 3,5. »
- d) « Lot « A » — PET, Py-GC/MS, sang total : 9/10 mesures < LOD (90 %), contre 3/20 (15 %) dans les autres lots ; test exact de Fisher bilatéral, p = 0,00013 (seuil 0,01). »

**Journaux :** aucune valeur, aucun identifiant d'échantillon et aucune source de contrôle dans les journaux du moteur. Le test d'hygiène est étendu à `/quality`.

## 7. Application web

### 7.1 Service `web/src/server/quality.ts` (`server-only`)

```ts
getStudyQuality(ctx: LabContext, studyId: string): Promise<StudyQuality>          // viewer
recordQualityDecision(ctx: LabContext, studyId: string,
  input: { signalKey: string; decision: string; note?: string | null }): Promise<{ id: string }>  // researcher
```

**`getStudyQuality`**
1. Il appelle `loadActiveResultsInput(ctx, studyId, { withQcSummaries: true })` : même instantané, filtre par laboratoire, et « Étude introuvable. » pour une étude d'un autre laboratoire.
2. Sans mesure active, il renvoie `{ kind: "empty", disappeared }` **sans appeler le moteur**. Les décisions passées restent visibles.
3. Il construit `QualityRequest` :
   - les records dans l'ordre de `loadActiveResultsInput`, avec `import_id`, `file_sha256` et `sheet ?? ""` ;
   - les contrôles qualité de l'étude ;
   - `blank_corrected`.
4. Il appelle `engineClient.quality`.
5. Il lit les décisions : `ModelPrediction { studyId, kind: "quality", study: { laboratoryId } }`, par `createdAt` puis `id` décroissants, au plus 5 000 (§12). Pour chaque `input.signalKey`, il garde la plus récente et compte les décisions.
6. Il renvoie `{ kind: "ok", version, signals: [{ signal, decision | null }], notes, rules, disappeared, importNames, mixedRulesVersions, contextChanged, archived }`. `disappeared` regroupe les dernières décisions dont la clé n'est pas dans la réponse.

**`recordQualityDecision`**
1. Il vérifie le rôle (`researcher`).
2. Il valide la saisie :
   - `decision` dans la liste fermée, sinon « Décision inconnue. » ;
   - la note est rognée et fait au plus 1 000 caractères, sinon « La note dépasse 1 000 caractères. » ;
   - la note est **obligatoire** pour « Examiné — justifié » et « Erreur de saisie confirmée », sinon « Une note est obligatoire pour cette décision. ». Une décision qui clôt un signal doit dire pourquoi.
3. Il lit l'étude dans le laboratoire : « Étude introuvable. » ou « Étude archivée : lecture seule. », **avant** tout appel au moteur.
4. Il recalcule les signaux (comme `getStudyQuality`) et cherche `signalKey`. Introuvable, il renvoie « Ce signal n'existe plus : rechargez la page. » et n'écrit rien.
5. Dans une transaction :
   - `loadWritable(tx, ctx, studyId)`, qui revérifie le laboratoire et l'archivage ;
   - `modelPrediction.create` ;
   - `recordAudit`.

**Correspondance avec `ModelPrediction`**

| Colonne | Valeur |
|---|---|
| `kind` | `quality` |
| `modelName` | `"quality-rules"` |
| `modelVersion` | `quality_rules_version` de la réponse (`"q1"`) |
| `input` | `{ signalKey, rule, decision, importIds: [ids distincts des mesures concernées] }` |
| `output` | le `QualitySignalModel` **recalculé par le serveur**, tel quel |
| `inputFileSha256`, `score`, `modelSha256` | `null` (pas de fichier unique, pas de score, pas de poids) |
| `status` | voir ci-dessous |
| `decisionNote` | la note, ou `null` |
| `decidedById`, `decidedAt` | l'utilisateur, maintenant |

| Décision (code) | Libellé | `PredictionStatus` | Raison |
|---|---|---|---|
| `justified` | « Examiné — justifié » | `rejected` | le soupçon proposé par la règle est rejeté : la valeur est justifiée |
| `to_check` | « À vérifier » | `proposed` | la proposition reste ouverte ; on note qui l'a marquée |
| `entry_error` | « Erreur de saisie confirmée » | `accepted` | le signal est confirmé |
| — | — | `corrected` | **jamais écrit par C7** : la correction passe par le retrait et le réimport. Lu par erreur, il s'afficherait « Corrigé » |

Les tables de libellés, de statuts et de badges vivent dans `web/src/lib/quality.ts`, qui peut être importé côté client.

**Historique.** Chaque décision est une **nouvelle ligne**. Rien n'est modifié ni supprimé. La plus récente fait foi à l'écran, et l'historique complet est dans le Journal.

**Audit.** Chaque décision écrit `quality.decision`, avec `entityType: "ModelPrediction"`, `entityId` = id de la prédiction et `laboratoryId` obligatoire. Le champ `after` contient `{ studyId, signalKey, rule, ruleTitle, subject, decision, modelVersion, hasNote }`.
- Le texte de la note n'est **pas** recopié : il est conservé une fois, dans `ModelPrediction`, et le journal ne duplique pas un texte libre.
- `listAuditEvents` ajoute `{ entityType: "ModelPrediction", entityId: { in: ids des prédictions de l'étude } }`, avec le filtre existant sur `laboratoryId`.
- `audit-labels.ts` ajoute :
  - l'action « Décision qualité enregistrée » ;
  - l'entité « Signal de qualité » ;
  - les champs `ruleTitle` (« Règle »), `subject` (« Objet du signal »), `decision` (« Décision », avec ses libellés), `modelVersion` (« Version des règles »), `hasNote` (« Note jointe ») ;
  - `signalKey` et `rule` dans `HIDDEN_FIELDS` ;
  - pour `auditObjectName("ModelPrediction")`, l'objet « {ruleTitle} — {subject} ».

**Isolation.** Les deux fonctions entrent dans `tenant-isolation.test.ts`, dans les cas, les écritures et les lecteurs, et le simulacre `engineClient` reçoit `quality`. Tests ajoutés :
- une prédiction d'une étude de B, avec une clé identique à un signal de A, n'apparaît jamais chez A ;
- un `AuditEvent` forgé au laboratoire de B qui vise une prédiction de A est ignoré.

### 7.2 Modifications de l'existant

- `results.ts` :
  - l'option `withQcSummaries` lit `qualityControlSummary.findMany({ where: { studyId, study: { laboratoryId } }, orderBy: [{ polymer: "asc" }, { id: "asc" }] })` **dans la même transaction** ;
  - `ActiveResultsInput.qcSummaries` vaut toujours un tableau, vide sans l'option.
- `engine/client.ts` : la méthode `quality(req)`, et les types `QualityRequest`, `QualityResponse` et `QualitySignal`.
- `engine-messages.ts` :
  - `QUALITY_REFUSED` = « Le moteur d'analyse n'a pas pu calculer les signaux de qualité de cette étude. » ;
  - `CONTEXT_CHANGED` quitte `resultats/page.tsx` pour être partagé, avec le même texte.

## 8. Écran « Qualité »

**Adresse :** `/labo/[labSlug]/etudes/[studyId]/qualite`.

**Onglet :** `{ segment: "qualite", label: "Qualité" }`, entre Résultats et Rapport. Le libellé ne contient ni « Rapport » ni « Résultats », parce que Playwright compare les noms de lien par sous-chaîne.

Composants et règles de la passe de design :
- `Section` ;
- `Alert` `info` / `warning` / `destructive` ;
- `Badge` `positive` / `warning` / `destructive` / `neutral` / `outline` ;
- `EmptyState` avec une icône ;
- `Table` avec `TableCaption sr-only` ;
- jetons de couleur seulement ;
- un seul `h1` (l'en-tête d'étude), des `h2` pour les sections, des `h3` pour chaque règle, un `h4` pour chaque signal ;
- tablette en portrait (768) et en paysage (1024).

Ordre de la page :
1. **`Alert info`** : « Ces signaux sont des propositions calculées par des règles statistiques documentées (règles de qualité q1), pas des verdicts : chacun est à examiner par une personne compétente. Ils sont recalculés à chaque ouverture à partir des imports actifs ; seules les décisions sont enregistrées. »
2. **Alertes `warning`**, si besoin : « versions de règles différentes » et `CONTEXT_CHANGED`, mêmes textes que Résultats.
3. **Étude archivée :** `Alert info` « Étude archivée : les décisions sont en lecture seule. ».
4. **`Section` « Signaux »**, avec la description « {n} signaux — règles q1 ». Pour chaque règle qui a au moins un signal :
   - un `h3` avec le titre de la règle ;
   - une liste `ul` de cartes `li` (`rounded-lg border bg-card p-4 space-y-3`).

   Le contenu d'une carte :
   - en-tête : `h4` « {subject_label} — {polymère} » (libellé `polymerLabel`), badge `outline` du groupe (méthode · matrice · unité, mêmes libellés que Résultats). Il n'y a **aucune** couleur d'alerte : le signal n'a pas de gravité ;
   - l'explication du moteur, telle quelle (`text-sm`) ;
   - « Chiffres » : une `dl` en grille `grid-cols-[auto_1fr]` (libellé du moteur, `NumberFr engine` et unité) ;
   - « Mesures concernées ({n}) » dans un `details`, avec une table : Fichier, Ligne, Colonne, Aliquote, Statut, Valeur. **Une mesure censurée affiche son statut et « — », jamais un nombre** ;
   - la décision : badge (`positive` justifié, `warning` à vérifier, `destructive` erreur confirmée, `neutral` « Non examiné »), puis la note, puis « par {nom}, le {DateTimeFr} », puis « ({k} décisions, voir le Journal) » quand k > 1 ;
   - pour un `researcher` ou plus sur une étude non archivée, un `details` « Enregistrer une décision » qui contient le formulaire client `DecisionForm` :
     - un `fieldset` « Décision » avec trois boutons radio natifs étiquetés ;
     - un `Textarea` « Note » (obligatoire selon la décision, indiqué à côté) ;
     - le bouton « Enregistrer la décision » (« Enregistrement… » pendant l'envoi) ;
     - les champs cachés `studyId` et `signalKey`, et un `FormError`.

   Au plus 200 signaux sont affichés par règle, suivis de « {n} autres signaux non affichés. ».

   Sans aucun signal : « Aucun signal avec les règles q1. Les règles non appliquées sont listées ci-dessous. »
5. **`Section` « Règles non appliquées ou sans objet »** : la liste des `message` des notes.
6. **`Section` « Signaux disparus »**, seulement s'il y en a :
   - description : « Décisions dont le signal n'apparaît plus avec les mesures actuelles (import retiré, fichier corrigé, contrôles ou règles modifiés). Elles sont conservées. » ;
   - table : Règle, Objet, Décision, Note, Par, Le, Version des règles. Les libellés viennent de `output` (`title`, `subject_label`).
7. **`Section` « Règles de qualité (version q1) »** :
   - pour chaque règle, son titre et sa `description`, et un `details` « Limites connues » qui liste `limits` ;
   - la phrase « Fiche des règles complète : docs/models/c7-qualite.md (documentation du projet). ».

**États :**
- Aucune mesure active : `EmptyState` (`ShieldCheck`) avec `NO_SAMPLE_MEASUREMENTS`, puis la section « Signaux disparus » si elle existe.
- Moteur indisponible : `Alert destructive` avec `ENGINE_DOWN`, `QUALITY_REFUSED` ou `STUDY_TOO_LARGE` (413). Le message est fixe et la page ne plante pas.

## 9. Fiche des règles `docs/models/c7-qualite.md`

C'est la *model card* du §10 de la spec, adaptée à des règles.
- **Plan :**
  1. Objet (assistance à la revue, sans verdict, sans santé, sans imputation) ;
  2. Version (`q1`, date, lien avec `RULES_VERSION`) ;
  3. Entrées et données non utilisées ;
  4. Pour chaque règle : population, formule, seuil, justification et sources (§4), chiffres exposés ;
  5. Clé de signal ;
  6. Conditions d'échec connues ;
  7. Résultats de référence sur les exemples (§10) ;
  8. Décisions humaines et traçabilité ;
  9. Ce qui changera une version (tout changement de seuil, de population ou de clé, qui donne `q2`).
- **Conditions d'échec :**
  - petit n et MAD minuscule ;
  - forte censure ;
  - aliquote censurée qui masque une discordance ;
  - blanc sans méthode ;
  - données corrigées du blanc ;
  - unités non convertibles ;
  - comparaisons multiples ;
  - lot confondu avec une série de prélèvement ;
  - date au jour près ;
  - champs vides ;
  - imports aux versions de règles B1 différentes.
- **Relecture :** la fiche est relue avant d'être montrée aux chercheurs (spec §10). Ses références EPA sont vérifiées sur l'édition en vigueur à ce moment-là.

## 10. Résultats attendus sur les jeux d'exemple

### Exemple fictif (`leslie_like`, 200 mesures, une méthode, sang total, µg/mL, lot et date vides)

**Sans contrôle qualité :** 4 signaux, dans l'ordre de la réponse.

| Règle | Objet | Chiffres | Cellules (ligne, colonne) |
|---|---|---|---|
| Discordance | Échantillon 16 — PE | 7,1 et 4,0 ; écart 55,9 % | (29, PE), (30, PE) |
| Discordance | Échantillon 12 — PS (somme) | 4,8 et 2,6 ; écart 59,5 % | (22, PS), (23, PS) |
| Atypique | Échantillon 16 — PE | 5,55 ; z = 20,57 (médiane 2,5 ; MAD 0,1 ; n = 5) | (29, PE), (30, PE) |
| Atypique | Échantillon 4 — PE | 3,6 ; z = 7,42 | (8, PE) |

Pour les notes (5) :
- `near_blank / no_blank_summary` ;
- `robust_outlier / too_few_samples` pour PMMA (1 échantillon quantifié) et pour PP (0) ;
- `unusual_lod_rate / dimension_empty` pour le lot et pour la date.

Les autres groupes ne donnent pas de signal :
- PET : n = 11, médiane 0,85, MAD 0,3, |z| max 2,81 ;
- PS (somme) : n = 8, |z| max 1,97.

Les paires 1, 4, 8 et 11 (PET), 8 (PE) et 14 (PS) restent entre 18,2 % et 45,2 %, sous le seuil.

**Avec un contrôle** PET / blanc de procédure / n = 3 / moyenne 250 ng/mL (seuil 0,75 µg/mL) : 6 signaux de plus, dans l'ordre « 10 a, 11 b, 4 a, 4 b, 6 a, 7 a ».

| Échantillon, aliquote | Valeur (µg/mL) | Rapport au blanc | Ligne |
|---|---|---|---|
| 10, a | 0,45 | 1,8 | 18 |
| 11, b | 0,7 | 2,8 | 21 |
| 4, a | 0,6 | 2,4 | 8 |
| 4, b | 0,5 | 2 | 9 |
| 6, a | 0,7 | 2,8 | 12 |
| 7, a | 0,5 | 2 | 13 |

- La valeur 0,8 (échantillon 9) n'est pas signalée, puisque 0,8 ≥ 0,75.
- Les valeurs entre LOD et LOQ (`*0,2`, `*0,3`) ne sont **jamais** comparées.
- La note `no_blank_summary` devient `polymers_without_blank` : « PE, PMMA, PP, PS (somme) ».
- Les 4 signaux précédents gardent **la même clé**.

### Données réelles (Leslie et al. 2022, Tableau S2) : 3 signaux

| Règle | Objet | Chiffres |
|---|---|---|
| Discordance | Échantillon 12 — PS (somme) | 4,8 et 1,2 ; écart 120 % |
| Discordance | Échantillon 13 — PS (somme) | 4,3 et 1,2 ; écart 112,7 % |
| Atypique | Échantillon 7 — PET | 2,4 ; z = 3,51 (médiane 1,1 ; MAD 0,25 ; n = 11) |

Le cas de l'échantillon 7 montre un signal **à la limite** (3,507 pour un seuil de 3,5) : c'est exactement ce qu'une personne compétente doit examiner. Les autres groupes ne donnent pas de signal :
- PE : n = 5, MAD 2,3, |z| max 0,79 ;
- PS (somme) : |z| max 1,57.

Ces chiffres servent de tests de non-régression (core et moteur) et de vérification manuelle pour le fondateur.

## 11. Points de relecture et preuves

| Point (décision 7) | Preuve |
|---|---|
| Une valeur censurée n'est jamais un nombre | pytest : un `between_lod_loq` à `value` 0,2 n'entre ni dans a, ni dans b, ni dans c. Moteur : `canonical_value` est null pour les références non quantifiées. Page : une mesure censurée affiche « — » |
| Aucun groupe mélangé (unité, kind, basis, méthode, matrice, détail) | pytest paramétré : deux aliquotes qui ne diffèrent que par une dimension ne donnent aucune discordance ; les groupes de c et d sont séparés ; un blanc non convertible donne une note sans signal |
| n < 5 : pas de valeur atypique, et l'écran dit pourquoi | pytest `too_few_samples` (n = 4 et n = 0). Exemple fictif : notes PMMA et PP. Page : la section des règles non appliquées |
| Clés stables au rechargement et face à un import sans rapport | pytest : ordre mélangé et ajout d'un autre fichier sans rapport. Moteur : deux requêtes. E2E : rechargement, puis ajout d'un contrôle qualité qui laisse la décision attachée |
| Décision impossible d'un laboratoire à l'autre | `tenant-isolation.test.ts`, test du service, E2E : page introuvable |
| Décision refusée sur une étude archivée | test du service : « Étude archivée : lecture seule. », sans écriture ni appel au moteur. Page : formulaire absent |

## 12. Hors périmètre (à reporter au suivi)

- Les signaux dans le rapport téléchargeable.
- Des seuils réglables par laboratoire.
- Les notifications.
- Une méthode sur `QualityControlSummary`, et l'usage des blancs de terrain et des blancs mesurés importés (`qc_records`).
- La pagination des signaux, et le plafond de la réponse (plus de 200 par règle ne sont pas affichés, la réponse n'est pas plafonnée).
- La lecture de 5 000 décisions au plus par étude.
- La correction pour comparaisons multiples de la règle d.
- Une règle sur une paire « une aliquote quantifiée, l'autre < LOD ».
