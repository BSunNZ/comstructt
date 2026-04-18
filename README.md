# Comstruct

Comstruct is a full-stack starter for a web application plus backend API focused on CSV uploads and data processing.

## Stack

- React + Vite + TypeScript frontend in `apps/web`
- Express + TypeScript backend in `apps/api`
- Shared TypeScript types in `packages/shared`

## What is included

- CSV upload UI
- API endpoint for multipart CSV upload
- CSV parsing with a row preview response
- Shared upload result types between frontend and backend

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start both apps:

   ```bash
   npm run dev
   ```

3. Open:
   - Frontend: `http://localhost:5173`
   - API: `http://localhost:4000`

## Monorepo layout

```text
apps/
  api/
  web/
packages/
  shared/
```

## Next build steps

- Add persistent storage for uploaded files and parsed records
- Add authentication and user accounts
- Add validation rules for CSV schemas
- Add background processing for large uploads
- Add tests and CI

