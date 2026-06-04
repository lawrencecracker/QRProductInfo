# TODO - Open Food Facts + Barcode integration

## Backend (server.js)
- [ ] Add SQLite cache table for Open Food Facts product data by barcode.
- [ ] Implement route: `GET /api/product/barcode/:barcode` (fetch from cache first, then Open Food Facts API).
- [x] Enforce “50 products for now” cache cap (store up to 50 unique barcodes; after that, fetch live but don’t cache).

- [ ] Add normalization/mapping from Open Food Facts JSON to the existing `products` fields used by the frontend.
- [ ] Extend existing `GET /api/product` endpoint to accept `?barcode=...`.

## Frontend (index.html)
- [ ] Update product loader to read `barcode` from URL params and call backend with `?barcode=`.
- [ ] Update QR generation to encode `barcode` (preferred) or fallback to `productId`.
- [ ] Ensure nutrition rendering doesn’t break when some nutriment fields are missing (defensive mapping).

## Verification
- [ ] Start server and test endpoint with a known barcode (example: 737628064502).
- [ ] Load product page via URL param `?barcode=737628064502` and confirm UI renders.
- [ ] Confirm caching cap: after 50 unique barcodes, responses should still return but new cache writes should stop.

