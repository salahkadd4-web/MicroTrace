# Démarrer MicroTrace Studio (guide pas à pas, Windows)

Ce guide installe l'application complète sur votre ordinateur : application web, moteur de calcul et base de données, le tout dans Docker. Rien n'est accessible depuis le réseau : seule votre machine peut ouvrir l'application (`http://localhost:3000`).

## 1. Prérequis

- **Docker Desktop** pour Windows, installé et **démarré** (l'icône de la baleine doit être visible près de l'horloge, sans message d'erreur).
- **Node.js 24** (uniquement pour générer les secrets et pour le mode développement).
- Ouvrez **PowerShell** dans le dossier du projet (`MicroTrace`) : dans l'Explorateur, clic droit dans le dossier, « Ouvrir dans le Terminal ».

## 2. Générer les secrets (une seule fois)

```powershell
node scripts/generate-secrets.mjs
```

Cela crée le fichier `.env` avec trois secrets aléatoires. Le script refuse d'écraser un `.env` existant (ajoutez `--force` seulement si vous voulez tout régénérer ; la base existante ne s'ouvrira alors plus, voir « Repartir de zéro », section 10).

## 3. Démarrer

```powershell
docker compose up -d --build
```

La première fois, comptez plusieurs minutes (téléchargements et construction). Les migrations de la base sont appliquées automatiquement par le service `migrate` avant le démarrage de l'application. Vérifiez que tout est « healthy » :

```powershell
docker compose ps
```

## 4. Créer le premier administrateur de la plateforme

```powershell
docker compose run --rm tools npm run user:create -- --email vous@exemple.fr --name "Votre Nom" --platform-admin
```

Le mot de passe vous est demandé deux fois (il ne s'affiche pas). Prenez un mot de passe long et unique.

## 5. Ouvrir l'application et créer un laboratoire

1. Ouvrez <http://localhost:3000> et connectez-vous.
2. Vous arrivez sur la **Console de la plateforme** : créez un laboratoire (nom, puis adresse e-mail de son responsable).
3. L'application affiche alors un **lien d'invitation** : copiez-le et transmettez-le au responsable du laboratoire (il le lui faut pour créer son mot de passe ; aucun e-mail n'est envoyé).

### Télécharger un rapport ou les mesures

Les fichiers arrivent dans le dossier **Téléchargements** de votre navigateur, nommés `rapport-<titre>-<date>.html` (ou `.md`), `mesures-<titre>-<date>.csv` et `dictionnaire-donnees.csv` (ou `.md`).

Dans l'onglet **Rapport** d'une étude, vous pouvez télécharger le rapport (HTML ou Markdown), le CSV des mesures actives et le dictionnaire de données. Pour ouvrir le CSV dans Excel : **Données > À partir d'un fichier texte/CSV**, choisissez le séparateur « ; » et le séparateur décimal « . » (les valeurs sont écrites telles qu'enregistrées, avec un point). Le CSV porte une colonne `data_nature` (`laboratory`, `published` ou `simulated`) avant la colonne `import` ; pour une étude simulée, le nom du fichier commence par `SIMULE-`.

## 6. Arrêter et redémarrer

```powershell
docker compose stop        # arrêt (les données sont conservées)
docker compose start       # redémarrage
docker compose down        # supprime les conteneurs, garde les données
docker compose up -d       # recrée et démarre (ajoutez --build après une mise à jour du code)
```

Après une mise à jour du code : `docker compose up -d --build` (les nouvelles migrations sont appliquées toutes seules).

## 7. Où sont les données ?

Dans deux **volumes Docker**, qui survivent à `docker compose down` et aux redémarrages :

- `microtrace_db-data` : la base PostgreSQL ;
- `microtrace_files-data` : les fichiers de données téléversés (dossier `/app/var` du service `web`).

## 8. Sauvegarder

Sauvegardez régulièrement, et copiez les fichiers obtenus ailleurs que sur cet ordinateur (disque externe, serveur de l'établissement). Les commandes ci-dessous fonctionnent dans PowerShell, à la racine du projet.

**La base de données** (comptes, laboratoires, études, journal) :

```powershell
docker compose exec -T db pg_dump -U microtrace -Fc -f /tmp/sauvegarde.dump microtrace
docker compose cp db:/tmp/sauvegarde.dump .\sauvegarde.dump
```

**Les fichiers téléversés** (à faire en plus, dès que vous importez des fichiers de données) :

```powershell
docker compose cp web:/app/var/files .\fichiers
```

(Le dossier `fichiers` ne doit pas déjà exister ; sinon supprimez-le ou renommez-le d'abord. On ne sauvegarde que `/app/var/files` : les dépôts temporaires de `/app/var/staging` sont purgés au bout de 24 h et ne servent à rien dans une sauvegarde.)

N'utilisez pas `pg_dump … > fichier` dans PowerShell : la redirection `>` écrit en UTF-16 et abîme les accents, la sauvegarde serait inutilisable.

## 9. Restaurer une sauvegarde

**Attention : la restauration REMPLACE les données actuelles par celles de la sauvegarde.** Tout ce qui a été saisi depuis la sauvegarde est perdu. L'application doit être démarrée (`docker compose up -d`).

```powershell
docker compose cp .\sauvegarde.dump db:/tmp/sauvegarde.dump
docker compose exec -T db pg_restore -U microtrace -d microtrace --clean --if-exists /tmp/sauvegarde.dump
```

Pour restaurer sur une installation neuve, faites d'abord les étapes 2 et 3 avec le **même** `.env` que lors de la sauvegarde (le mot de passe de la base est dans ce fichier : conservez-le avec vos sauvegardes). Des messages d'avertissement sur des objets « inexistants » en début de restauration sont normaux.

Les fichiers téléversés se remettent en place avec `docker compose cp .\fichiers\. web:/app/var/files`, puis `docker compose exec -u root web chown -R web:web /app/var/files`.

## 10. Repartir de zéro (efface TOUTES les données)

```powershell
docker compose down -v
```

Relancez ensuite les étapes 3 et 4. Si vous avez régénéré `.env` avec `--force`, cette commande est nécessaire (le mot de passe de la base a changé).

## 11. Mode développement

La base et le moteur tournent dans Docker, l'application web tourne sur votre machine avec rechargement automatique. Le fichier `docker-compose.dev.yml` (déjà fourni) publie la base et le moteur, uniquement sur votre PC :

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db engine
cd web
copy .env.example .env.local
npm install
npm run db:migrate
npm run dev
```

**Attention : votre PC a déjà un PostgreSQL Windows sur le port 5432. Ne le touchez pas.** La base Docker est donc publiée sur le port **5433**.

Renseignez ces valeurs dans `web/.env.local` (lu avant `web/.env` ; les valeurs de `.env.local` l'emportent) :

- `DATABASE_URL=postgresql://microtrace:<POSTGRES_PASSWORD>@localhost:5433/microtrace` (le mot de passe est dans le `.env` de la racine)
- `ENGINE_URL=http://localhost:8001`
- `ENGINE_SECRET` et `AUTH_SECRET` : mêmes valeurs que dans le `.env` de la racine

Le premier administrateur se crée avec `npm run user:create -- --email … --name … --platform-admin`. Pour arrêter : `docker compose -f docker-compose.yml -f docker-compose.dev.yml down`.

### Tests de bout en bout (Playwright)

Ces tests ouvrent un vrai navigateur et vérifient les parcours complets : étude d'exemple fictive et réelle (Leslie 2022), fichier en erreur, isolation entre laboratoires. Ils démarrent tout seuls leur propre base, le moteur et l'application (sur des ports libres) et suppriment tout à la fin : **Docker n'est pas nécessaire**, et votre base de développement n'est pas touchée.

```powershell
cd web
npx playwright install chromium   # une seule fois
npm run e2e
```

Il faut que l'environnement Python du dépôt (`.venv`) existe, avec le moteur installé. Comptez environ trois minutes (l'application est compilée dans un dossier séparé, `.next-e2e`, supprimé à la fin).

## Installer le modèle spectral

L'onglet Spectres a besoin des poids du modèle, qui ne sont **jamais dans Git** (dossier `models/`, ignoré). L'empreinte attendue est dans le dépôt (`engine/src/microtrace_engine/spectral_model.lock.json`) : le moteur refuse tout fichier dont le sha256 ne correspond pas.

**Chemin recommandé : copier les poids.** Prenez le fichier `models/c5-spectral-s1.npz` de la machine de référence, copiez-le dans le dossier `models/` de cette machine, puis vérifiez son empreinte :

```powershell
Get-FileHash models/c5-spectral-s1.npz -Algorithm SHA256   # doit afficher le sha256 du fichier .lock.json
.venv/Scripts/python -m microtrace_core train-spectral --catalog data/processed/spectra_catalog.parquet `
  --baseline reports/baseline/metrics.json --models models --manifest docs/models/c5-spectral-manifest.json `
  --data-list docs/models/c5-spectral-s1-data.sha256 --lock engine/src/microtrace_engine/spectral_model.lock.json `
  --card docs/models/c5-spectral.md --check
```

Le code de sortie de `--check` doit être 0 (voir plus bas ce qu'il demande). Redémarrez ensuite le moteur : il ne recharge pas les poids à chaud.

**Réentraîner (seulement si c'est voulu).** Il faut les jeux de données dans `datasets/`, l'extra d'entraînement (scikit-learn) et le catalogue, qui est ignoré par Git et que l'entraînement ne reconstruit pas :

```powershell
.venv/Scripts/python -m pip install -e "core[train]"
.venv/Scripts/python -m microtrace_core build-catalog --datasets datasets --out data/processed/spectra_catalog.parquet
```

Lancez d'abord la commande de vérification ci-dessus (avec `--check`) : elle réentraîne en mémoire (environ une minute et demie) et compare l'empreinte aux fichiers versionnés, sans rien écrire. Sur une autre machine, l'empreinte peut différer (calcul numérique dépendant de la plateforme) ; dans ce cas, préférez copier les poids de la machine de référence.

**Attention : sans `--check`, la même commande écrit les poids et réécrit les fichiers versionnés** (verrou, manifeste, liste des données et fiche du modèle). N'y recourez que pour un réentraînement voulu, puis relisez `git diff` et ne committez que si c'est intentionnel. Après un réentraînement, **redémarrez le moteur**.

## 12. Mise en production

- Définissez **`APP_URL`** dans `.env` avec l'adresse publique réelle (par exemple `https://labo.exemple.fr`, sans barre finale). Elle sert aux liens d'invitation et à la redirection après connexion. **Elle est obligatoire en production.**
- Placez l'application derrière un reverse proxy HTTPS (le port reste lié à `127.0.0.1`).
- Prototype de recherche, pas un dispositif médical.

## 13. Sécurité

- **Ne partagez jamais le fichier `.env`** (ni par e-mail, ni dans un dépôt, ni en capture d'écran) : il contient les mots de passe de la base et du moteur et la clé des sessions. Il est exclu de Git.
- La base de données et le moteur ne sont pas joignables depuis l'extérieur ; seule l'application l'est, et uniquement depuis votre ordinateur.
- En cas de doute sur une fuite : `node scripts/generate-secrets.mjs --force`, puis « Repartir de zéro » si vous n'avez pas de données à garder (sinon, demandez de l'aide pour changer le mot de passe de la base).
