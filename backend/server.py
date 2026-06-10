"""
QR Product Insights — FastAPI backend.

Ports the original Node/Express/SQLite backend (server.js) to FastAPI + MongoDB
while preserving every public REST endpoint and response shape used by the
frontend.

Endpoints (all under /api):
    GET    /api/health
    GET    /api/products
    GET    /api/product?productId=&batchId=&barcode=
    GET    /api/product/barcode/{barcode}
    POST   /api/feedback             (multipart: ratings + comment + photo/voice)
    GET    /api/dashboard/{productId}
    GET    /api/qr/{productId}?format=png
    POST   /api/chat
"""
from __future__ import annotations

import base64
import contextlib
import io
import json
import logging
import os
import random
import re
import string
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

import bcrypt
import httpx
import jwt
import qrcode
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("vera")

# ── MongoDB ──────────────────────────────────────────────────────────────────
# We connect lazily so the HTTP server can start (and bind to its port) even
# if the database isn't reachable yet. Endpoints that need the DB will return
# a clear 503 instead of the whole process crashing on import.
mongo_url = os.environ.get("MONGO_URL")
db_name = os.environ.get("DB_NAME", "qr_product_insights")

if mongo_url:
    client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
    db = client[db_name]
else:
    client = None
    db = None
    log.warning(
        "MONGO_URL is not set. The server will start, but all data endpoints "
        "will return 503 until you add a MongoDB connection string to the environment "
        "(see README.md → Deployment)."
    )

products_col = db.products if db is not None else None
feedback_col = db.feedback if db is not None else None
incentives_col = db.incentives if db is not None else None
off_cache_col = db.openfoodfacts_cache if db is not None else None
manufacturers_col = db.manufacturers if db is not None else None

# JWT
JWT_SECRET = os.environ.get("JWT_SECRET", "vera-dev-secret-change-me")
JWT_ALGO = "HS256"
JWT_EXP_HOURS = 24 * 7

if JWT_SECRET == "vera-dev-secret-change-me":
    log.warning(
        "JWT_SECRET is using the insecure default. "
        "Set a strong random value in your environment before going to production."
    )

# ── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="QR Product Insights API")
api = APIRouter(prefix="/api")

# Serve uploads
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# Constants
QR_PREFIX = "QRCONNECT:v1"
OPENFOODFACTS_CACHE_LIMIT = 50
# AI provider configuration — the app checks for Anthropic first, then Gemini.
# Set ANTHROPIC_API_KEY in your environment to use Claude (recommended).
# Set GEMINI_API_KEY to use Google Gemini instead (or as a fallback).
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")


# ── Helpers ──────────────────────────────────────────────────────────────────
def _require_db() -> None:
    if db is None:
        raise HTTPException(
            status_code=503,
            detail="Database is not configured. Set MONGO_URL in the environment.",
        )


def _strip_mongo_id(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    doc.pop("_id", None)
    return doc


def _safe_loads(value: Any) -> Any:
    if isinstance(value, (dict, list)) or value is None:
        return value
    try:
        return json.loads(value)
    except Exception:
        return value


def _simple_sentiment(text: Optional[str]) -> float:
    if not text:
        return 0.0
    pos = {"great", "love", "excellent", "amazing", "fantastic", "delicious", "perfect", "best",
           "wonderful", "tasty", "fresh", "healthy", "recommend"}
    neg = {"bad", "terrible", "awful", "disgusting", "hate", "worst", "horrible", "nasty",
           "disappointing", "stale", "poor"}
    words = text.lower().split()
    score = 0
    for w in words:
        if any(p in w for p in pos):
            score += 1
        if any(n in w for n in neg):
            score -= 1
    norm = max(len(words) / 5, 1)
    return max(-1.0, min(1.0, score / norm))


def _generate_coupon_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "PURE-" + "".join(random.choice(alphabet) for _ in range(8))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_product_qr_payload(product: dict) -> str:
    pid = str(product.get("id", ""))
    if pid.startswith("of_"):
        return f"{QR_PREFIX};barcode={quote(pid[3:], safe='')}"
    if product.get("batch_id"):
        return f"{QR_PREFIX};batch={quote(product['batch_id'], safe='')}"
    return f"{QR_PREFIX};id={quote(pid, safe='')}"


# ── Seed demo products (idempotent) ──────────────────────────────────────────
DEMO_PRODUCTS = [
    {
        "id": "prod_001",
        "name": "Himalayan Harvest Oat Granola",
        "brand": "PureEarth Foods",
        "category": "Breakfast Cereal",
        "batch_id": "BATCH-2024-0315",
        "lot_number": "LOT-HHO-4521",
        "manufactured_date": "2024-03-15",
        "expiry_date": "2025-03-14",
        "origin_country": "India",
        "ingredients": "Whole rolled oats (60%), wildflower honey (15%), sunflower seeds (8%), dried cranberries (7%), almonds (5%), coconut oil (3%), vanilla extract (2%)",
        "allergens": "Contains: Tree nuts (almonds), coconut. May contain: Wheat, gluten.",
        "nutritional_info": {
            "serving_size": "45g", "calories": 180, "total_fat": 6, "saturated_fat": 2,
            "sodium": 70, "total_carbs": 28, "dietary_fiber": 3, "total_sugars": 9,
            "added_sugars": 5, "protein": 4, "iron": 10, "potassium": 130,
        },
        "sustainability_info": "Certified organic oats sourced from smallholder farms in Himachal Pradesh. Solar-powered manufacturing facility. 100% recyclable packaging. We offset 2x our carbon emissions.",
        "brand_story": "Founded in 2018 by nutrition scientist Dr. Priya Sharma, PureEarth Foods was born from a mission to bring clean, traceable nutrition to Indian households. Every batch is cold-processed to preserve natural enzymes and nutrients.",
        "storage_instructions": "Store in a cool, dry place below 25°C. Keep away from direct sunlight. Once opened, reseal tightly and consume within 3 weeks.",
        "certifications": "FSSAI Certified, Organic India, ISO 22000, Non-GMO Verified",
        "image_url": "https://images.unsplash.com/photo-1517686469429-8bdb88b9f907?w=800",
    },
    {
        "id": "prod_002",
        "name": "Cold Press Turmeric Ginger Juice",
        "brand": "VitalPress",
        "category": "Beverage",
        "batch_id": "BATCH-2024-0420",
        "lot_number": "LOT-CPJT-7823",
        "manufactured_date": "2024-04-20",
        "expiry_date": "2024-05-20",
        "origin_country": "India",
        "ingredients": "Fresh apple (45%), cold-pressed turmeric root (25%), ginger root (20%), lemon juice (8%), black pepper (2%)",
        "allergens": "None. Produced in a facility that also processes celery.",
        "nutritional_info": {
            "serving_size": "250ml", "calories": 95, "total_fat": 0.3, "sodium": 15,
            "total_carbs": 22, "dietary_fiber": 1, "total_sugars": 18, "protein": 1,
            "vitamin_c": 45, "curcumin": 120,
        },
        "sustainability_info": "Glass bottles. Fruit pulp composted and given to local farms. Zero-waste production target achieved in 2023.",
        "brand_story": "VitalPress cold-presses within 4 hours of harvest to lock in maximum nutrition. Our Nashik apple and Kerala turmeric farms are partner-owned and paid 30% above market rate.",
        "storage_instructions": "Keep refrigerated at all times. Consume within 3 days of opening. Shake well before drinking.",
        "certifications": "FSSAI, Cold Press Certified, Farm-to-Bottle Verified",
        "image_url": "https://images.unsplash.com/photo-1615485500704-8e990f9900f7?w=800",
    },
    {
        "id": "prod_003",
        "name": "Saffron Basmati Rice (Aged 2 Years)",
        "brand": "GoldenKhet",
        "category": "Staples",
        "batch_id": "BATCH-2024-1102",
        "lot_number": "LOT-GBR-1907",
        "manufactured_date": "2024-11-02",
        "expiry_date": "2026-11-01",
        "origin_country": "India",
        "ingredients": "Aged basmati rice (98%), saffron strands (0.2%), natural saffron aroma (trace)",
        "allergens": "None",
        "nutritional_info": {
            "serving_size": "100g (cooked)", "calories": 130, "total_fat": 0.3,
            "saturated_fat": 0.1, "sodium": 5, "total_carbs": 28, "dietary_fiber": 0.7,
            "total_sugars": 0.2, "protein": 2.6, "iron": 0.5, "potassium": 60,
        },
        "sustainability_info": "Pesticide-reduction farming with drip irrigation. 100% recyclable primary packaging. Community water stewardship program in place since 2022.",
        "brand_story": "GoldenKhet focuses on slow-aged grains and careful sourcing from trusted farmer groups. Our goal is consistent texture and aroma in every batch.",
        "storage_instructions": "Store in a cool, dry place. Keep away from moisture. For best quality, use within the expiry period.",
        "certifications": "FSSAI Certified, Responsible Farming Initiative, ISO 22000",
        "image_url": "https://images.unsplash.com/photo-1604908554044-1d3b1f7e0c7d?w=800",
    },
    {
        "id": "prod_004",
        "name": "Organic Chickpea & Tomato Spread",
        "brand": "FarmFold",
        "category": "Condiments",
        "batch_id": "BATCH-2025-0123",
        "lot_number": "LOT-FFT-5520",
        "manufactured_date": "2025-01-23",
        "expiry_date": "2026-01-22",
        "origin_country": "India",
        "ingredients": "Chickpeas (55%), roasted tomato (30%), extra virgin olive oil (10%), lemon juice (3%), sea salt (2%)",
        "allergens": "None",
        "nutritional_info": {
            "serving_size": "50g", "calories": 160, "total_fat": 9, "saturated_fat": 1.4,
            "sodium": 240, "total_carbs": 18, "dietary_fiber": 6, "total_sugars": 3,
            "protein": 7, "iron": 2.0, "calcium": 40,
        },
        "sustainability_info": "Contracting with organic chickpea growers. Tomato pulp upcycling for reduced waste. Glass-to-glass recycling partnership.",
        "brand_story": "FarmFold creates pantry staples that taste like home and follow responsible sourcing standards. Every batch is small-run for freshness.",
        "storage_instructions": "Refrigerate after opening. Consume within 10 days once opened. Stir before serving.",
        "certifications": "Organic India, FSSAI Certified, Vegan",
        "image_url": "https://images.unsplash.com/photo-1546548932-3593c7d8c2d1?w=800",
    },
]


DEMO_MANUFACTURER_ID = "mf_demo_pureearth"


async def _seed_demo_products() -> None:
    """Seed demo data on startup. Called from the lifespan handler."""
    if db is None:
        log.warning("Skipping demo seed — MONGO_URL is not configured.")
        return
    try:
        # Quick connectivity probe; surfaces auth/network errors immediately.
        await client.admin.command("ping")
    except Exception as e:  # pragma: no cover
        log.error("MongoDB ping failed at startup: %s", e)
        return

    # Seed demo manufacturer (idempotent)
    await manufacturers_col.update_one(
        {"id": DEMO_MANUFACTURER_ID},
        {"$setOnInsert": {
            "id": DEMO_MANUFACTURER_ID,
            "email": "demo@vera.app",
            "brand_name": "Vera Demo Brands",
            "password_hash": bcrypt.hashpw(b"demo1234", bcrypt.gensalt()).decode(),
            "created_at": _now_iso(),
        }},
        upsert=True,
    )

    count = await products_col.count_documents({})
    if count >= 4:
        # Backfill manufacturer_id on existing demo products if missing
        await products_col.update_many(
            {"id": {"$in": [p["id"] for p in DEMO_PRODUCTS]}, "manufacturer_id": {"$exists": False}},
            {"$set": {"manufacturer_id": DEMO_MANUFACTURER_ID}},
        )
        return
    for p in DEMO_PRODUCTS:
        p = {**p, "manufacturer_id": DEMO_MANUFACTURER_ID, "created_at": _now_iso()}
        await products_col.update_one({"id": p["id"]}, {"$setOnInsert": p}, upsert=True)
    log.info("Seeded %d demo products + demo manufacturer", len(DEMO_PRODUCTS))


# ── Auth helpers ─────────────────────────────────────────────────────────────
def _make_token(manufacturer_id: str) -> str:
    payload = {
        "sub": manufacturer_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXP_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


async def get_current_manufacturer(authorization: Optional[str] = Header(None)) -> dict:
    _require_db()
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        raise HTTPException(401, detail="Invalid or expired token")
    mf = await manufacturers_col.find_one({"id": payload.get("sub")}, {"_id": 0, "password_hash": 0})
    if not mf:
        raise HTTPException(401, detail="Manufacturer not found")
    return mf


class RegisterReq(BaseModel):
    email: EmailStr
    password: str
    brand_name: str


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class ProductPayload(BaseModel):
    id: Optional[str] = None
    name: str
    brand: str
    category: Optional[str] = None
    batch_id: Optional[str] = None
    lot_number: Optional[str] = None
    manufactured_date: Optional[str] = None
    expiry_date: Optional[str] = None
    origin_country: Optional[str] = None
    ingredients: Optional[str] = None
    allergens: Optional[str] = None
    nutritional_info: Optional[dict] = None
    sustainability_info: Optional[str] = None
    brand_story: Optional[str] = None
    storage_instructions: Optional[str] = None
    certifications: Optional[str] = None
    image_url: Optional[str] = None


# ── Open Food Facts ──────────────────────────────────────────────────────────
def _normalize_off_to_product(barcode: str, off_body: dict) -> dict:
    p = (off_body or {}).get("product") or {}
    n = p.get("nutriments") or {}

    def pick(*keys: str) -> Any:
        for k in keys:
            v = n.get(k)
            if isinstance(v, (int, float)):
                return v
            if isinstance(v, dict) and isinstance(v.get("value"), (int, float)):
                return v["value"]
        return None

    nutritional_info: dict = {}
    serving_size = p.get("serving_size") or n.get("serving_size")
    if serving_size:
        nutritional_info["serving_size"] = str(serving_size)
    for label, keys in [
        ("calories", ("energy-kcal_100g", "energy-kcal_value")),
        ("total_fat", ("fat_100g",)),
        ("saturated_fat", ("saturated-fat_100g",)),
        ("sodium", ("sodium_100g", "salt_100g")),
        ("total_carbs", ("carbohydrates_100g",)),
        ("dietary_fiber", ("fiber_100g",)),
        ("total_sugars", ("sugars_100g",)),
        ("protein", ("proteins_100g",)),
    ]:
        val = pick(*keys)
        if val is not None:
            nutritional_info[label] = val

    allergen_tags = p.get("allergens_tags") or []
    allergens = (
        ", ".join(a.replace("en:", "") for a in allergen_tags)
        if allergen_tags
        else (p.get("allergens") or p.get("allergen_info") or None)
    )

    cats = p.get("categories") or (", ".join(p.get("categories_tags") or []) or None)
    certifications_parts = [
        p.get("labels"),
        f"Ecoscore {p['ecoscore_data']['grade']}" if p.get("ecoscore_data", {}).get("grade") else None,
        f"Nutri-Score {p['nutriscore_grade'].upper()}" if p.get("nutriscore_grade") else None,
    ]
    certifications = ", ".join([c for c in certifications_parts if c]) or None
    origin = p.get("countries") or (", ".join(p.get("countries_tags") or []) or None)

    return {
        "id": f"of_{barcode}",
        "name": p.get("product_name") or p.get("generic_name") or f"Product {barcode}",
        "brand": p.get("brands") or p.get("brand_owner") or "Unknown",
        "category": cats,
        "batch_id": None,
        "lot_number": p.get("lot_number"),
        "manufactured_date": None,
        "expiry_date": None,
        "origin_country": origin,
        "ingredients": p.get("ingredients_text") or p.get("ingredients_text_en"),
        "allergens": allergens,
        "nutritional_info": nutritional_info or None,
        "sustainability_info": (
            f"Ecoscore grade: {p['ecoscore_grade'].upper()}" if p.get("ecoscore_grade") else None
        ),
        "brand_story": None,
        "storage_instructions": None,
        "certifications": certifications,
        "image_url": p.get("image_front_url") or p.get("image_url"),
        "barcode": barcode,
    }


async def _resolve_by_barcode(barcode: str) -> dict:
    _require_db()
    clean = re.sub(r"\D", "", barcode or "")
    if not clean:
        raise HTTPException(400, detail="Invalid barcode")

    cached = await off_cache_col.find_one({"barcode": clean})
    off_body = _safe_loads(cached["product_json"]) if cached else None

    if not off_body:
        async with httpx.AsyncClient(timeout=15.0) as cli:
            try:
                r = await cli.get(f"https://world.openfoodfacts.org/api/v2/product/{clean}.json")
            except httpx.RequestError as e:
                raise HTTPException(502, detail=f"Open Food Facts unreachable: {e}")
        if r.status_code != 200:
            raise HTTPException(502, detail=f"Open Food Facts HTTP {r.status_code}")
        off_body = r.json()
        if not off_body.get("product"):
            raise HTTPException(404, detail="Product not found in Open Food Facts")

        cache_count = await off_cache_col.count_documents({})
        if cache_count < OPENFOODFACTS_CACHE_LIMIT:
            await off_cache_col.insert_one({
                "barcode": clean,
                "product_json": json.dumps(off_body),
                "cached_at": _now_iso(),
            })

    local = _normalize_off_to_product(clean, off_body)
    await products_col.update_one(
        {"id": local["id"]},
        {"$setOnInsert": {**local, "created_at": _now_iso()}},
        upsert=True,
    )
    return local


# ── Routes ───────────────────────────────────────────────────────────────────
@api.get("/health")
async def health() -> dict:
    db_ok = False
    db_error: Optional[str] = None
    if db is not None:
        try:
            await client.admin.command("ping")
            db_ok = True
        except Exception as e:  # pragma: no cover
            db_error = str(e)
    return {
        "status": "ok",
        "timestamp": _now_iso(),
        "database": {
            "configured": db is not None,
            "connected": db_ok,
            "error": db_error,
        },
        "ai_configured": bool(ANTHROPIC_API_KEY or GEMINI_API_KEY),
        "ai_provider": "anthropic" if ANTHROPIC_API_KEY else ("gemini" if GEMINI_API_KEY else "rule-based"),
    }


@api.get("/products")

async def list_products() -> dict:
    _require_db()
    cursor = products_col.find(
        {},
        {"_id": 0, "id": 1, "name": 1, "brand": 1, "category": 1, "batch_id": 1, "image_url": 1},
    )
    products = [doc async for doc in cursor]
    return {"products": products}


@api.get("/product")
async def get_product(
    productId: Optional[str] = None,
    batchId: Optional[str] = None,
    barcode: Optional[str] = None,
) -> dict:
    _require_db()
    if barcode:
        return {"product": await _resolve_by_barcode(barcode)}

    if not productId and not batchId:
        doc = await products_col.find_one({}, sort=[("created_at", 1)])
    else:
        doc = await products_col.find_one({
            "$or": [{"id": productId}, {"batch_id": batchId}]
        })

    if not doc:
        raise HTTPException(404, detail="Product not found")
    _strip_mongo_id(doc)
    if isinstance(doc.get("nutritional_info"), str):
        doc["nutritional_info"] = _safe_loads(doc["nutritional_info"])
    return {"product": doc}


@api.get("/product/barcode/{barcode}")
async def product_by_barcode(barcode: str) -> dict:
    _require_db()
    return {"product": await _resolve_by_barcode(barcode)}


@api.post("/feedback")
async def submit_feedback(
    product_id: str = Form(...),
    batch_id: Optional[str] = Form(None),
    overall_rating: Optional[int] = Form(None),
    taste_rating: Optional[int] = Form(None),
    texture_rating: Optional[int] = Form(None),
    appearance_rating: Optional[int] = Form(None),
    comment: Optional[str] = Form(None),
    improvements: Optional[str] = Form(None),
    would_buy_again: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None),
    voice: Optional[UploadFile] = File(None),
    contact_email: Optional[str] = Form(None),
    contact_phone: Optional[str] = Form(None),
) -> dict:
    _require_db()
    async def _save_apiupload_async(upload: UploadFile, prefix: str) -> Optional[str]:
        """Save an uploaded file to disk without blocking the event loop."""
        if not upload:
            return None
        ext = (Path(upload.filename or "").suffix or "").lower()
        if not ext and upload.content_type:
            if "/" in upload.content_type:
                ext = "." + upload.content_type.split("/")[-1].split(";")[0]
        fname = f"{prefix}_{uuid.uuid4().hex}{ext}"
        path = UPLOAD_DIR / fname
        await upload.seek(0)
        data = await upload.read()
        import asyncio as _asyncio
        await _asyncio.to_thread(path.write_bytes, data)
        return f"/uploads/{fname}"

    photo_url = await _save_upload_async(photo, "photo") if photo else None
    voice_url = await _save_upload_async(voice, "voice") if voice else None
    sentiment_score = _simple_sentiment(comment)

    fb_id = "fb_" + "".join(random.choices(string.ascii_letters + string.digits, k=10))
    buy_again_int = 1 if (would_buy_again in ("true", "1", "True", True)) else 0

    feedback_doc = {
        "id": fb_id,
        "product_id": product_id,
        "batch_id": batch_id,
        "overall_rating": int(overall_rating) if overall_rating else None,
        "taste_rating": int(taste_rating) if taste_rating else None,
        "texture_rating": int(texture_rating) if texture_rating else None,
        "appearance_rating": int(appearance_rating) if appearance_rating else None,
        "comment": comment,
        "improvements": improvements,
        "would_buy_again": buy_again_int,
        "photo_url": photo_url,
        "voice_url": voice_url,
        "sentiment_score": sentiment_score,
        "contact_email": contact_email,
        "contact_phone": contact_phone,
        "created_at": _now_iso(),
    }
    await feedback_col.insert_one(feedback_doc)

    coupon_code = _generate_coupon_code()
    expires_at = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    await incentives_col.insert_one({
        "id": "coup_" + "".join(random.choices(string.ascii_letters + string.digits, k=8)),
        "product_id": product_id,
        "code": coupon_code,
        "type": "discount",
        "value": "10%",
        "description": "10% off your next purchase",
        "used": 0,
        # Keep DB field as expires_at (internal), but API will expose `expires` for tests.
        "expires_at": expires_at,
        "contact_email": contact_email,
        "contact_phone": contact_phone,
        "delivered": False,
        "created_at": _now_iso(),
    })


    # Log delivery intent (SendGrid/Twilio wiring deferred — keys not yet configured)
    if contact_email or contact_phone:
        log.info("[coupon-delivery-pending] code=%s -> email=%s phone=%s",
                 coupon_code, contact_email, contact_phone)

    sentiment_label = "positive" if sentiment_score > 0.2 else ("negative" if sentiment_score < -0.2 else "neutral")
    return {
        "success": True,
        "feedback_id": fb_id,
        "sentiment": sentiment_label,
        "incentive": {
            "code": coupon_code,
            "type": "discount",
            "value": "10%",
            "description": "10% off your next purchase",
            "expires": expires_at,
            # Some clients expect this key name.
            "expires_at": expires_at,
        },
    }



@api.get("/dashboard/{productId}")
async def dashboard(productId: str) -> dict:
    _require_db()
    product = await products_col.find_one({"id": productId})
    if not product:
        raise HTTPException(404, detail="Product not found")
    _strip_mongo_id(product)
    if isinstance(product.get("nutritional_info"), str):
        product["nutritional_info"] = _safe_loads(product["nutritional_info"])

    cursor = feedback_col.find({"product_id": productId}, {"_id": 0}).sort("created_at", -1)
    all_fb = [doc async for doc in cursor]
    total = len(all_fb)

    def _avg(vals: list[float]) -> Optional[float]:
        valid = [v for v in vals if isinstance(v, (int, float))]
        return round(sum(valid) / len(valid), 2) if valid else None

    avg_overall = _avg([f.get("overall_rating") for f in all_fb])
    avg_taste = _avg([f.get("taste_rating") for f in all_fb])
    avg_texture = _avg([f.get("texture_rating") for f in all_fb])
    avg_appearance = _avg([f.get("appearance_rating") for f in all_fb])
    buy_again = [f.get("would_buy_again") for f in all_fb if f.get("would_buy_again") is not None]
    buy_again_pct = round((sum(buy_again) / len(buy_again)) * 100) if buy_again else None
    avg_sentiment = _avg([f.get("sentiment_score") for f in all_fb])

    dist: dict[int, int] = {}
    for f in all_fb:
        r = f.get("overall_rating")
        if isinstance(r, int):
            dist[r] = dist.get(r, 0) + 1
    rating_distribution = [{"rating": k, "count": v} for k, v in sorted(dist.items())]

    return {
        "product": product,
        "stats": {
            "total_feedback": total,
            "avg_overall": round(avg_overall, 1) if avg_overall is not None else None,
            "avg_taste": round(avg_taste, 1) if avg_taste is not None else None,
            "avg_texture": round(avg_texture, 1) if avg_texture is not None else None,
            "avg_appearance": round(avg_appearance, 1) if avg_appearance is not None else None,
            "buy_again_pct": buy_again_pct,
            "avg_sentiment": avg_sentiment,
        },
        "rating_distribution": rating_distribution,
        "recent_feedback": all_fb[:10],
    }


@api.get("/qr/{productId}")
async def get_qr(productId: str, format: Optional[str] = Query(None)) -> Any:
    _require_db()
    product = await products_col.find_one({"id": productId}, {"_id": 0, "id": 1, "batch_id": 1})
    if not product:
        raise HTTPException(404, detail="Product not found")
    payload = _build_product_qr_payload(product)

    img = qrcode.make(payload, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()

    if format == "png":
        return Response(content=png_bytes, media_type="image/png")

    data_url = "data:image/png;base64," + base64.b64encode(png_bytes).decode()
    return {"productId": product["id"], "payload": payload, "imageDataUrl": data_url}


# Chat (Gemini)
class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    productId: Optional[str] = None
    batchId: Optional[str] = None
    messages: list[ChatMessage]


def _rule_based_reply(product: Optional[dict], messages: list[ChatMessage]) -> str:
    last = next((m.content.lower() for m in reversed(messages) if m.role == "user"), "")
    if not product:
        return "Please scan a product QR code first, then I can answer questions about it."
    if "allergen" in last or "allergy" in last:
        return f"Allergen info: {product.get('allergens') or 'Not listed for this product.'}"
    if "ingredient" in last:
        return f"Ingredients: {product.get('ingredients') or 'Not listed for this product.'}"
    if any(w in last for w in ("protein", "calorie", "nutrition")):
        n = product.get("nutritional_info") or {}
        if n:
            return f"Per serving: {n.get('calories', '—')} calories, {n.get('protein', '—')}g protein."
        return "Nutrition details are not available for this product."
    if "store" in last or "storage" in last:
        return product.get("storage_instructions") or "Storage instructions are not listed for this product."
    if any(w in last for w in ("where", "origin", "sourced")):
        origin = f"This product is made in {product['origin_country']}." if product.get("origin_country") else ""
        sust = (product.get("sustainability_info") or "").split(".")[0]
        joined = " ".join(s for s in [origin, sust] if s)
        return joined or "Origin information is not listed for this product."
    return "I'm here to help! Ask me about allergens, ingredients, nutrition, storage, or where this product is from."


def _build_product_context(product: dict) -> str:
    return json.dumps({
        "Product Name": product.get("name"),
        "Brand": product.get("brand"),
        "Category": product.get("category"),
        "Ingredients": product.get("ingredients"),
        "Allergens": product.get("allergens"),
        "Nutrition": product.get("nutritional_info"),
        "Sustainability": product.get("sustainability_info"),
        "Storage": product.get("storage_instructions"),
        "Origin": product.get("origin_country"),
        "Certifications": product.get("certifications"),
    }, indent=2)


@api.post("/chat")
async def chat(req: ChatRequest) -> dict:
    if not req.messages:
        raise HTTPException(400, detail="messages array required")

    product = None
    if req.productId and db is not None:
        product = await products_col.find_one({
            "$or": [{"id": req.productId}, {"batch_id": req.batchId}]
        })
        if product:
            _strip_mongo_id(product)
            if isinstance(product.get("nutritional_info"), str):
                product["nutritional_info"] = _safe_loads(product["nutritional_info"])

    if not product:
        return {"reply": _rule_based_reply(None, req.messages), "fallback": True}

    last_user = next((m.content for m in reversed(req.messages) if m.role == "user"), "")

    # Attempt to fetch extra context from the product's URL (if any) to enrich AI answers
    extra_url_context = ""
    if last_user:
        extra_url_context = await _fetch_url_context(product)

    if last_user:
        # Try Anthropic (Claude) first, then Gemini, then rule-based fallback
        if ANTHROPIC_API_KEY:
            try:
                reply = await _anthropic_reply(product, req.messages, last_user, extra_url_context)
                if reply:
                    return {"reply": reply}
            except Exception as e:
                log.warning("Anthropic chat failed, trying next: %s", e)

        if GEMINI_API_KEY:
            try:
                reply = await _gemini_reply(product, req.messages, last_user, extra_url_context)
                if reply:
                    return {"reply": reply}
            except Exception as e:
                log.warning("Gemini chat failed, falling back: %s", e)

    return {"reply": _rule_based_reply(product, req.messages), "fallback": True}


async def _fetch_url_context(product: dict) -> str:
    """Attempt to fetch plain-text content from a URL embedded in the product record.

    Looks for a ``source_url`` field first, then ``image_url`` only if it is not
    an image (heuristic: no image extension).  Returns an empty string on any
    error so the caller always gets a safe value.
    """
    url = product.get("source_url") or ""
    if not url:
        # Only fetch non-image URLs from image_url field
        candidate = product.get("image_url") or ""
        if candidate and not any(
            candidate.lower().endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg")
        ):
            url = candidate

    if not url or not url.startswith(("http://", "https://")):
        return ""

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as cli:
            r = await cli.get(url, headers={"User-Agent": "Vera-Product-Bot/1.0"})
            if r.status_code != 200:
                return ""
            # Strip HTML tags for a simple text extraction
            content_type = r.headers.get("content-type", "")
            if "html" in content_type:
                import re as _re
                text = _re.sub(r"<[^>]+>", " ", r.text)
                text = _re.sub(r"\s+", " ", text).strip()
            elif "text" in content_type:
                text = r.text.strip()
            else:
                return ""
            return text[:4000]  # cap at 4000 chars to stay within token budget
    except Exception as e:
        log.debug("URL context fetch failed for %s: %s", url, e)
        return ""


async def _anthropic_reply(
    product: dict,
    messages: list[ChatMessage],
    last_user: str,
    extra_context: str = "",
) -> Optional[str]:
    """Call Anthropic Claude via the official SDK."""
    try:
        import anthropic as _anthropic  # type: ignore
    except ModuleNotFoundError:
        log.warning("anthropic package not installed; run: pip install anthropic")
        return None

    system_message = (
        "You are a helpful, friendly food product assistant. "
        "Answer using ONLY the provided product context. Do not invent missing label info. "
        "If the answer isn't in the data, say so and suggest what to check on the label. "
        "Keep responses concise (2-4 sentences).\n\nPRODUCT CONTEXT:\n"
        + _build_product_context(product)
    )
    if extra_context:
        system_message += "\n\nADDITIONAL PRODUCT INFORMATION FROM WEB:\n" + extra_context

    # Build the conversation history (last 6 exchanges max)
    history = [
        {"role": m.role if m.role in ("user", "assistant") else "user", "content": m.content}
        for m in messages[-13:]  # include up to 13 messages (6 pairs + current)
    ]

    import asyncio as _asyncio

    def _call() -> str:
        client = _anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        resp = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=512,
            system=system_message,
            messages=history,
        )
        return resp.content[0].text if resp.content else ""

    text = await _asyncio.to_thread(_call)
    return text.strip() or None


async def _gemini_reply(
    product: dict,
    messages: list[ChatMessage],
    last_user: str,
    extra_context: str = "",
) -> Optional[str]:
    """Call Google Gemini via the official google-generativeai SDK."""
    system_message = (
        "You are a helpful, friendly food product assistant. "
        "Answer using ONLY the provided product context. Do not invent missing label info. "
        "If the answer isn't in the data, say so and suggest what to check on the label. "
        "Keep responses concise (2-4 sentences).\n\nPRODUCT CONTEXT:\n"
        + _build_product_context(product)
    )
    if extra_context:
        system_message += "\n\nADDITIONAL PRODUCT INFORMATION FROM WEB:\n" + extra_context

    try:
        import google.generativeai as genai  # type: ignore
    except ModuleNotFoundError:
        return None

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL, system_instruction=system_message)
    history = []
    for m in messages[:-1][-6:]:
        history.append({
            "role": "user" if m.role == "user" else "model",
            "parts": [m.content],
        })
    chat_session = model.start_chat(history=history)
    import asyncio as _asyncio
    resp = await _asyncio.to_thread(chat_session.send_message, last_user)
    return (getattr(resp, "text", "") or "").strip() or None


# ── Mount ────────────────────────────────────────────────────────────────────
# ── Auth + Admin routes ──────────────────────────────────────────────────────
@api.post("/auth/register")
async def auth_register(req: RegisterReq) -> dict:
    _require_db()
    existing = await manufacturers_col.find_one({"email": req.email.lower()})
    if existing:
        raise HTTPException(400, detail="Email already registered")
    mid = "mf_" + uuid.uuid4().hex[:12]
    mf_doc = {
        "id": mid,
        "email": req.email.lower(),
        "brand_name": req.brand_name,
        "password_hash": bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode(),
        "created_at": _now_iso(),
    }
    await manufacturers_col.insert_one(mf_doc)
    token = _make_token(mid)
    return {"token": token, "manufacturer": {"id": mid, "email": mf_doc["email"], "brand_name": mf_doc["brand_name"]}}


@api.post("/auth/login")
async def auth_login(req: LoginReq) -> dict:
    _require_db()
    mf = await manufacturers_col.find_one({"email": req.email.lower()})
    if not mf or not bcrypt.checkpw(req.password.encode(), mf["password_hash"].encode()):
        raise HTTPException(401, detail="Invalid email or password")
    token = _make_token(mf["id"])
    return {"token": token, "manufacturer": {"id": mf["id"], "email": mf["email"], "brand_name": mf["brand_name"]}}


@api.get("/auth/me")
async def auth_me(mf: dict = Depends(get_current_manufacturer)) -> dict:
    return {"manufacturer": mf}


@api.get("/admin/products")
async def admin_list_products(mf: dict = Depends(get_current_manufacturer)) -> dict:
    _require_db()
    cursor = products_col.find({"manufacturer_id": mf["id"]}, {"_id": 0}).sort("created_at", -1)
    products = [doc async for doc in cursor]
    return {"products": products}


@api.post("/admin/products")
async def admin_create_product(payload: ProductPayload, mf: dict = Depends(get_current_manufacturer)) -> dict:
    pid = payload.id or ("prod_" + uuid.uuid4().hex[:10])
    if await products_col.find_one({"id": pid}):
        raise HTTPException(400, detail="Product id already exists")
    doc = payload.model_dump()
    doc.update({"id": pid, "manufacturer_id": mf["id"], "created_at": _now_iso()})
    await products_col.insert_one(doc)
    doc.pop("_id", None)
    return {"product": doc}


@api.put("/admin/products/{product_id}")
async def admin_update_product(product_id: str, payload: ProductPayload,
                                mf: dict = Depends(get_current_manufacturer)) -> dict:
    existing = await products_col.find_one({"id": product_id})
    if not existing:
        raise HTTPException(404, detail="Product not found")
    if existing.get("manufacturer_id") != mf["id"]:
        raise HTTPException(403, detail="Not your product")
    update = {k: v for k, v in payload.model_dump().items() if k != "id" and v is not None}
    await products_col.update_one({"id": product_id}, {"$set": update})
    doc = await products_col.find_one({"id": product_id}, {"_id": 0})
    return {"product": doc}


@api.delete("/admin/products/{product_id}")
async def admin_delete_product(product_id: str, mf: dict = Depends(get_current_manufacturer)) -> dict:
    existing = await products_col.find_one({"id": product_id})
    if not existing:
        raise HTTPException(404, detail="Product not found")
    if existing.get("manufacturer_id") != mf["id"]:
        raise HTTPException(403, detail="Not your product")
    await products_col.delete_one({"id": product_id})
    return {"success": True}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Optional: serve the built React frontend from the same origin ───────────
# When the React build has been copied next to the backend (see root
# `npm run build`), the same process answers /api/* AND the SPA. This is the
# easiest "one process, one URL" deploy. Set SERVE_FRONTEND=false to opt out.
_frontend_build = ROOT_DIR.parent / "frontend_build"
if not _frontend_build.exists():
    _frontend_build = ROOT_DIR / "frontend_build"

_serve_frontend = os.environ.get("SERVE_FRONTEND", "auto").lower()
_should_serve = (_serve_frontend == "true") or (_serve_frontend == "auto" and _frontend_build.exists())

if _should_serve and _frontend_build.exists():
    from fastapi.responses import FileResponse

    static_dir = _frontend_build / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    _root_files = {p.name for p in _frontend_build.iterdir() if p.is_file()}

    # Handle both GET and HEAD so health-check probes (which use HEAD) don't
    # get a 405 Method Not Allowed from the SPA catch-all route.
    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def spa_router(full_path: str):
        if full_path.startswith(("api/", "uploads/", "static/")):
            raise HTTPException(404, detail="Not found")
        if full_path in _root_files:
            return FileResponse(_frontend_build / full_path)
        index = _frontend_build / "index.html"
        if index.exists():
            return FileResponse(index)
        raise HTTPException(404, detail="Frontend build not found")

    log.info("Serving React frontend from %s", _frontend_build)


# ── Lifespan: wire startup/shutdown ──────────────────────────────────────────
# Using the modern lifespan context-manager approach (on_event is deprecated).
@contextlib.asynccontextmanager
async def _lifespan(app: FastAPI):  # noqa: ARG001
    await _seed_demo_products()
    yield
    if client is not None:
        client.close()


# Attach lifespan after all routes are defined so the router is fully built.
app.router.lifespan_context = _lifespan
