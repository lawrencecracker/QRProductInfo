# QR Product Insights 🌿

**A QR-powered product intelligence and consumer feedback platform.**  
Consumers scan a QR code on packaging to learn about the product, ask an AI assistant questions, leave ratings, and receive incentive coupons. Manufacturers get a real-time analytics dashboard.

---

## Features

### Consumer Side
| Feature | Status |
|---|---|
| QR scan → product landing page | ✅ |
| Barcode lookup via Open Food Facts | ✅ |
| Product info (batch, lot, origin, dates) | ✅ |
| Ingredients & allergen warnings | ✅ |
| Nutritional facts table | ✅ |
| Sustainability + certifications | ✅ |
| Brand story | ✅ |
| Storage instructions | ✅ |
| AI chat assistant (Gemini + rule-based fallback) | ✅ |
| Star ratings (overall, taste, texture, appearance) | ✅ |
| Text feedback + improvements | ✅ |
| Photo upload with feedback | ✅ |
| Would-buy-again toggle | ✅ |
| Incentive coupon on submission | ✅ |
| Product QR codes (payload, not redirect URLs) | ✅ |
| In-app QR scanner | ✅ |
| Auto-load from URL params | ✅ |
| Demo fallback (no QR needed) | ✅ |

### Manufacturer Dashboard
| Feature | Status |
|---|---|
| Total reviews count | ✅ |
| Average rating | ✅ |
| Buy-again percentage | ✅ |
| Sentiment score (positive/neutral/negative) | ✅ |
| Rating distribution bar chart | ✅ |
| Recent reviews list | ✅ |
| Per-product filtering | ✅ |

---

## Project Structure

```
qr-product-insights/
├── server.js          # Express API + SQLite + Gemini + static UI
├── index.html         # Single-file PWA (served by server.js)
├── products.db        # SQLite database (created on first run)
├── uploads/           # Feedback photo/audio uploads
├── package.json
├── .env.example
└── README.md
```

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment (optional)

Copy `.env.example` to `.env` and set your Gemini API key for AI chat:

```bash
# macOS / Linux
cp .env.example .env
export GEMINI_API_KEY=your-key-here

# Windows PowerShell
copy .env.example .env
$env:GEMINI_API_KEY="your-key-here"
```

> Without `GEMINI_API_KEY`, chat uses rule-based answers for common topics (allergens, nutrition, ingredients, storage). The rest of the app works normally.

### 3. Start the server

```bash
npm start
```

The server serves **both** the API and the web UI on **http://localhost:3001**.

> Do not open `index.html` directly from the filesystem (`file://`). Always use the URL above so API calls work.

### 4. Try demo products

Open **http://localhost:3001**, pick a demo product, or use **Scan product QR** on the home screen.

Each product’s **Info** tab shows a printable QR (product data only — not a website link).

**QR payload examples:**

```
QRCONNECT:v1;id=prod_001
QRCONNECT:v1;batch=BATCH-2024-0315
QRCONNECT:v1;barcode=3017620422003
```

Test: paste payload on home, or open `http://localhost:3001?qr=QRCONNECT:v1%3Bid%3Dprod_001`

Legacy `?productId=` / `?barcode=` URLs still work for bookmarks.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Server health check |
| GET | `/api/products` | List all products |
| GET | `/api/product?productId=X` | Get product by ID or batch |
| GET | `/api/product?barcode=X` | Lookup product via Open Food Facts |
| GET | `/api/product/barcode/:barcode` | Same as barcode query param |
| POST | `/api/feedback` | Submit consumer feedback (multipart) |
| GET | `/api/dashboard/:productId` | Analytics for a product |
| GET | `/api/qr/:productId` | QR payload + PNG data URL (`?format=png` for raw image) |
| POST | `/api/chat` | AI chat endpoint |

### POST /api/chat

```json
{
  "productId": "prod_001",
  "messages": [
    { "role": "user", "content": "Is this allergen free?" }
  ]
}
```

### POST /api/feedback (multipart/form-data)

```
product_id, batch_id, overall_rating, taste_rating, texture_rating,
appearance_rating, comment, improvements, would_buy_again,
photo (file, optional), voice (file, optional)
```

---

## Database Schema

### `products`
Core product data: name, brand, batch_id, lot_number, manufactured_date, expiry_date, origin_country, ingredients, allergens, nutritional_info (JSON), sustainability_info, brand_story, storage_instructions, certifications.

### `feedback`
Consumer submissions: ratings (overall, taste, texture, appearance), comment, improvements, would_buy_again, photo_url, voice_url, sentiment_score.

### `incentives`
Coupon codes: type (discount/loyalty/contest), value, expiry, used status.

### `openfoodfacts_cache`
Cached Open Food Facts API responses for barcode lookups.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `GEMINI_API_KEY` | — | Enables Gemini AI chat (`gemini-2.5-flash`) |
| `APP_URL` | `http://localhost:3001` | Optional public base URL (legacy; QR codes no longer embed URLs) |

See `.env.example` for a template.

---

## Adding Real Products

Seed directly into SQLite (database is created at `./products.db` on first run):

```javascript
const Database = require('better-sqlite3');
const db = new Database('./products.db');

db.prepare(`INSERT INTO products (id, name, brand, batch_id, ...) VALUES (?, ?, ?, ?, ...)`).run(
  'prod_005',
  'My Product',
  'My Brand',
  'BATCH-001'
  // ... etc
);
```

Delete `products.db` and restart if you need a fresh demo seed (4 sample products).

---

## Roadmap / Advanced Features

- [ ] Firebase/Firestore migration for multi-device sync
- [ ] Blockchain traceability (immutable batch records)
- [ ] Multi-language support (Hindi, Tamil, etc.)
- [ ] Voice feedback recording (Web Audio API)
- [ ] Recall notification system via push notifications
- [ ] ERP integration (export feedback to SAP/Oracle)
- [ ] Real-time heatmap of scan locations (geolocation API)
- [ ] Personalized nutrition recommendations (dietary profile)
- [ ] Shelf-life prediction based on batch data
- [ ] AI-generated consumer insight summaries for dashboard

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express 5, SQLite (better-sqlite3) |
| AI Chat | Google Gemini (`gemini-2.5-flash`) + rule-based fallback |
| Barcode data | Open Food Facts API |
| File Uploads | Multer |
| Frontend | Vanilla JS PWA (no framework, no build step) |
| QR Generation | QRCodeJS (client-side) |
| Sentiment | Rule-based scoring (upgradeable to ML) |

---

*Built for internship project — QR Product Intelligence Platform*
