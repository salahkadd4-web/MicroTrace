# Prototype fonctionnel MicroTrace Studio — conception

**Date :** 2026-10-25
**Statut :**
- L'architecture a été choisie par le fondateur : application Next.js + Prisma + PostgreSQL, et moteur scientifique Python réutilisant B1.
- Les autres choix sont ceux de l'équipe technique, par délégation (« c'est toi qui décide »).
- Le prototype sera montré à des chercheurs pour recueillir leur avis.

**Sources :** `docs/superpowers/specs/2026-10-24-microtrace-studio-v0-design.md` (règles §5, schéma §6, modèle §8) ; package `microtrace_core.results` (B1, terminé, 869 tests).

## 1. Intention

Un prototype complet et utilisable :
1. un chercheur se connecte et crée une étude ;
2. il dépose son tableau de résultats et corrige la correspondance des colonnes ;
3. il voit les contrôles, ligne par ligne, en français ;
4. il valide l'import ;
5. il retrouve ses données enregistrées, ses statistiques honnêtes, ses graphiques, un rapport traçable et l'historique des actions.

C'est le MVP de la section 5 du plan, en version prototype. **Depuis le 2026-10-26, il est multi-laboratoires dès le départ (SaaS), voir §11** ; cette section §11 prime sur toute mention d'un laboratoire unique ci-dessous.

Les règles scientifiques restent à **un seul endroit** : B1, en Python. L'application TypeScript ne réimplémente aucune règle. Elle orchestre les appels, enregistre les données et affiche les résultats.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
1. Comptes utilisateurs : connexion par e-mail et mot de passe, et création du premier compte par commande.
2. Projets → études, avec :
   - la nature des données (publiée, laboratoire, simulée), et le DOI et la licence obligatoires pour une étude publiée ;
   - la correction des blancs ;
   - la déclaration de pseudonymisation ;
   - les méthodes, la table de limites (LOD/LOQ) et les contrôles qualité résumés.
3. Import guidé :
   1. dépôt d'un CSV ou XLSX ;
   2. aperçu ;
   3. correspondance des colonnes, proposée puis modifiable ;
   4. contrôle à blanc avec la liste des issues ;
   5. acceptation explicite des avertissements ;
   6. enregistrement.
4. Fichier original conservé à l'identique (sha256) ; import enregistré avec sa correspondance, sa version de règles et ses issues ; mesures enregistrées.
5. Retrait d'un import, avec un motif obligatoire. Ses mesures sont exclues des vues sans être supprimées. Après un retrait, on peut réimporter le fichier corrigé.
6. Tableau de bord d'étude :
   - fréquences de quantification par polymère et par matrice ;
   - statistiques par (polymère, méthode, matrice, unité) ;
   - deux graphiques : fréquences, et valeurs quantifiées par échantillon.
7. Rapport HTML autonome et Markdown, export CSV des mesures et du dictionnaire de données.
8. Journal d'audit en ajout seul, consultable par étude.
9. Un jeu d'exemple **fictif** façon Leslie 2022, chargeable en un clic, étiqueté SIMULÉ partout.

**Non-objectifs (prototype)** :
- rôles fins et multi-laboratoire ;
- mise en ligne publique ;
- export PDF ;
- module IA spectral ;
- édition des mesures dans l'interface ;
- import d'autres formats que CSV et XLSX ;
- envoi d'e-mails, réinitialisation de mot de passe.

**Anti-objectifs** (un échec même si « ça marche ») :
- dupliquer une règle scientifique en TypeScript ;
- enregistrer une mesure quand l'import contient une erreur, ou avant l'acceptation explicite des avertissements ;
- afficher un résultat sans la nature des données ;
- imputer une valeur, ou mélanger des unités, des grandeurs, des méthodes ou des matrices dans un tableau ou un graphique ;
- stocker ou afficher une valeur signalée comme donnée personnelle. B1 garantit déjà que les issues ne les recopient pas. Un import refusé pour données personnelles n'enregistre **rien** : ni fichier, ni import, ni mesure. Seul un `AuditEvent` « import refusé (données personnelles) » est créé, avec les comptes d'issues et sans aucune valeur, voir §5 ;
- modifier ou supprimer un fichier source, une mesure ou un événement d'audit ;
- exposer le moteur Python ou la base hors de la machine.

## 3. Architecture

```
navigateur ──► web (Next.js, TypeScript, App Router)
                 │  Prisma ──► PostgreSQL (docker compose)
                 │  magasin de fichiers local (var/files/<sha256>)
                 └─ HTTP localhost + secret partagé ──► engine (FastAPI, Python)
                                                         └─ microtrace_core.results (B1)
```

- **`engine/`** : nouveau composant Python (package `microtrace_engine`, layout `src/`, comme `core/`). C'est un service FastAPI **sans état et sans base de données**. Il reçoit les octets du fichier, la correspondance et le contexte d'étude, et renvoie du JSON. Il dépend de `microtrace-core` et n'importe jamais `microtrace_ml`. Il écoute sur `127.0.0.1`, et chaque requête doit porter l'en-tête `X-Engine-Secret`.
- **`web/`** : application Next.js en TypeScript, avec Prisma (PostgreSQL), Auth.js (identifiants e-mail + mot de passe haché), Tailwind CSS et shadcn/ui pour les composants, et Recharts pour les graphiques. Tous les appels au moteur passent **côté serveur** (route handlers ou server actions) ; le navigateur ne voit jamais le moteur.
- **PostgreSQL** et le moteur tournent dans `docker compose`, avec des images à version fixée. L'application web tourne en `npm run dev` pendant le développement. Un `docker compose up` lance l'ensemble pour une démonstration.

### Contrat du moteur (JSON, version `engine_api: 1`)

| Point d'entrée | Entrée | Sortie |
|---|---|---|
| `POST /tables/read` | fichier (multipart), feuille optionnelle | colonnes, aperçu (≤ 20 lignes), nombre de lignes, feuilles disponibles, sha256 ; ou erreur de lecture en français (422) |
| `POST /mapping/suggest` | fichier, feuille | correspondance proposée (`Mapping` sérialisé) |
| `POST /imports/check` | fichier, feuille, correspondance, contexte d'étude | `ImportResult` sérialisé : records, qc_records, issues, has_errors, rules_version, n_rows |
| `POST /summary` | liste de mesures (format record sérialisé) | fréquences, statistiques, agrégats par échantillon, règle d'agrégation |
| `POST /report` | métadonnées d'étude, de fichier et d'import, mesures, issues | rapport Markdown et HTML |
| `GET /dictionary` | — | dictionnaire de données (CSV et Markdown) |
| `GET /health` | — | versions : moteur, règles B1, package |

Les erreurs de contexte (`ValueError` de B1, en français) renvoient un 422 avec le message. Le moteur ne journalise jamais le contenu des fichiers ni les valeurs des cellules.

**Formes JSON.**
- Le moteur définit des modèles Pydantic qui sont l'image exacte des dataclasses de B1. FastAPI en publie le schéma OpenAPI.
- `web/` génère ses types TypeScript depuis ce schéma (`openapi-typescript`), sans les écrire à la main.
- Conventions de sérialisation :
  - les enums sont leurs valeurs texte ;
  - une `Unit` est sérialisée par son code (`"ug/mL"`) ;
  - les dates sont des chaînes ISO.
- Le **contexte d'étude** est exactement le `StudyContext` de B1 : `data_nature`, `methods` (nom, technique), `limits` (méthode, polymère, lod, loq, unit_code, source), `reference_doi`, `reference_license`, `blank_corrected`. La déclaration de pseudonymisation et les contrôles qualité résumés sont des données de l'application, non envoyées au moteur. **B1 n'est pas modifié**, sauf pour l'ajout du jeu fictif (ci-dessous).
- `/summary` reçoit des mesures dans la même forme que les records de `/imports/check`.

**Cohérence entre imports.** `/imports/check` accepte un champ facultatif `existing` : les clés des mesures actives déjà enregistrées dans l'étude (sample_id, aliquot, record_type, polymère, méthode, matrice, détail de matrice). Le moteur applique, en Python, les mêmes règles qu'à l'intérieur d'un fichier :
- un doublon d'un enregistrement existant → `E_DUPLICATE_RECORD` ;
- un échantillon qui change de matrice ou de type → `E_SAMPLE_CONFLICT`.

Ainsi, aucune règle n'est écrite en TypeScript. Ces deux contrôles sont ajoutés dans `microtrace_engine` à partir des fonctions de B1.

**Jeu fictif.** Le générateur « façon Leslie » de `core/tests/results/conftest.py` est déplacé dans `microtrace_core.results.examples`, et les tests de B1 l'importent depuis là. Il reproduit déjà les fréquences §8. Le moteur l'expose via `GET /examples/leslie-like`, qui renvoie le CSV, le contexte et la correspondance.

## 4. Modèle de données (Prisma)

Il reprend le modèle §8 de la conception Studio v0 :
- `User` : nom, e-mail unique, mot de passe haché, actif.
- `Project` : titre, description, propriétaire.
- `Study` :
  - projet, titre, nature (`published | laboratory | simulated`), DOI, licence, `blankCorrected` (`yes | no | unknown`) ;
  - déclaration de pseudonymisation (booléen + auteur + date) ;
  - `archivedAt`.
- `Method` : étude, nom (unique par étude après normalisation de la casse et des espaces), technique.
- `DetectionLimit` : étude, méthode, polymère, LOD, LOQ, code d'unité, source. Unique par (étude, méthode, polymère).
- `QualityControlSummary` : étude, polymère, type, n, moyenne, écart-type, unité, source.
- `DataFile` : étude, nom d'origine, sha256, taille, type MIME, chemin dans le magasin, auteur, date.
- `ImportRun` :
  - étude, fichier, feuille, correspondance (JSON), contexte figé (JSON) ;
  - version des règles, version du moteur ;
  - issues (JSON) et compteurs par gravité ;
  - avertissements acceptés (booléen + date + auteur) ;
  - statut `active | retired`, motif et date de retrait ;
  - auteur, date.
- `Measurement` : un enregistrement de B1 (`MeasurementRecord`), avec tous ses champs, lié à l'`ImportRun` et typé (enums Prisma pour la matrice, le statut, le type d'enregistrement, l'identification et la technique).
- `QcMeasurement` : les `qc_records`, même forme.
- `AuditEvent` : auteur, action, type d'entité, identifiant, avant/après (JSON), horodatage. **Aucune mise à jour ni suppression** dans le code de l'application ; en base, un déclencheur SQL refuse `UPDATE` et `DELETE` sur cette table.

Règles :
- Un même sha256 ne peut pas avoir deux imports `active` dans la même étude.
- Une étude archivée est en lecture seule.
- Une étude n'est jamais supprimée.

## 5. Parcours d'import (machine à états)

1. **Dépôt.** Le fichier est lu par `/tables/read`. S'il est refusé (taille, format, formule non calculée), l'erreur s'affiche et rien n'est enregistré.
2. **Correspondance.** La proposition vient de `/mapping/suggest`, puis l'utilisateur la modifie dans un formulaire : mode long ou large, une colonne ou une constante par champ, colonnes de polymères, case pour séparer les aliquotes.
3. **Contrôle.** `/imports/check` est appelé avec le contexte d'étude, construit depuis la base. Les issues sont affichées dans une table filtrable (gravité, code, ligne, colonne, champ, message). Rien n'est enregistré.
4. **Décision.**
   - S'il y a des erreurs, l'enregistrement est impossible.
   - S'il n'y a que des avertissements, une case d'acceptation est obligatoire.
   - Le bouton « Enregistrer l'import » fait tout dans **une seule transaction** :
     - écriture du fichier dans le magasin, s'il n'y est pas déjà ;
     - création du `DataFile` ;
     - création de l'`ImportRun`, avec les issues ;
     - création des `Measurement` et `QcMeasurement` ;
     - création des `AuditEvent`.
   - Le serveur **relance** `/imports/check` à l'enregistrement. Il ne fait jamais confiance au résultat envoyé par le navigateur.
5. **Retrait.** Un motif est obligatoire. Le statut passe à `retired` et un `AuditEvent` est créé. Le fichier corrigé peut ensuite être réimporté.

Un fichier refusé pour cause de données personnelles n'est **jamais** écrit dans le magasin.

**Précisions d'implémentation (choix de l'équipe technique).**
- **Zone de dépôt temporaire.** Au dépôt, les octets sont gardés côté serveur dans `var/staging/<jeton>`, et non dans le navigateur. Le jeton est aléatoire ; la zone est purgée après 24 h. Le navigateur ne manipule que le jeton.
- **Enregistrement.** Le serveur relit les octets depuis la zone de dépôt, recalcule le sha256, puis relance `/imports/check` avec `existing`.
  - Si le contrôle est propre, le fichier est copié dans `var/files/<sha256>`, puis la transaction Postgres est exécutée.
  - Si la transaction échoue, un fichier orphelin peut rester dans le magasin. C'est toléré (il est adressé par son contenu), et une commande de maintenance listera les orphelins plus tard.
- **Fichiers et retraits.** Un fichier dont l'import a été retiré peut être réutilisé : le magasin est adressé par contenu. Le refus « même sha256 » ne s'applique que s'il existe un import `active` de ce fichier dans l'étude.
- **Refus pour données personnelles.** Rien n'est enregistré, la zone de dépôt est effacée immédiatement, et un `AuditEvent` est créé sans aucune valeur.

## 6. Écrans (français)

- Connexion.
- Projets : liste et création.
- Étude : en-tête avec la nature des données et l'avertissement « prototype de recherche, pas un dispositif médical », puis cinq onglets :
  1. Paramètres : méthodes, limites, contrôles qualité, référence. Un bouton préremplit le Tableau 3 de Leslie 2022.
  2. Imports : liste avec statut, assistant d'import, retrait.
  3. Résultats : fréquences, statistiques, graphiques, avec la règle d'agrégation affichée.
  4. Rapport : téléchargements.
  5. Journal : événements d'audit.
- Bouton « Créer l'étude d'exemple (fictive) » sur la page Projets. Il crée un projet et une étude `simulated`, la méthode Py-GC/MS, les limites du Tableau 3, et importe le fichier fictif.

Les nombres sont affichés à la française. Couleurs sobres et accessibles. Mise en page utilisable sur tablette ; l'usage sur téléphone n'est pas un objectif.

**Calcul des résultats.** Les résultats et rapports sont **calculés à la demande** depuis la base, sur les mesures des imports `active` uniquement, sans instantané stocké. Les mesures de tous les imports actifs d'une étude sont regroupées. B1 ne mélange jamais unités, méthodes ni matrices, et la cohérence entre imports est garantie par le contrôle `existing` (§3).

Chaque rapport indique :
- sa date de génération ;
- la version du moteur et la version des règles utilisée pour le calcul ;
- la version des règles **de chaque import**.

Si les imports actifs ont été contrôlés avec des versions de règles différentes, un avertissement apparaît en tête de l'écran Résultats et du rapport.

**Comptes et accès.**
- Le premier compte (et les suivants) est créé par un script : `npm run user:create -- --email … --name …`, qui demande le mot de passe sans écho. Il n'y a pas d'inscription libre.
- Sessions Auth.js de 8 h. Pas de politique de verrouillage dans le prototype (non-objectif).
- ~~Un seul laboratoire~~ — remplacé par §11 : chaque utilisateur ne voit que les laboratoires dont il est membre, selon son rôle.

**Tests et audit.** Le déclencheur d'audit refuse `UPDATE` et `DELETE` ligne à ligne. La base de test est réinitialisée par `prisma migrate reset`, ou par `TRUNCATE` dans les tests, que le déclencheur n'empêche pas.

## 7. Qualité et tests

- **engine** : pytest et le client de test FastAPI. Contrat de chaque point d'entrée, secret obligatoire, 422 en français, aucune valeur de cellule dans les journaux.
- **web** :
  - Vitest pour la logique serveur : construction du contexte d'étude, machine à états d'import, règles d'unicité, audit en ajout seul ;
  - tests d'intégration Prisma sur une base de test ;
  - **Playwright** pour deux parcours de bout en bout : (a) étude d'exemple → résultats → téléchargement du rapport ; (b) fichier avec une erreur → enregistrement impossible.
- Le déclencheur d'audit est testé en SQL : un `UPDATE` ou un `DELETE` échoue.
- Les tests de B1 restent la référence des règles scientifiques.

## 8. Réussite mesurable

- Sur une machine propre : `docker compose up` puis `npm run dev` (ou `docker compose up` seul), et l'application fonctionne. La création du premier compte se fait par commande.
- Avec l'étude d'exemple, l'écran Résultats affiche PET 11/22, PS (somme) 8/22, PE 5/22, PMMA 1/22, PP 0/22, au moins un polymère 17/22. Le rapport HTML contient ces chiffres, le sha256 du fichier, la version des règles et la mention SIMULÉ.
- Un fichier avec une erreur ne peut pas être enregistré. Un fichier avec seulement des avertissements exige l'acceptation.
- Retirer puis réimporter un fichier fonctionne, et chaque étape apparaît dans le journal.
- Une tentative de modifier un `AuditEvent` en base échoue.
- Vérification manuelle par le fondateur avec le tableau S2 réel de Leslie 2022.

## 9. Découpage en sous-projets (ordre d'exécution)

| Sous-projet | Contenu |
|---|---|
| **C1 — moteur** | `engine/` : FastAPI, contrat §3, sérialisation de B1, tests ; image Docker |
| **C2 — socle web** | `web/` : Next.js, Prisma (schéma §4, migrations, déclencheur d'audit), Auth.js, projets, études, paramètres, journal ; `docker compose` |
| **C2 (tâches 9–12) — multi-laboratoires** | §11 : laboratoires, rôles, invitations, isolation testée, console de la plateforme |
| **C3 — import** | assistant d'import §5, magasin de fichiers, enregistrement transactionnel, retrait, étude d'exemple |
| **C4 — résultats et rapport** | tableau de bord, graphiques, rapport, exports, Playwright de bout en bout |

Chaque sous-projet a son propre plan, ses relectures par tâche et sa relecture finale.

## 10. Modules d'intelligence artificielle (C5–C7) — ajoutés à la demande du fondateur

**Demande du fondateur (2026-10-25) :** « quelque chose de prédiction d'images de microscope et de résultats, et tout ce qui est possible pour un modèle d'IA ». L'équipe technique retient ce qui est scientifiquement défendable avec les données disponibles, et exclut le reste.

### Principes communs (anti-objectifs de l'IA)
- **Aucune prédiction de santé**, de risque individuel ou de diagnostic.
- **Aucune identification de polymère à partir d'une image seule.** L'image donne des *particules candidates* (nombre, taille, forme) ; la composition vient d'une méthode chimique (spectre ou Py-GC/MS).
- **Aucune imputation** de valeur manquante ou censurée par un modèle.
- **Le modèle peut s'abstenir** (« pas de réponse fiable ») quand son score est sous un seuil fixé à l'évaluation.
- **Toute sortie d'IA est une proposition** à valider par une personne compétente. Elle est affichée comme telle, avec le score, la version du modèle et ses limites, et elle n'est jamais enregistrée comme mesure sans validation humaine explicite.
- **Chaque modèle a une fiche** (*model card*) versionnée : données d'entraînement et licences, protocole d'évaluation (séparations sans fuite : par objet, par bibliothèque ou par photo d'origine), métriques, conditions d'échec connues, date et sha256 des poids.
- **L'inférence se fait dans le moteur Python** (nouvelles routes `/ai/...`), sur CPU. Les poids sont stockés hors de Git (`models/`, empreinte sha256 vérifiée au chargement). L'application enregistre chaque prédiction dans une table `ModelPrediction` (§8 du plan initial) : entrée (fichier, sha256), sortie, score, version du modèle, et décision humaine (acceptée, corrigée ou rejetée, par qui, quand).

### C5 — Aide à l'identification spectrale (Raman / FTIR)
- **Entrée :** un spectre déposé (CSV/TXT à deux colonnes, ou un des formats déjà lus par le chantier A), la technique et le laser si Raman en nm.
- **Sortie :**
  - les 3 polymères les plus probables, avec un score ;
  - les 5 spectres de référence les plus proches (bibliothèque, identifiant), superposés au spectre déposé dans un graphique ;
  - un statut `identifié | incertain | non identifié (abstention)`.
- **Modèle :** le pipeline du chantier A (prétraitement, corrélation sur la fenêtre diagnostique, PCA+SVM), réentraîné sur le catalogue complet. Les seuils d'abstention sont choisis sur la validation par bibliothèque.
- **Données :** les 7 bibliothèques publiques déjà cataloguées (licences dans `datasets/SOURCES.md`). **À ajouter :** une classe « non plastique » (cellulose, protéines, minéraux, fond) à partir des cartes RaMPI et de bibliothèques publiques à identifier.
- **Limite affichée :** le modèle n'a pas vu de particules extraites de sang ; ses performances sur ce cas sont inconnues.

### C6 — Analyse d'images de microscopie
- **Entrée :** une image (PNG/JPEG/TIFF) de filtre ou de lame, avec son échelle (µm par pixel), saisie ou lue dans les métadonnées (TIFF MEB).
- **Sortie :**
  - le contour de chaque **particule candidate** (segmentation d'instances) ;
  - le nombre de particules ;
  - pour chaque particule : taille (diamètre de Feret, aire), forme (`fibre | fragment | bille | film`) avec un score ;
  - la distribution des tailles ;
  - l'image annotée, téléchargeable ;
  - le résultat exportable vers une étude comme données de **comptage de particules candidates**, distinctes des mesures confirmées.
- **Modèles :**
  - segmentation : Mask R-CNN de `torchvision` (licence BSD) ;
  - forme : un classifieur sur des descripteurs géométriques (allongement, circularité, solidité), règles de référence comprises.
  - Les modèles sous licence AGPL (par exemple YOLO d'Ultralytics) sont **exclus**, pour ne pas contraindre la licence de MicroTrace.
- **Données :**
  - le jeu MEB `datasets/Images/dataset3` : 237 images, masques d'instances, billes, fibres et fragments ;
  - le jeu Roboflow (177 photos d'origine, une seule classe). Ses licences sont **à retrouver** avant tout usage commercial ; en attendant, il sert à la recherche interne.
  - Évaluation séparée par photo d'origine (aucune photo augmentée des deux côtés).
- **Limites affichées :** entraîné sur des images MEB et d'un seul type de microscopie optique. Sur un autre microscope, il faut une recalibration, avec quelques images annotées par le laboratoire. Une particule sous la résolution de l'image n'est pas vue.

### C7 — Assistant qualité des résultats
- **Entrée :** les mesures enregistrées d'une étude.
- **Sortie :** des **signaux**, pas des verdicts, chacun expliqué :
  - **discordance entre aliquotes** d'un même échantillon (écart relatif au-delà d'un seuil documenté) ;
  - **valeur proche des blancs** (moins de 3 fois la moyenne des blancs de procédure pour ce polymère, quand des contrôles qualité résumés existent) ;
  - **valeur atypique** dans l'étude, par polymère, méthode et matrice (écart robuste à la médiane, au-delà de 3,5 écarts absolus médians) ;
  - **taux de valeurs < LOD inhabituel** par lot ou par date d'analyse.
- **Méthode :** statistiques robustes et règles documentées, pas un réseau de neurones : avec quelques dizaines d'échantillons, un modèle appris ne serait pas fiable. Les règles vivent dans B1 (Python), avec leurs tests.
- **Non retenu :** prédire une concentration ou un effet sanitaire à partir de covariables (pas de données, risque de sur-interprétation).

### Cycle de vie des modèles — décision du fondateur du 2026-10-30

**Demande du fondateur :** « les modèles seront juste pour le test chez les labos, et après, en production, les données des labos servent à réentraîner les modèles ».

- **Phase d'essai (prototype proposé aux laboratoires).** Les modèles C5 et C6 et les règles C7 sont présentés comme des **versions d'essai** : un badge « Modèle d'essai » à côté de chaque sortie, avec la version, la fiche du modèle et la phrase « entraîné sur des données publiques, pas encore sur les vôtres ». Aucune donnée d'un laboratoire ne sert à entraîner quoi que ce soit pendant cette phase.
- **Production : réentraînement avec les données des laboratoires**, à ces conditions :
  - **consentement explicite par laboratoire** (opt-in), donné par un `lab_admin`, daté, révocable, et journalisé ; sans lui, les données du laboratoire n'entrent dans aucun jeu d'entraînement ;
  - **seules les données validées par une personne** servent d'étiquettes : les décisions humaines de `ModelPrediction` (acceptée, corrigée, rejetée) et les mesures confirmées ;
  - **pseudonymisation vérifiée** avant export, et jamais de donnée personnelle ;
  - **aucune donnée brute d'un laboratoire n'est visible par un autre** : seuls les poids du modèle commun sont partagés ; la fiche du modèle liste les laboratoires contributeurs seulement avec leur accord ;
  - **chaque réentraînement produit une nouvelle version** évaluée sur un jeu de test tenu à part (séparé par laboratoire, pour mesurer la généralisation), comparée à la version en service, et déployée seulement si elle est meilleure, avec une fiche mise à jour ; retour arrière possible ;
  - la révocation du consentement retire les données du laboratoire des **prochains** entraînements.
- **Cadre légal et contractuel** : la loi algérienne 18-07 (consentement, déclaration à l'ANPDP) et le contrat avec chaque laboratoire (clause d'utilisation des données pour l'amélioration des modèles) doivent être validés avec un juriste **avant** tout réentraînement.
- **Préparation dès le prototype** : la table `ModelPrediction` garde déjà la décision humaine ; C5 ajoute le réglage de consentement du laboratoire (désactivé par défaut) et l'export des données consenties ; le pipeline de réentraînement lui-même est un sous-projet de production, après les essais.

### Ordre et dépendances
C5, C6 et C7 viennent **après C4** : ils ont besoin des écrans d'étude et de la table `ModelPrediction`. Ordre : **C7** (le plus rapide, sans entraînement), puis **C5** (données prêtes), puis **C6** (entraînement le plus long). Chacun a sa conception détaillée, son plan, ses relectures et une **fiche de modèle relue** avant d'être affiché aux chercheurs.

## 11. Multi-laboratoires (SaaS) — décision du fondateur du 2026-10-26

**Intention.** MicroTrace Studio est un SaaS vendu à plusieurs laboratoires, comme SellWasl l'est à plusieurs entreprises. Il est multi-laboratoires dès le prototype. Ordre voulu par le fondateur :
1. le rendre fonctionnel avec les données existantes ;
2. le proposer aux laboratoires ;
3. améliorer les modèles avec leurs données réelles.

**Modèle de données** (ajouts au §4) :
- `Laboratory` : nom, `slug` unique (utilisé dans les adresses), date de création, `suspendedAt` facultatif.
- `Membership` : utilisateur, laboratoire, rôle (`lab_admin | researcher | viewer`), date ; unique par (utilisateur, laboratoire). Un utilisateur peut appartenir à plusieurs laboratoires.
- `Invitation` : laboratoire, e-mail, rôle, empreinte SHA-256 du jeton (jamais le jeton en clair), auteur, expiration (7 jours), date d'utilisation, date de révocation.
- `User.isPlatformAdmin` : équipe MicroTrace.
- `laboratoryId` obligatoire sur `Project` et `Study`, et facultatif sur `AuditEvent` (vide pour les événements de la plateforme). Les autres tables sont rattachées par l'étude.

**Isolation (règle non négociable).**
- Chaque service serveur reçoit un contexte de laboratoire vérifié : `LabContext { userId, laboratoryId, role }`, obtenu par `requireLab(labSlug, rôleMinimum)`. Ce contexte relit l'appartenance et le statut du laboratoire en base à chaque requête.
- Toute lecture et toute écriture filtrent sur `laboratoryId`.
- Un identifiant d'un autre laboratoire répond « introuvable », jamais « interdit », pour ne pas révéler son existence.
- Une suite de tests d'isolation prouve, pour **chaque** service, qu'un membre du laboratoire A ne lit ni ne modifie rien du laboratoire B.
- La sécurité au niveau des lignes de PostgreSQL (RLS) est un durcissement prévu avant l'hébergement de données réelles. Dans le prototype, l'isolation est applicative et testée.

**Rôles.**

| Rôle | Peut |
|---|---|
| `viewer` | tout lire dans son laboratoire |
| `researcher` | + créer et modifier projets, études, paramètres, imports ; archiver |
| `lab_admin` | + inviter, changer les rôles et retirer des membres de son laboratoire |

Une écriture refusée pour le rôle affiche « Action réservée aux chercheurs du laboratoire. ». Une action de gestion des membres refusée affiche « Action réservée aux responsables du laboratoire. ».

**Invitations.** Le responsable crée une invitation (e-mail, rôle). Le prototype n'envoie pas d'e-mail : il affiche un lien à usage unique à copier, valable 7 jours. La page `/invitation/[jeton]` permet de créer son compte (nom et mot de passe) ou, si l'on est déjà connecté avec cet e-mail, de rejoindre le laboratoire. Une invitation utilisée, expirée ou révoquée affiche « Invitation invalide ou expirée. ».

**Console de la plateforme** (`/admin`, `isPlatformAdmin` seulement) :
- liste des laboratoires avec leurs compteurs : membres, études, imports ;
- création d'un laboratoire et de l'invitation de son premier responsable ;
- suspension et réactivation : les membres d'un laboratoire suspendu voient « Laboratoire suspendu. ».

L'administrateur de la plateforme **ne voit pas** les données scientifiques des laboratoires, seulement ces compteurs. Le premier administrateur est créé par `npm run user:create -- --platform-admin`.

**Adresses et navigation.** Les pages d'un laboratoire vivent sous `/labo/[labSlug]/…`, par exemple `/labo/[labSlug]/projets` et `/labo/[labSlug]/etudes/[studyId]/parametres`. Un sélecteur de laboratoire figure dans l'en-tête quand l'utilisateur en a plusieurs. `/` mène :
- au premier laboratoire de l'utilisateur ;
- sinon à `/admin` pour un administrateur de la plateforme ;
- sinon à une page « Vous n'êtes membre d'aucun laboratoire. ».

**Hors prototype :** inscription libre, facturation, envoi d'e-mails, authentification unique (SSO). L'hébergement en ligne et le pays d'hébergement (loi algérienne 18-07 sur les données personnelles) seront présentés au fondateur après C4.

**Données existantes (fonctionnel dès C3).** Chaque laboratoire peut créer deux études d'exemple :
- l'étude fictive (`simulated`, §6) ;
- l'étude **réelle publiée** Leslie et al. 2022, Tableau S2 : 22 donneurs, `published`, DOI 10.1016/j.envint.2022.107199, licence à confirmer sur la page de l'article avant d'en embarquer les valeurs.
