# Prompt opencode — C4 : résultats, graphiques, rapport et parcours de bout en bout

Tu es l'ingénieur chargé de réaliser le sous-projet **C4** de MicroTrace Studio.

MicroTrace Studio est un **prototype SaaS multi-laboratoires** pour des laboratoires de recherche qui mesurent des microplastiques dans le sang humain. C'est un **prototype de recherche, pas un dispositif médical**.

Lis ce document en entier avant d'écrire du code. Il est autonome : ce qu'il ne décide pas, tu le décides de façon raisonnable et tu le notes dans ton rapport final.

## 0. Condition de départ (obligatoire)

C4 dépend de C3 (import des résultats). Ne commence **que si** `git log --oneline prototype` contient le commit `docs: close C3 (import)`, posé à la clôture de C3 après sa relecture finale. Sinon, arrête-toi et écris « C3 n'est pas terminé » dans ton rapport.

Travaille sur une **nouvelle branche** créée depuis `prototype` : `git switch -c c4-resultats prototype`.

**Interdictions :**
- ne pousse jamais ;
- ne fusionne jamais ;
- ne réécris pas l'historique.

Le fondateur relira et fusionnera.

## 1. À lire d'abord (sources d'autorité)

| Fichier | Pourquoi |
|---|---|
| `docs/superpowers/specs/2026-10-25-prototype-studio-design.md` | **Spec** : §2 (anti-objectifs), §3 (contrat du moteur), §6 (onglets Résultats et Rapport, « Calcul des résultats »), §7 (tests, Playwright), §8 (réussite mesurable), §11 (multi-laboratoires) |
| `docs/superpowers/plans/2026-10-25-c2-socle-web.md` | « Global Constraints » et « Liste de contrôle de l'interface » : elles s'appliquent à C4 |
| `docs/superpowers/plans/2026-10-27-c3-import.md` | ce que C3 a construit (imports, mesures, études d'exemple) |
| `docs/superpowers/suivi-prototype.md` | points reportés ; ne les traite pas, sauf s'ils bloquent C4 |
| `DEMARRAGE.md` | lancer la pile (Docker, mode développement sur le port 5433) |
| `web/src/server/engine/schema.d.ts` | types générés du moteur : `SummaryRequest`/`SummaryResponse` (`frequencies`, `stats`, `samples`, `aggregation_rule`), `ReportRequest`/`ReportResponse` (`markdown`, `html`) |

Code existant à réutiliser :
- `web/src/server/{lab-context,lab-role,studies,imports,audit,errors,run-action,action-error}.ts`
- `web/src/server/engine/client.ts` : `summary()`, `report()`, `dictionary()`
- `web/src/components/app/*` : `PageHeader`, `DataNatureBanner`, `EmptyState`, `NumberFr`, `DateTimeFr`, `FormError`, `SubmitButton`, `ConfirmDialog`
- `web/src/lib/{units,audit-labels,roles}.ts`
- **Pages de référence pour le style :** l'onglet Paramètres et l'onglet Imports d'une étude (`web/src/app/(app)/labo/[labSlug]/etudes/[studyId]/…`)

## 2. Règles non négociables

1. **Aucune statistique ni règle scientifique en TypeScript.** Fréquences, médianes, moyennes, agrégation par échantillon, regroupement par unité, statut de détection : tout vient du moteur (`POST /summary`, `POST /report`). Le TypeScript ne fait que charger, transmettre, formater et afficher. Si un chiffre manque dans la réponse du moteur, signale-le ; ne le calcule pas.
2. **Jamais de mélange** d'unités, de types de quantité (`kind`), de bases (`basis`), de méthodes ni de matrices. Un tableau ou un graphique par groupe (méthode, matrice, détail de matrice, kind, basis, unité canonique), comme le moteur les renvoie.
3. **Aucune imputation.** Une valeur < LOD ou entre LOD et LOQ n'est jamais remplacée par un nombre ; elle s'affiche avec son statut.
4. **Multi-laboratoires (§11) :**
   - chaque service reçoit un `LabContext` (`requireLab(labSlug, rôle)`) ;
   - chaque requête Prisma filtre sur `laboratoryId`, directement ou via l'étude vérifiée ;
   - un identifiant d'un autre laboratoire produit « Étude introuvable. » ;
   - chaque nouvelle fonction exportée d'un service est ajoutée à `web/src/server/__tests__/tenant-isolation.test.ts`, dont l'énumération des exports échoue sinon.
5. **Droits :**
   - lecture des résultats et téléchargement du rapport : rôle `viewer` minimum ;
   - une étude archivée reste consultable et téléchargeable.
6. **Résultats calculés à la demande**, sur les mesures des imports `active` uniquement. Aucun instantané stocké (§6).
7. **Mentions obligatoires**, sur l'écran Résultats et dans le rapport :
   - la nature des données (`DataNatureBanner`, avec « SIMULÉ » pour une étude simulée) ;
   - « Prototype de recherche, pas un dispositif médical » ;
   - la règle d'agrégation (`aggregation_rule`) affichée telle quelle.
8. **Versions de règles :** si les imports actifs ont été contrôlés avec des `rulesVersion` différentes, un avertissement apparaît en tête de l'écran Résultats et du rapport (§6).
9. **Interface :**
   - textes en français ; nombres et dates `fr-FR` (`NumberFr`, `DateTimeFr`) ;
   - unités affichées avec `unitLabel` (µg/mL) ;
   - un seul `h1` par page ; `h2` pour les sections ;
   - nombres alignés à droite ;
   - couleurs **uniquement** via les jetons du thème (`--chart-1` à `--chart-5` dans `web/src/app/globals.css`) ;
   - tablette OK ; téléphone non requis.
10. **Accessibilité des graphiques :** chaque graphique a un titre (`h3`), une phrase qui dit ce qu'il montre, et le **tableau de données équivalent** juste en dessous (ou un bouton « Voir les données »).
11. **Dépendances :**
    - seulement `recharts` (graphiques) et `@playwright/test` (bout en bout) ;
    - versions **exactes**, épinglées dans `package.json`, avec `package-lock.json` mis à jour ;
    - vérifie avec `npm view <paquet> repository.url` que ce sont les paquets officiels, et note-le dans ton rapport ;
    - aucune autre dépendance sans t'arrêter pour le signaler.
12. **Sécurité et environnement :**
    - ne lis, n'affiche et ne commite jamais `.env`, `web/.env` ni `web/.env.local` ;
    - ne touche jamais au service PostgreSQL Windows (port 5432). Les tests utilisent embedded-postgres (`web/test/db-start.ts`) ; le bout en bout utilise sa propre base ;
    - ne commite rien sous `datasets/` ;
    - ne lance jamais `docker system prune` et ne supprime aucun volume qui n'est pas le tien.
13. **Journaux :** jamais de valeur de mesure ni de nom de fichier dans `console.*`.

## 3. Plan (5 tâches, une à la fois, TDD)

Pour chaque tâche :
1. écris d'abord les tests qui échouent et note l'échec ;
2. implémente ;
3. fais passer `npm test`, `npm run typecheck`, `npm run lint` et `npm run build` dans `web/` ;
4. commite avec un message conventionnel (`feat(web): …`, `test(web): …`).

### Tâche 1 — Service des résultats

- Crée `web/src/server/results.ts` (`server-only`) avec `getStudyResults(ctx, studyId)`, rôle `viewer`. Il :
  - lit l'étude en filtrant sur le laboratoire ;
  - charge les `Measurement` des imports `active` (filtre `importRun.status = "active"` + laboratoire) ;
  - les convertit en `MeasurementRecordModel` avec `measurementRecord(row)`, exporté par `web/src/server/imports.ts`. C'est l'inverse exact de `measurementRow`, déjà couvert par un test d'aller-retour : ne le réécris pas ;
  - les trie **toujours** par import (date de création), puis `sourceRow`, puis `sourceColumn` : les mesures n'ont pas de colonne d'ordre, et ce tri rend l'écran, le CSV et le rapport reproductibles ;
  - appelle `engineClient.summary` ;
  - renvoie `{ summary, imports: [{ id, fileName, sha256, rulesVersion, createdAt, author }], mixedRulesVersions: boolean, nature }`.
- **Aucune mesure active :** renvoie `{ empty: true }` sans appeler le moteur.
- **Volume :**
  - C3 plafonne une étude à **100 000 mesures actives** (`MAX_STUDY_ACTIVE_RECORDS`, mesures et contrôles qualité confondus). C'est donc le maximum que `/summary` et `/report` recevront ;
  - une mesure pèse environ 525 octets en JSON, soit environ 52 Mo pour 100 000 mesures. La limite du moteur est d'environ 75 Mo par requête (`MAX_REQUEST_BYTES` dans `engine/src/microtrace_engine/app.py`) ;
  - pour `/report`, les issues de chaque import s'ajoutent : par exemple une information par ligne pour la somme des PS ;
  - mesure la taille réelle des requêtes `/summary` et `/report` pour une étude au plafond. Si elle dépasse 75 Mo, ou en approche à moins de 10 %, arrête-toi et propose une solution dans ton rapport. Ne relève pas la limite sans le documenter.
- **Tests :**
  - résultats d'une étude avec deux imports actifs et un retiré : les mesures du retiré sont exclues ;
  - avertissement si deux `rulesVersion` diffèrent ;
  - viewer autorisé ; autre laboratoire → « Étude introuvable. » ;
  - moteur indisponible → `EngineUnavailableError` (message « Le moteur d'analyse est indisponible. »).

### Tâche 2 — Onglet Résultats

Remplace le texte d'attente de `…/etudes/[studyId]/resultats/page.tsx`.

**Contenu :**
- avertissement « versions de règles différentes » si besoin ;
- règle d'agrégation ;
- pour chaque groupe :
  - tableau des **fréquences** : polymère, matrice, « n quantifiés / n échantillons », pourcentage `fr-FR` ;
  - tableau des **statistiques** : n quantifiés, min, médiane, moyenne, max, comptes par statut, avec l'unité ;
  - graphique en barres de la fréquence de quantification par polymère ;
  - graphique en points des valeurs par échantillon pour les échantillons quantifiés, un point par échantillon, axe en unité canonique ;
  - les statuts non quantifiés sont comptés dans une légende ou un tableau, **jamais tracés comme des nombres**.

**Codes de polymères :** le moteur renvoie des codes, pas des libellés. Affiche-les avec une table de libellés français unique, dans `web/src/lib/` :
- `PS_SUM` → « PS (somme) » ;
- `ANY` → « Au moins un polymère » ;
- tout autre code s'affiche tel quel (PET, PE, PP, PMMA…).

Ce sont des libellés d'affichage, pas des règles : la ligne `ANY` est calculée par le moteur.

**Composants :** les graphiques sont des composants client (`"use client"`, Recharts), qui reçoivent des données déjà calculées par le moteur.

**Cas particuliers :**
- aucune mesure : `EmptyState` « Aucun import actif : importez un fichier pour voir les résultats. », avec un lien vers l'onglet Imports pour les rôles qui peuvent écrire ;
- moteur indisponible : message français dans une `Alert`, sans plantage de la page.

**Tests (Testing Library, service simulé) :**
- les fréquences s'affichent au format « 11/22 » et « 50 % » ;
- l'avertissement de versions apparaît ;
- l'état vide s'affiche ;
- un seul `h1` ;
- le tableau de données équivalent existe pour chaque graphique ;
- aucune couleur codée en dur (grep dans le test ou dans la relecture).

### Tâche 3 — Onglet Rapport et téléchargements

**Route** `GET …/etudes/[studyId]/rapport/telecharger?format=html|md` (route handler, rôle `viewer`). Elle construit le `ReportRequest` du moteur :
- métadonnées de l'étude : titre, nature, DOI, licence ;
- imports actifs : fichier, sha256, `rulesVersion`, date, auteur, issues ;
- `records`, `qc_records` (triés comme en tâche 1) ;
- le **contexte figé** (`ImportRun.frozenContext`), c'est-à-dire celui avec lequel les statuts ont été calculés, et non le contexte actuel :
  - si tous les imports actifs ont le même contexte figé, utilise-le ;
  - s'ils diffèrent, ou si le contexte actuel (`buildStudyContext`) diffère du contexte figé, utilise celui de l'import le plus récent. Le rapport et l'écran Résultats affichent alors en tête : « Les paramètres de l'étude (méthodes ou limites) ont changé depuis certains imports : les statuts restent ceux calculés lors de chaque import. » ;
  - teste ce cas ;
- `generated_at`.

Elle renvoie le fichier en pièce jointe :
- nom : `rapport-<titre-normalisé>-<AAAA-MM-JJ>.html` ou `.md` ;
- en-têtes : `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, et pour le HTML `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:`.

**Exports :**
- **CSV des mesures actives** :
  - séparateur `;`, UTF-8 avec BOM pour Excel ;
  - en-têtes = noms de champs du dictionnaire du moteur ;
  - valeurs **telles qu'enregistrées**, sans recalcul ;
  - une colonne `import` avec le nom du fichier.
- **Dictionnaire de données** : `GET /dictionary` du moteur, en CSV et en Markdown.

**Audit :** chaque téléchargement de rapport écrit un `AuditEvent` `report.download` (« Rapport téléchargé »), avec le format, dans la même logique que les autres audits (`laboratoryId` obligatoire). Ajoute le libellé dans `audit-labels.ts`.

**Page Rapport :** ce que contient le rapport, les boutons de téléchargement, et la mention « Prototype de recherche, pas un dispositif médical ».

**Tests :**
- en-têtes et nom de fichier ;
- viewer autorisé ; autre laboratoire → 404 ;
- l'audit est écrit ;
- le CSV contient le BOM et `;` ;
- le contenu HTML vient du moteur sans modification ;
- **le TypeScript n'assemble aucun HTML**.

### Tâche 4 — Parcours de bout en bout (Playwright)

**Mise en place :**
- ajoute `@playwright/test`, une configuration `web/playwright.config.ts` et un script `npm run e2e` ;
- installe seulement Chromium (`npx playwright install chromium`).

**L'environnement de test est autonome** (`globalSetup`) :
- PostgreSQL embarqué sur un port libre, puis `prisma migrate deploy` ;
- le moteur Python (`.venv/Scripts/python -m microtrace_engine`, ou `.venv/bin/python`) sur un port libre avec un `ENGINE_SECRET` aléatoire de 48 caractères ;
- l'application en mode production : `next build` puis `next start` sur un port libre, avec `DATABASE_URL`, `ENGINE_URL`, `ENGINE_SECRET`, `AUTH_SECRET`, `AUTH_URL`/`APP_URL` et `MICROTRACE_VAR_DIR` pointant vers un dossier temporaire ;
- les données de départ sont créées par les **services** (création du compte, du laboratoire et de l'appartenance), jamais par l'interface d'administration.
- **Tout est arrêté et supprimé** en `globalTeardown`.

**Parcours A — étude d'exemple fictive :**
1. connexion ;
2. page Projets → « Créer l'étude d'exemple (fictive) » ;
3. onglet Résultats : le parcours vérifie **PET 11/22, PS (somme) 8/22, PE 5/22, PMMA 1/22, PP 0/22, Au moins un polymère 17/22**, soit les codes moteur `PS_SUM` et `ANY` affichés avec leurs libellés ;
4. onglet Rapport : téléchargement du HTML.

Le fichier téléchargé doit contenir :
- ces six chiffres ;
- le sha256 du fichier importé ;
- la version des règles ;
- la mention « SIMULÉ ».

**Parcours A′ — étude réelle Leslie et al. 2022 :** mêmes six chiffres. Le rapport cite le DOI `10.1016/j.envint.2022.107199` et la licence `CC BY 4.0`, sans la mention « SIMULÉ ».

**Parcours B — fichier en erreur :** dépôt d'un petit CSV contenant une erreur bloquante, par exemple une unité inconnue. Le contrôle affiche l'erreur et le bouton « Enregistrer l'import » reste désactivé. Aucun import n'est créé (vérifié en base).

**Parcours C — isolation :** un membre du laboratoire A ouvre l'adresse des résultats d'une étude du laboratoire B et obtient la page « introuvable ».

### Tâche 5 — Clôture

- Mets à jour `DEMARRAGE.md` : comment lancer `npm run e2e`, et où trouver les rapports téléchargés.
- Ajoute à `docs/superpowers/suivi-prototype.md`, section « C4 — points reportés », ce que tu as volontairement laissé de côté.
- Relis l'ensemble de ton diff contre les règles du §2 de ce prompt :
  - grep des calculs suspects en TS (`reduce(`, `median`, `mean`, `/ n`…) dans le code de résultats ;
  - grep des couleurs codées en dur ;
  - grep des requêtes Prisma sans `laboratoryId`.

## 4. Quand t'arrêter et demander

Arrête-toi (sans contourner le problème) et écris la question en tête de ton rapport si :
- un chiffre du §8 ne sort pas du moteur ;
- la réponse `/summary` ne contient pas ce qu'il faut afficher ;
- une dépendance supplémentaire semble nécessaire ;
- la limite de taille du moteur est atteinte ;
- un test existant de C1 à C3 doit être modifié pour passer.

## 5. Rapport final (obligatoire)

Écris `.superpowers/c4-opencode-rapport.md` (dossier ignoré par Git). Il contient :
- l'état de chaque tâche ;
- les commits, avec leur SHA et leur message ;
- la sortie résumée de `npm test`, `typecheck`, `lint`, `build` et `npm run e2e` ;
- les décisions que tu as prises ;
- la provenance des paquets ajoutés ;
- les mesures de volume (taille du JSON pour 100 000 mesures) ;
- les écarts au plan et les questions ouvertes.

Ce rapport sera relu, avec ton diff, par une relecture indépendante avant la fusion.
