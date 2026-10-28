# Daledreams Record Book

A mobile-friendly customer, measurement, and bookkeeping app built for Vercel. The frontend is served from `public/`; API endpoints run as Vercel Functions and store data in PostgreSQL.

## Set up the database

1. Create a PostgreSQL database using the Neon integration in the Vercel Marketplace, or use an existing Neon database.
2. In the Vercel project settings, add the database connection string as the `DATABASE_URL` environment variable for Development, Preview, and Production.
3. Run the SQL in [`database/schema.sql`](./database/schema.sql) once in the database's SQL editor.

## Run locally

```sh
npm install
```

Link the local Vercel CLI to your Vercel project and pull its environment variables before starting local development:

```sh
npx vercel link
npx vercel env pull .env.local
npm run dev
```

Alternatively, create `.env.local` with `DATABASE_URL=your-postgres-connection-string`. Do not commit environment files.

## Deploy

Import this repository into Vercel. Vercel serves the static site and deploys the files under `api/` as serverless functions. Add `DATABASE_URL` to the project's environment variables and deploy.

## API

- `GET /api/customers`, `POST /api/customers`
- `PUT /api/customers/:id`, `DELETE /api/customers/:id`
- `GET /api/transactions`, `POST /api/transactions`
- `DELETE /api/transactions/:id`

The API validates incoming data and uses parameterized PostgreSQL queries.
