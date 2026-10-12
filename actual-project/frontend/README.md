# Radar Pantai Frontend

Mobile-first frontend built with React, Vite and TypeScript.

Requires Node.js 20.19 or newer.

## Run locally

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`.

The frontend uses built-in mock data when `VITE_API_BASE_URL` is empty.

## API connection

```bash
cp .env.example .env
```

Set the API base URL when a compatible API is available:

```env
VITE_API_BASE_URL=http://localhost:5000
```

The frontend development server uses port `5173`. The API port is not
hard-coded; it is read from `VITE_API_BASE_URL`.

Every real HTTP request used by `src/api.ts` is documented in `API.md` and
`openapi.yaml`. The contract contains 13 paths and 14 operations.

## Commands

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm run preview
```

The production build is written to `dist/`.
