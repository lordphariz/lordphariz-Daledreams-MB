# Daledreams Record Book

A mobile-friendly customer, measurement, and bookkeeping app served by a Cloudflare Worker and persisted in Cloudflare D1.

## Requirements

- Node.js and npm
- A Cloudflare account with Workers and D1 enabled

## Create and configure D1

Install the project dependencies:

```sh
npm install
```

Authenticate Wrangler and create the database:

```sh
npm exec wrangler login
```

```sh
npm run d1:create
```

Copy the returned database ID into `database_id` in `wrangler.toml`.

Apply the initial schema locally and remotely:

```sh
npm run d1:migrate:local
npm run d1:migrate:remote
```

## Run and deploy

Deploy once to create the Worker, then add a custom domain to it in Cloudflare. Protect that hostname with a Cloudflare Access self-hosted application. Copy the Access team domain and the app's AUD tag into `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.toml`, then deploy again. Until configured, the Worker fails closed and the API returns `503`. The Worker verifies the Access JWT signature, issuer, audience, and expiry for every API request, so the `workers.dev` URL cannot bypass API authentication. Disable the `workers.dev` route too if you want the static app itself to be private. Local Wrangler requests on localhost are allowed for development.

```sh
npm run dev
```

Open the local URL Wrangler prints. To publish the app and API:

```sh
npm run deploy
```

The Worker serves the static app and the `/api` endpoints on the same origin. Customer and transaction data are stored in the bound D1 database; no browser-only or in-memory persistence is used.

## Data API

- `GET /api/customers`, `POST /api/customers`
- `PUT /api/customers/:id`, `DELETE /api/customers/:id`
- `GET /api/transactions`, `POST /api/transactions`
- `DELETE /api/transactions/:id`

The API validates input, uses parameterized D1 queries, and returns JSON errors for invalid or failed requests.
