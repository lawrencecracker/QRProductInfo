# Vera — QR Product Intelligence

A QR-code based product intelligence platform. Consumers scan a product QR, see full traceability (batch, origin, ingredients, nutrition, sustainability), ask an AI assistant questions, leave star + photo + voice reviews and receive an incentive coupon. Manufacturers sign in to a multi-tenant insights dashboard, publish products through an admin UI, and own the consumer relationship.

## Highlights

- **Consumer app** — camera scanner, paste-QR fallback, four-tab product page (Overview / Nutrition / Ask AI / Review), PDF export, native share, dark/light/auto theme.
- **AI assistant** — Google Gemini (`gemini-2.5-flash`) grounded on the product context, with a graceful rule-based fallback when no key is configured.
- **Insights dashboard** — rating distribution, sentiment mix, buy-again rate, recent reviews per product. Scoped per manufacturer.
- **Manufacturer accounts** — JWT auth (bcrypt + PyJWT), multi-tenant scoping, full product CRUD admin UI.
- **Open Food Facts fallback** — scanning a generic EAN/UPC barcode resolves to a normalized product via Open Food Facts (cached in MongoDB).
- **QR payload format** — non-redirect `QRCONNECT:v1;id=…` / `…;batch=…` / `…;barcode=…` so the app works offline-first.

## Tech stack

| Layer    | Tech                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| Frontend | React 19, CRA + Craco, TailwindCSS, lucide-react, recharts, html5-qrcode, jspdf |
| Backend  | FastAPI, Motor (async MongoDB), PyJWT, bcrypt, google-generativeai, httpx     |
| Storage  | MongoDB                                                                       |

A single Python process answers both `/api/*` and the React app from the same origin (the build output is copied next to the backend during `npm run build`).

## Quick start (one process)

Prerequisites: Node ≥ 18, Python ≥ 3.11, MongoDB (local or Atlas).

```bash
# 1. Install everything (frontend + backend) and build the React bundle
npm install
npm run build

# 2. Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env: set MONGO_URL and optionally GEMINI_API_KEY / JWT_SECRET

# 3. Start the server (serves the API and the React app on the same port)
npm start
```

The app is now at <http://localhost:8001>. Demo manufacturer account (seeded automatically): `demo@vera.app` / `demo1234`.

### Development mode (hot reload, two processes)

```bash
# terminal A
npm run dev:backend       # FastAPI on :8001 with --reload

# terminal B
npm run dev:frontend      # CRA dev server on :3000 (proxies /api → :8001)
```

Set `REACT_APP_BACKEND_URL=http://localhost:8001` in `frontend/.env` for the dev server.

## Deployment

The repo is intentionally platform-neutral. Any host that can run a Node build step then a Python process will work.

| Step          | Command                                                              |
| ------------- | -------------------------------------------------------------------- |
| Build         | `npm install && npm run build`                                       |
| Start         | `npm start`                                                          |
| Listens on    | `$PORT` (falls back to `8001`)                                       |

Env vars to configure on the host:

| Variable                | Required | Purpose                                             |
| ----------------------- | -------- | --------------------------------------------------- |
| `MONGO_URL`             | ✅       | MongoDB connection string (Atlas SRV URI works)     |
| `DB_NAME`               | optional | Defaults to `qr_product_insights`                   |
| `JWT_SECRET`            | ✅       | Strong random string used to sign manufacturer JWTs |
| `CORS_ORIGINS`          | optional | Comma-separated origins; `*` by default             |
| `GEMINI_API_KEY`        | optional | Enables AI assistant (rule-based fallback otherwise)|
| `GEMINI_MODEL`          | optional | Defaults to `gemini-2.5-flash`                      |
| `SERVE_FRONTEND`        | optional | `auto` (default), `true`, or `false`                |

> **Storage note:** voice and photo feedback are written to `backend/uploads/`. On hosts with ephemeral disk those files vanish on restart. The feedback **records** stay safe in MongoDB; only the uploaded media is at risk. For production, swap `_save_upload` in `server.py` for S3 / Cloudinary.

## API surface

All endpoints are mounted under `/api`.

### Public (no auth)

| Method | Path                          | Purpose                                                  |
| ------ | ----------------------------- | -------------------------------------------------------- |
| GET    | `/api/health`                 | Health check                                             |
| GET    | `/api/products`               | Public product list (id, name, brand, category, image)   |
| GET    | `/api/product`                | Lookup by `productId` / `batchId` / `barcode`            |
| GET    | `/api/product/barcode/{ean}`  | Open Food Facts fallback by EAN/UPC                      |
| GET    | `/api/qr/{productId}`         | Returns `imageDataUrl` & `payload`; `?format=png` for PNG|
| POST   | `/api/feedback`               | Multipart: ratings, comment, photo, voice, contact email |
| GET    | `/api/dashboard/{productId}`  | Aggregated insights for one product                      |
| POST   | `/api/chat`                   | Gemini-powered product Q&A (rule-based fallback)         |

### Authenticated (Bearer JWT)

| Method | Path                                | Purpose                                            |
| ------ | ----------------------------------- | -------------------------------------------------- |
| POST   | `/api/auth/register`                | Create a manufacturer account                      |
| POST   | `/api/auth/login`                   | Returns `{ token, manufacturer }`                  |
| GET    | `/api/auth/me`                      | Current manufacturer                               |
| GET    | `/api/admin/products`               | Products owned by the caller                       |
| POST   | `/api/admin/products`               | Create product                                     |
| PUT    | `/api/admin/products/{id}`          | Update product (403 cross-tenant)                  |
| DELETE | `/api/admin/products/{id}`          | Delete product (403 cross-tenant)                  |

## QR payload format

```
QRCONNECT:v1;id=prod_001
QRCONNECT:v1;batch=BATCH-2024-0315
QRCONNECT:v1;barcode=737628064502
```

The frontend also accepts plain product IDs, batch IDs, raw EAN barcodes, and `https://…?productId=…&batchId=…` URLs for deep links.

## License

MIT — see [LICENSE](./LICENSE).
