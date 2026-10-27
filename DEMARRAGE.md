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

Cela crée le fichier `.env` avec trois secrets aléatoires. Le script refuse d'écraser un `.env` existant (ajoutez `--force` seulement si vous voulez tout régénérer ; la base existante ne s'ouvrira alors plus, voir « Repartir de zéro »).

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

## 6. Arrêter et redémarrer

```powershell
docker compose stop        # arrêt (les données sont conservées)
docker compose start       # redémarrage
docker compose down        # supprime les conteneurs, garde les données
docker compose up -d       # recrée et démarre (ajoutez --build après une mise à jour du code)
```

Après une mise à jour du code : `docker compose up -d --build` (les nouvelles migrations sont appliquées toutes seules).

## 7. Où sont les données ?

Dans le **volume Docker** `microtrace_db-data` (la base PostgreSQL). Il survit à `docker compose down` et aux redémarrages. Pour sauvegarder :

```powershell
docker compose exec db pg_dump -U microtrace microtrace > sauvegarde.sql
```

## 8. Repartir de zéro (efface TOUTES les données)

```powershell
docker compose down -v
```

Relancez ensuite les étapes 3 et 4. Si vous avez régénéré `.env` avec `--force`, cette commande est nécessaire (le mot de passe de la base a changé).

## 9. Mode développement

La base et le moteur tournent dans Docker, l'application web tourne sur votre machine avec rechargement automatique. Cela demande de publier temporairement les ports de la base et du moteur sur votre machine : créez un fichier `docker-compose.override.yml` (ignoré par ce guide, à ne pas partager) :

```yaml
services:
  db:
    ports: ["127.0.0.1:5432:5432"]
  engine:
    ports: ["127.0.0.1:8001:8001"]
```

Puis :

```powershell
docker compose up -d db engine
cd web
copy .env.example .env.local     # renseignez DATABASE_URL, ENGINE_URL, ENGINE_SECRET, AUTH_SECRET
npm install
npm run db:migrate
npm run dev
```

Valeurs pour `web/.env.local` : `DATABASE_URL=postgresql://microtrace:<POSTGRES_PASSWORD de .env>@localhost:5432/microtrace`, `ENGINE_URL=http://localhost:8001`, `ENGINE_SECRET` et `AUTH_SECRET` identiques à ceux de `.env`. Le premier administrateur se crée avec `npm run user:create -- --email … --name … --platform-admin`. N'oubliez pas de supprimer le fichier `docker-compose.override.yml` ensuite.

## 10. Mise en production

- Définissez **`APP_URL`** dans `.env` avec l'adresse publique réelle (par exemple `https://labo.exemple.fr`, sans barre finale). Elle sert aux liens d'invitation et à la redirection après connexion. **Elle est obligatoire en production.**
- Placez l'application derrière un reverse proxy HTTPS (le port reste lié à `127.0.0.1`).
- Prototype de recherche, pas un dispositif médical.

## 11. Sécurité

- **Ne partagez jamais le fichier `.env`** (ni par e-mail, ni dans un dépôt, ni en capture d'écran) : il contient les mots de passe de la base et du moteur et la clé des sessions. Il est exclu de Git.
- La base de données et le moteur ne sont pas joignables depuis l'extérieur ; seule l'application l'est, et uniquement depuis votre ordinateur.
- En cas de doute sur une fuite : `node scripts/generate-secrets.mjs --force`, puis « Repartir de zéro » si vous n'avez pas de données à garder (sinon, demandez de l'aide pour changer le mot de passe de la base).
