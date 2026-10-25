# MicroTrace engine

Service FastAPI local qui expose `microtrace_core.results` (lecture de tableaux, suggestion de
correspondance, contrôle d'import, synthèse, rapport, dictionnaire de données) à l'application
Next.js, via localhost et un secret partagé. Il ne réimplémente aucune règle : il appelle le cœur.

## Installation locale

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -e core -e engine      # Linux/macOS : .venv/bin/python
.venv/Scripts/python -m pip install -e "engine[dev]"       # pour les tests
```

## Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `ENGINE_SECRET` | secret partagé, **obligatoire**, au moins 32 caractères | aucun (le service refuse de démarrer) |
| `ENGINE_HOST` | adresse d'écoute | `127.0.0.1` |
| `ENGINE_PORT` | port d'écoute | `8001` |

## Lancement

```bash
export ENGINE_SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
.venv/Scripts/python -m microtrace_engine
```

Exemple d'appel (chaque route sauf `/health` exige l'en-tête `X-Engine-Secret`) :

```bash
curl http://127.0.0.1:8001/health
curl -H "X-Engine-Secret: $ENGINE_SECRET" http://127.0.0.1:8001/dictionary
curl -H "X-Engine-Secret: $ENGINE_SECRET" -F "file=@mesures.csv" http://127.0.0.1:8001/tables/read
```

## Docker

Le contexte de build est la racine du dépôt :

```bash
docker build -f engine/Dockerfile -t microtrace-engine .
docker run --rm -e ENGINE_SECRET="<au moins 32 caractères>" \
  -p 127.0.0.1:8001:8001 microtrace-engine
```

Dans le conteneur le service écoute sur `0.0.0.0` : **publiez toujours le port sur
`127.0.0.1` uniquement** (`-p 127.0.0.1:8001:8001`). L'image tourne avec un utilisateur non root
et ne contient aucun secret.

## Routes

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/health` | versions (API, moteur, règles) ; sans secret, rien de sensible |
| GET | `/openapi.json` | schéma OpenAPI (secret requis) |
| POST | `/tables/read` | lecture d'un CSV/XLSX : feuilles, colonnes, aperçu, empreinte SHA-256 |
| POST | `/mapping/suggest` | correspondance de colonnes suggérée |
| POST | `/imports/check` | contrôle d'import, avec cohérence entre imports (`existing`) |
| POST | `/summary` | agrégation des aliquotes, fréquences de quantification, statistiques |
| POST | `/report` | rapport en Markdown et HTML |
| GET | `/dictionary` | dictionnaire de données (CSV et Markdown) |
| GET | `/examples/leslie-like` | jeu d'exemple synthétique avec contexte et correspondance |

## Garanties de confidentialité

- Le service est sans état : aucun fichier ni donnée n'est écrit sur disque ni conservé.
- Aucune valeur de cellule dans les journaux ni dans les réponses d'erreur ; une exception
  inattendue renvoie `500 {"detail": "Erreur interne du moteur."}` et seul le type
  d'exception et la route sont journalisés (ni message, ni trace de pile).
- Les en-têtes de colonnes ressemblant à des données de contact ou trop longs sont remplacés par
  leur position (« colonne n° k ») ; les fichiers contenant des e-mails ou téléphones sont bloqués
  par le contrôle d'import.
- Comparaison du secret en temps constant ; écoute locale par défaut ; taille des fichiers
  limitée à `MAX_BYTES` du cœur.

## Tests

```bash
.venv/Scripts/python -m pytest engine/tests -q -W error
```
