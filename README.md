# Note-Taking App

A minimalist notes app with a Docs-style editor, reusable `#tags`, autosave, and Supabase sync.

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

## Supabase setup

Run the SQL in `supabase/setup.sql` inside the Supabase SQL Editor, then enable Anonymous sign-ins in Supabase Auth.

## GitHub Pages deployment

This app is configured for GitHub Pages under the `Note-Taking-App` repository path.

1. Push this code to the `main` branch of `https://github.com/abhisheknitj2/Note-Taking-App`.
2. In GitHub, open `Settings > Pages`.
3. Set `Source` to `GitHub Actions`.
4. Every push to `main` will build and deploy automatically.
