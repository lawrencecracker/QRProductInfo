const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;
// nanoid v5+ is ESM-only in many setups, so use dynamic import inside helpers.
let nanoid = null;
async function getNanoId() {
  if (nanoid) return nanoid;
  const mod = await import('nanoid');
  nanoid = mod.nanoid;
  return nanoid;
}

const multer = require('multer');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) cb(null, true);
    else cb(new Error('Only image or audio files allowed'));
  }
});

// ─── Database Setup ───────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'products.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT NOT NULL,
    category TEXT,
    batch_id TEXT,
    lot_number TEXT,
    manufactured_date TEXT,
    expiry_date TEXT,
    origin_country TEXT,
    ingredients TEXT,
    allergens TEXT,
    nutritional_info TEXT,
    sustainability_info TEXT,
    brand_story TEXT,
    storage_instructions TEXT,
    certifications TEXT,
    image_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    batch_id TEXT,
    overall_rating INTEGER,
    taste_rating INTEGER,
    texture_rating INTEGER,
    appearance_rating INTEGER,
    comment TEXT,
    would_buy_again INTEGER,
    improvements TEXT,
    photo_url TEXT,
    voice_url TEXT,
    sentiment_score REAL,
    consumer_ip TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS incentives (
    id TEXT PRIMARY KEY,
    product_id TEXT,
    code TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    used INTEGER DEFAULT 0,
    used_at TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    messages TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Cache for Open Food Facts lookups by barcode
CREATE TABLE IF NOT EXISTS openfoodfacts_cache (
    barcode TEXT PRIMARY KEY,
    product_json TEXT NOT NULL,
    cached_at TEXT DEFAULT (datetime('now'))

  );
`);

// ─── Seed Demo Products ───────────────────────────────────────────────────────
const seedProducts = () => {
  const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  // Seed once, but keep it lightweight for demo.
  if (count >= 4) return;


  const products = [
    {
      id: 'prod_001',
      name: 'Himalayan Harvest Oat Granola',
      brand: 'PureEarth Foods',
      category: 'Breakfast Cereal',
      batch_id: 'BATCH-2024-0315',
      lot_number: 'LOT-HHO-4521',
      manufactured_date: '2024-03-15',
      expiry_date: '2025-03-14',
      origin_country: 'India',
      ingredients: 'Whole rolled oats (60%), wildflower honey (15%), sunflower seeds (8%), dried cranberries (7%), almonds (5%), coconut oil (3%), vanilla extract (2%)',
      allergens: 'Contains: Tree nuts (almonds), coconut. May contain: Wheat, gluten.',
      nutritional_info: JSON.stringify({
        serving_size: '45g',
        calories: 180,
        total_fat: 6,
        saturated_fat: 2,
        cholesterol: 0,
        sodium: 70,
        total_carbs: 28,
        dietary_fiber: 3,
        total_sugars: 9,
        added_sugars: 5,
        protein: 4,
        vitamin_d: 0,
        calcium: 20,
        iron: 10,
        potassium: 130
      }),
      sustainability_info: 'Certified organic oats sourced from smallholder farms in Himachal Pradesh. Solar-powered manufacturing facility. 100% recyclable packaging. We offset 2x our carbon emissions.',
      brand_story: 'Founded in 2018 by nutrition scientist Dr. Priya Sharma, PureEarth Foods was born from a mission to bring clean, traceable nutrition to Indian households. Every batch is cold-processed to preserve natural enzymes and nutrients.',
      storage_instructions: 'Store in a cool, dry place below 25°C. Keep away from direct sunlight. Once opened, reseal tightly and consume within 3 weeks.',
      certifications: 'FSSAI Certified, Organic India, ISO 22000, Non-GMO Verified',
      image_url: 'https://images.unsplash.com/photo-1517686469429-8bdb88b9f907?w=400'
    },
    {
      id: 'prod_002',
      name: 'Cold Press Turmeric Ginger Juice',
      brand: 'VitalPress',
      category: 'Beverage',
      batch_id: 'BATCH-2024-0420',
      lot_number: 'LOT-CPJT-7823',
      manufactured_date: '2024-04-20',
      expiry_date: '2024-05-20',
      origin_country: 'India',
      ingredients: 'Fresh apple (45%), cold-pressed turmeric root (25%), ginger root (20%), lemon juice (8%), black pepper (2%)',
      allergens: 'None. Produced in a facility that also processes celery.',
      nutritional_info: JSON.stringify({
        serving_size: '250ml',
        calories: 95,
        total_fat: 0.3,
        sodium: 15,
        total_carbs: 22,
        dietary_fiber: 1,
        total_sugars: 18,
        protein: 1,
        vitamin_c: 45,
        curcumin: 120
      }),
      sustainability_info: 'Glass bottles. Fruit pulp composted and given to local farms. Zero-waste production target achieved in 2023.',
      brand_story: 'VitalPress cold-presses within 4 hours of harvest to lock in maximum nutrition. Our Nashik apple and Kerala turmeric farms are partner-owned and paid 30% above market rate.',
      storage_instructions: 'Keep refrigerated at all times. Consume within 3 days of opening. Shake well before drinking.',
      certifications: 'FSSAI, Cold Press Certified, Farm-to-Bottle Verified',
      image_url: 'https://images.unsplash.com/photo-1615485500704-8e990f9900f7?w=400'
    },
    {
      id: 'prod_003',
      name: 'Saffron Basmati Rice (Aged 2 Years)',
      brand: 'GoldenKhet',
      category: 'Staples',
      batch_id: 'BATCH-2024-1102',
      lot_number: 'LOT-GBR-1907',
      manufactured_date: '2024-11-02',
      expiry_date: '2026-11-01',
      origin_country: 'India',
      ingredients: 'Aged basmati rice (98%), saffron strands (0.2%), natural saffron aroma (trace)',
      allergens: 'None',
      nutritional_info: JSON.stringify({
        serving_size: '100g (cooked)',
        calories: 130,
        total_fat: 0.3,
        saturated_fat: 0.1,
        sodium: 5,
        total_carbs: 28,
        dietary_fiber: 0.7,
        total_sugars: 0.2,
        protein: 2.6,
        iron: 0.5,
        potassium: 60
      }),
      sustainability_info: 'Pesticide-reduction farming with drip irrigation. 100% recyclable primary packaging. Community water stewardship program in place since 2022.',
      brand_story: 'GoldenKhet focuses on slow-aged grains and careful sourcing from trusted farmer groups. Our goal is consistent texture and aroma in every batch.',
      storage_instructions: 'Store in a cool, dry place. Keep away from moisture. For best quality, use within the expiry period.',
      certifications: 'FSSAI Certified, Responsible Farming Initiative, ISO 22000',
      image_url: 'https://images.unsplash.com/photo-1604908554044-1d3b1f7e0c7d?w=400'
    },
    {
      id: 'prod_004',
      name: 'Organic Chickpea & Tomato Spread',
      brand: 'FarmFold',
      category: 'Condiments',
      batch_id: 'BATCH-2025-0123',
      lot_number: 'LOT-FFT-5520',
      manufactured_date: '2025-01-23',
      expiry_date: '2026-01-22',
      origin_country: 'India',
      ingredients: 'Chickpeas (55%), roasted tomato (30%), extra virgin olive oil (10%), lemon juice (3%), sea salt (2%)',
      allergens: 'None',
      nutritional_info: JSON.stringify({
        serving_size: '50g',
        calories: 160,
        total_fat: 9,
        saturated_fat: 1.4,
        sodium: 240,
        total_carbs: 18,
        dietary_fiber: 6,
        total_sugars: 3,
        protein: 7,
        iron: 2.0,
        calcium: 40
      }),
      sustainability_info: 'Contracting with organic chickpea growers. Tomato pulp upcycling for reduced waste. Glass-to-glass recycling partnership.',
      brand_story: 'FarmFold creates pantry staples that taste like home and follow responsible sourcing standards. Every batch is small-run for freshness.',
      storage_instructions: 'Refrigerate after opening. Consume within 10 days once opened. Stir before serving.',
      certifications: 'Organic India, FSSAI Certified, Vegan',
      image_url: 'https://images.unsplash.com/photo-1546548932-3593c7d8c2d1?w=400'
    }
  ];

  const insert = db.prepare(`
    INSERT INTO products (id, name, brand, category, batch_id, lot_number, manufactured_date, expiry_date,
      origin_country, ingredients, allergens, nutritional_info, sustainability_info, brand_story,
      storage_instructions, certifications, image_url)
    VALUES (@id, @name, @brand, @category, @batch_id, @lot_number, @manufactured_date, @expiry_date,
      @origin_country, @ingredients, @allergens, @nutritional_info, @sustainability_info, @brand_story,
      @storage_instructions, @certifications, @image_url)
  `);

  for (const p of products) insert.run(p);
  console.log('✓ Demo products seeded');
};

seedProducts();

// ─── Helpers ──────────────────────────────────────────────────────────────────
const simpleSentiment = (text) => {
  if (!text) return 0;
  const pos = ['great','love','excellent','amazing','fantastic','delicious','perfect','best','wonderful','tasty','fresh','healthy','recommend'];
  const neg = ['bad','terrible','awful','disgusting','hate','worst','horrible','nasty','disappointing','stale','poor'];
  const words = text.toLowerCase().split(/\s+/);
  let score = 0;
  for (const w of words) {
    if (pos.some(p => w.includes(p))) score++;
    if (neg.some(n => w.includes(n))) score--;
  }
  return Math.max(-1, Math.min(1, score / Math.max(words.length / 5, 1)));
};

const generateCouponCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `PURE-${code}`;
};

const buildRuleBasedChatReply = (product, messages) => {
  const lastMsg = messages
    .slice()
    .reverse()
    .find(m => m.role === 'user')?.content?.toLowerCase() || '';

  if (!product) {
    return "Please scan a product QR code first, then I can answer questions about it.";
  }

  if (lastMsg.includes('allergen') || lastMsg.includes('allergy')) {
    return `Allergen info: ${product.allergens || 'Not listed for this product.'}`;
  }
  if (lastMsg.includes('ingredient')) {
    return `Ingredients: ${product.ingredients || 'Not listed for this product.'}`;
  }
  if (lastMsg.includes('protein') || lastMsg.includes('calorie') || lastMsg.includes('nutrition')) {
    if (product.nutritional_info) {
      const n = product.nutritional_info;
      return `Per serving: ${n.calories ?? '—'} calories, ${n.protein ?? '—'}g protein.`;
    }
    return 'Nutrition details are not available for this product.';
  }
  if (lastMsg.includes('store') || lastMsg.includes('storage')) {
    return product.storage_instructions || 'Storage instructions are not listed for this product.';
  }
  if (lastMsg.includes('where') || lastMsg.includes('origin') || lastMsg.includes('sourced')) {
    const origin = product.origin_country ? `This product is made in ${product.origin_country}.` : '';
    const sustain = product.sustainability_info?.split('.')[0];
    return [origin, sustain].filter(Boolean).join(' ') || 'Origin information is not listed for this product.';
  }

  return "I'm here to help! Ask me about allergens, ingredients, nutrition, storage, or where this product is from.";
};

const OPENFOODFACTS_CACHE_LIMIT = 50;

const safeJsonParse = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeOpenFoodFactsToLocalProduct = (barcode, offt) => {
  const p = offt?.product || {};
  const name = p?.product_name || p?.generic_name || `Product ${barcode}`;
  const brand = p?.brands || p?.brand_owner || 'Unknown';

  const ingredients = p?.ingredients_text || p?.ingredients_text_en || null;
  const allergens = p?.allergens_tags?.length
    ? p.allergens_tags.map(a => a.replace(/^en:/, '')).join(', ')
    : (p?.allergens || p?.allergen_info || null);

  const n = p?.nutriments || {};
  const pick = (...keys) => {
    for (const key of keys) {
      const value = n?.[key];
      if (typeof value === 'number') return value;
      if (value && typeof value === 'object' && typeof value.value === 'number') return value.value;
    }
    return null;
  };

  const servingSize = p?.serving_size || n?.serving_size || null;
  const nutritional_info = {
    ...(servingSize ? { serving_size: String(servingSize) } : {}),
    ...(pick('energy-kcal_100g', 'energy-kcal_value') != null ? { calories: pick('energy-kcal_100g', 'energy-kcal_value') } : {}),
    ...(pick('fat_100g') != null ? { total_fat: pick('fat_100g') } : {}),
    ...(pick('saturated-fat_100g') != null ? { saturated_fat: pick('saturated-fat_100g') } : {}),
    ...(pick('sodium_100g', 'salt_100g') != null ? { sodium: pick('sodium_100g', 'salt_100g') } : {}),
    ...(pick('carbohydrates_100g') != null ? { total_carbs: pick('carbohydrates_100g') } : {}),
    ...(pick('fiber_100g') != null ? { dietary_fiber: pick('fiber_100g') } : {}),
    ...(pick('sugars_100g') != null ? { total_sugars: pick('sugars_100g') } : {}),
    ...(pick('proteins_100g') != null ? { protein: pick('proteins_100g') } : {})
  };

  const image_url = p?.image_front_url || p?.image_url || null;
  const origin_country = p?.countries || p?.countries_tags?.join(', ') || null;
  const categories = p?.categories || p?.categories_tags?.join(', ') || null;
  const certifications = [
    p?.labels,
    p?.ecoscore_data?.grade ? `Ecoscore ${p.ecoscore_data.grade}` : null,
    p?.nutriscore_grade ? `Nutri-Score ${p.nutriscore_grade.toUpperCase()}` : null
  ].filter(Boolean).join(', ') || null;

  return {
    id: `of_${barcode}`,
    name,
    brand,
    category: categories,
    batch_id: null,
    lot_number: p?.lot_number || null,
    manufactured_date: null,
    expiry_date: null,
    origin_country,
    ingredients,
    allergens,
    nutritional_info: Object.keys(nutritional_info).length ? nutritional_info : null,
    sustainability_info: p?.ecoscore_grade ? `Ecoscore grade: ${p.ecoscore_grade.toUpperCase()}` : null,
    brand_story: null,
    storage_instructions: null,
    certifications,
    image_url,
    barcode
  };
};

const ensureProductRowExistsForBarcode = (barcode, offt) => {
  const local = normalizeOpenFoodFactsToLocalProduct(barcode, offt);
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(local.id);

  if (!existing) {
    db.prepare(`
      INSERT INTO products (
        id, name, brand, category, batch_id, lot_number, manufactured_date, expiry_date,
        origin_country, ingredients, allergens, nutritional_info, sustainability_info, brand_story,
        storage_instructions, certifications, image_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      local.id,
      local.name,
      local.brand,
      local.category,
      local.batch_id,
      local.lot_number,
      local.manufactured_date,
      local.expiry_date,
      local.origin_country,
      local.ingredients,
      local.allergens,
      local.nutritional_info ? JSON.stringify(local.nutritional_info) : null,
      local.sustainability_info,
      local.brand_story,
      local.storage_instructions,
      local.certifications,
      local.image_url
    );
  }

  return local;
};

const fetchOpenFoodFactsProduct = async (barcode) => {
  const nodeFetchMod = await import('node-fetch');
  const fetch = nodeFetchMod.default || nodeFetchMod;
  const resp = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Open Food Facts HTTP ${resp.status}: ${text}`);
  }
  const body = await resp.json();
  if (!body?.product) {
    throw new Error('Open Food Facts returned no product');
  }
  return body;
};

const getCachedOpenFoodFacts = (barcode) => {
  const row = db.prepare('SELECT product_json FROM openfoodfacts_cache WHERE barcode = ?').get(barcode);
  return row ? safeJsonParse(row.product_json) : null;
};

const tryCacheOpenFoodFacts = (barcode, offt) => {
  const exists = db.prepare('SELECT 1 FROM openfoodfacts_cache WHERE barcode = ?').get(barcode);
  if (exists) return false;

  const count = db.prepare('SELECT COUNT(*) as c FROM openfoodfacts_cache').get().c;
  if (count >= OPENFOODFACTS_CACHE_LIMIT) return false;

  db.prepare('INSERT INTO openfoodfacts_cache (barcode, product_json, cached_at) VALUES (?, ?, datetime(\'now\'))')
    .run(barcode, JSON.stringify(offt));
  return true;
};

const resolveProductByBarcode = async (barcode) => {
  const clean = String(barcode || '').replace(/\D/g, '');
  if (!clean) {
    const err = new Error('Invalid barcode');
    err.statusCode = 400;
    throw err;
  }

  let offt = getCachedOpenFoodFacts(clean);
  if (!offt) {
    offt = await fetchOpenFoodFactsProduct(clean);
    tryCacheOpenFoodFacts(clean, offt);
  }

  return ensureProductRowExistsForBarcode(clean, offt);
};

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Get all products (for demo/dashboard)
app.get('/api/products', (req, res) => {
  const rows = db.prepare('SELECT id, name, brand, category, batch_id, image_url FROM products').all();
  res.json({ products: rows });
});

function handleBarcodeError(res, err) {
  const status = err?.statusCode || (String(err?.message || '').includes('Invalid barcode') ? 400 : 502);
  return res.status(status).json({
    error: status === 400 ? 'Invalid barcode' : 'Open Food Facts lookup failed',
    details: err?.message || 'Unknown error'
  });
}

// Get single product by id / batch_id / barcode
app.get('/api/product', async (req, res) => {
  const { productId, batchId, barcode } = req.query;

  if (barcode) {
    const b = String(barcode).replace(/\D/g, '');
    if (!b) return res.status(400).json({ error: 'Invalid barcode' });

    try {
      const product = await resolveProductByBarcode(b);
      return res.json({ product });
    } catch (e) {
      return handleBarcodeError(res, e);
    }
  }

  // Fallback: return first product for demo when no params
  let row;
  if (!productId && !batchId) {
    row = db.prepare('SELECT * FROM products ORDER BY created_at LIMIT 1').get();
  } else {
    row = db.prepare('SELECT * FROM products WHERE id = ? OR batch_id = ?')
             .get(productId || null, batchId || null);
  }

  if (!row) return res.status(404).json({ error: 'Product not found' });

  try { row.nutritional_info = JSON.parse(row.nutritional_info); } catch {}
  res.json({ product: row });
});

app.get('/api/product/barcode/:barcode', async (req, res) => {
  try {
    const product = await resolveProductByBarcode(req.params.barcode);
    res.json({ product });
  } catch (e) {
    return handleBarcodeError(res, e);
  }
});




// Submit feedback
app.post('/api/feedback', upload.fields([{ name: 'photo' }, { name: 'voice' }]), async (req, res) => {
  const {
    product_id, batch_id, overall_rating, taste_rating, texture_rating,
    appearance_rating, comment, would_buy_again, improvements
  } = req.body;


  if (!product_id) return res.status(400).json({ error: 'product_id required' });

  const photo_url = req.files?.photo?.[0] ? `/uploads/${req.files.photo[0].filename}` : null;
  const voice_url = req.files?.voice?.[0] ? `/uploads/${req.files.voice[0].filename}` : null;
  const sentiment_score = simpleSentiment(comment);

  const id = 'fb_' + await getNanoId().then(n => n(10));

  db.prepare(`
    INSERT INTO feedback (id, product_id, batch_id, overall_rating, taste_rating, texture_rating,
      appearance_rating, comment, would_buy_again, improvements, photo_url, voice_url, sentiment_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, product_id, batch_id, overall_rating, taste_rating, texture_rating,
         appearance_rating, comment, would_buy_again === 'true' ? 1 : 0,
         improvements, photo_url, voice_url, sentiment_score);

  // Generate incentive coupon
  const couponCode = generateCouponCode();
  const couponId = 'coup_' + await getNanoId().then(n => n(8));

  const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO incentives (id, product_id, code, type, value, description, expires_at)
    VALUES (?, ?, ?, 'discount', '10%', '10% off your next purchase', ?)
  `).run(couponId, product_id, couponCode, expiryDate);

  res.json({
    success: true,
    feedback_id: id,
    sentiment: sentiment_score > 0.2 ? 'positive' : sentiment_score < -0.2 ? 'negative' : 'neutral',
    incentive: {
      code: couponCode,
      type: 'discount',
      value: '10%',
      description: '10% off your next purchase',
      expires: expiryDate
    }
  });
});

// Dashboard analytics
app.get('/api/dashboard/:productId', (req, res) => {
  const { productId } = req.params;

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  try { product.nutritional_info = JSON.parse(product.nutritional_info); } catch {}

  const allFeedback = db.prepare('SELECT * FROM feedback WHERE product_id = ? ORDER BY created_at DESC').all(productId);
  const totalFeedback = allFeedback.length;

  const avgRatings = db.prepare(`
    SELECT
      ROUND(AVG(overall_rating), 1) as avg_overall,
      ROUND(AVG(taste_rating), 1) as avg_taste,
      ROUND(AVG(texture_rating), 1) as avg_texture,
      ROUND(AVG(appearance_rating), 1) as avg_appearance,
      ROUND(AVG(would_buy_again) * 100, 0) as buy_again_pct,
      ROUND(AVG(sentiment_score), 2) as avg_sentiment
    FROM feedback WHERE product_id = ?
  `).get(productId);

  const ratingDist = db.prepare(`
    SELECT overall_rating as rating, COUNT(*) as count
    FROM feedback WHERE product_id = ? AND overall_rating IS NOT NULL
    GROUP BY overall_rating ORDER BY rating
  `).all(productId);

  const recentFeedback = allFeedback.slice(0, 10);

  res.json({
    product,
    stats: { total_feedback: totalFeedback, ...avgRatings },
    rating_distribution: ratingDist,
    recent_feedback: recentFeedback
  });
});

const QR_PREFIX = 'QRCONNECT:v1';

function buildProductQrPayload(product) {
  const row = typeof product === 'string'
    ? db.prepare('SELECT id, batch_id FROM products WHERE id = ?').get(product)
    : product;

  if (!row) {
    const id = typeof product === 'string' ? product : product?.id;
    if (!id) throw new Error('Product not found');
    return `${QR_PREFIX};id=${encodeURIComponent(id)}`;
  }

  if (String(row.id).startsWith('of_')) {
    return `${QR_PREFIX};barcode=${encodeURIComponent(row.id.slice(3))}`;
  }
  if (row.batch_id) {
    return `${QR_PREFIX};batch=${encodeURIComponent(row.batch_id)}`;
  }
  return `${QR_PREFIX};id=${encodeURIComponent(row.id)}`;
}

// Product QR payload + optional PNG (no redirect URL)
app.get('/api/qr/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const product = db.prepare('SELECT id, batch_id FROM products WHERE id = ?').get(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const payload = buildProductQrPayload(product);
    const format = req.query.format;

    if (format === 'png') {
      res.setHeader('Content-Type', 'image/png');
      return res.send(await QRCode.toBuffer(payload, { width: 512, margin: 2 }));
    }

    const imageDataUrl = await QRCode.toDataURL(payload, { width: 512, margin: 2 });
    res.json({ productId: product.id, payload, imageDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message || 'QR generation failed' });
  }
});

// Chat with AI about product
app.post('/api/chat', async (req, res) => {
  const { productId, messages, batchId } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

  let product = null;
  if (productId) {
    product = db.prepare('SELECT * FROM products WHERE id = ? OR batch_id = ?')
                .get(productId, batchId || null);
    if (product) {
      try { product.nutritional_info = JSON.parse(product.nutritional_info); } catch {}
    }
  }

  if (!product) {
    return res.json({
      reply: buildRuleBasedChatReply(null, messages),
      fallback: true
    });
  }

  const lastUserMessage = messages
    .slice()
    .reverse()
    .find(m => m.role === 'user')?.content;

  const geminiKeyPresent = !!process.env.GEMINI_API_KEY;

  if (genAI && geminiKeyPresent) {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `You are a helpful, friendly food product assistant.

If the user asks about the product, answer using the provided product context only.
If needed, you may reference Open Food Facts data when the product was loaded by barcode.
Do not invent missing label information.
If the answer is not in the data, say so and suggest what to check on the label.
Keep responses concise (2-4 sentences).

DATA SOURCE:
${JSON.stringify(
  {
    productContext: {
      "Product Name": product.name,
      "Brand": product.brand,
      "Ingredients": product.ingredients,
      "Allergens": product.allergens,
      "Nutrition": product.nutritional_info,
      "Sustainability": product.sustainability_info,
      "Storage": product.storage_instructions
    },
    openFoodFactsBaseUrl: 'https://world.openfoodfacts.org/'
  },
  null,
  2
)}

User Question:
${lastUserMessage || ''}`;

    try {
      const result = await model.generateContent(prompt);
      const aiResponse = result.response.text();
      return res.json({ reply: aiResponse });
    } catch (geminiErr) {
      console.error('Gemini generateContent failed:', geminiErr?.message || geminiErr);
    }
  }

  res.json({
    reply: buildRuleBasedChatReply(product, messages),
    fallback: true
  });
});


// ─── Serve Frontend ───────────────────────────────────────────────────────────
const rootIndex = path.join(__dirname, 'index.html');
const distDir = path.join(__dirname, 'frontend', 'dist');

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

app.get(/.*/, (req, res) => {
  res.sendFile(rootIndex);
});

app.listen(PORT, () => {
  console.log(`\n✅ QR Product Insights running on http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/health`);
  console.log(`   Demo: http://localhost:${PORT}?productId=prod_001`);
  if (process.env.GEMINI_API_KEY) {
    console.log('   AI chat: Gemini enabled');
  } else {
    console.log('   AI chat: rule-based fallback (set GEMINI_API_KEY to enable Gemini)\n');
  }
});
