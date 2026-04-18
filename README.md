# Comstruct

Comstruct now includes a procurement-first MVP for importing supplier CSVs into a curated C-material catalog.

## Stack

- React + Vite + TypeScript frontend in `apps/web`
- Express + TypeScript backend in `apps/api`
- Shared runtime types in `packages/shared`
- Supabase as the database backend

## Included in this slice

- Procurement workspace with `Imports` and `Catalog`
- CSV upload for `sample.csv`
- Mapping preview before import confirmation
- Supabase-backed draft imports, raw rows, normalized products, and supplier mappings
- Catalog cleanup UI for names, categories, price, C-material flag, and publication status

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the API env template and fill in your Supabase credentials:

   ```bash
   copy apps\api\.env.example apps\api\.env
   ```

3. Apply all SQL files in `supabase/migrations` to your Supabase database in filename order.
   `20260418_procurement_catalog_cleanup.sql` bootstraps the catalog schema, and `20260418_add_procurement_orders.sql` is required for the Orders workspace.

4. Start both apps:

   ```bash
   npm run dev
   ```

5. Open:
   - Frontend: `http://localhost:5173`
   - API: `http://localhost:4000`

## Monorepo layout

```text
apps/
  api/
  web/
packages/
  shared/
supabase/
  migrations/
```
