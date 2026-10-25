# MicroTrace Studio — application web (prototype)

Prototype de recherche, pas un dispositif médical.

Application Next.js (App Router, TypeScript strict, Tailwind v4, shadcn/ui).
Tout le code web vit dans ce dossier ; le moteur scientifique reste dans `engine/`.

## Commandes

```bash
npm install
npm run dev        # serveur de développement
npm run lint
npm run typecheck
npm test           # Vitest
npm run build
```

## Configuration

Copier `.env.example` vers `.env.local` et renseigner `DATABASE_URL`, `ENGINE_URL`,
`ENGINE_SECRET` et `AUTH_SECRET`. Le navigateur ne contacte jamais le moteur :
tout appel passe par du code serveur.

## Conventions

- Thème : uniquement dans `src/app/globals.css` (variables CSS shadcn/ui, dont `--warning`).
- Composants de base : `src/components/ui/` (shadcn/ui). Composants partagés : `src/components/app/`.
- Textes visibles en français ; nombres et dates via `NumberFr` et `DateTimeFr`.
- Aucune règle scientifique en TypeScript : le moteur valide.
