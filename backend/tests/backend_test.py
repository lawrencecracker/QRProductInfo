"""Backend integration tests for QR Product Insights API."""
import os
import pathlib
import pytest
import requests
from dotenv import load_dotenv
load_dotenv()

# Locate .env relative to this file — works regardless of the working directory
# or the OS the tests run on.
_repo_root = pathlib.Path(__file__).resolve().parents[2]  # backend/tests/ -> repo root
for _candidate in [
    _repo_root / "backend" / ".env",
    _repo_root / "frontend" / ".env",
    pathlib.Path(".env"),
]:
    if _candidate.exists():
        load_dotenv(_candidate)
        break

# Fall back to localhost if no REACT_APP_BACKEND_URL is set (useful in CI)
BASE_URL = os.getenv("REACT_APP_BACKEND_URL").rstrip("/")


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ── Health ───────────────────────────────────────────────────────────────────
def test_health(s):
    r = s.get(f"{BASE_URL}/api/health", timeout=10)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ── Products listing & seed ──────────────────────────────────────────────────
def test_list_products_has_seed(s):
    r = s.get(f"{BASE_URL}/api/products", timeout=10)
    assert r.status_code == 200
    products = r.json()["products"]
    ids = {p["id"] for p in products}
    for pid in ("prod_001", "prod_002", "prod_003", "prod_004"):
        assert pid in ids
    for p in products:
        if p["id"].startswith("prod_"):
            assert p.get("name") and p.get("brand") and p.get("category") and p.get("image_url")


def test_get_product_by_id(s):
    r = s.get(f"{BASE_URL}/api/product", params={"productId": "prod_001"}, timeout=10)
    assert r.status_code == 200
    prod = r.json()["product"]
    assert prod["id"] == "prod_001"
    assert isinstance(prod["nutritional_info"], dict)
    assert prod["nutritional_info"].get("calories") == 180


def test_get_product_no_params(s):
    r = s.get(f"{BASE_URL}/api/product", timeout=10)
    assert r.status_code == 200
    assert "product" in r.json()


# ── QR ────────────────────────────────────────────────────────────────────────
def test_qr_json(s):
    r = s.get(f"{BASE_URL}/api/qr/prod_001", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["productId"] == "prod_001"
    assert body["payload"].startswith("QRCONNECT:v1;batch=")
    assert body["imageDataUrl"].startswith("data:image/png;base64,")


def test_qr_png(s):
    r = s.get(f"{BASE_URL}/api/qr/prod_001", params={"format": "png"}, timeout=10)
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


# ── Feedback + Dashboard ─────────────────────────────────────────────────────
def test_feedback_and_dashboard(s):
    r = s.post(
        f"{BASE_URL}/api/feedback",
        data={
            "product_id": "prod_001",
            "overall_rating": 5,
            "taste_rating": 5,
            "texture_rating": 4,
            "appearance_rating": 5,
            "comment": "Absolutely delicious and fresh! TEST_feedback",
            "would_buy_again": "true",
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["success"] is True
    assert j["sentiment"] in ("positive", "neutral", "negative")
    assert j["incentive"]["code"].startswith("PURE-")
    assert j["incentive"]["expires"]

    r2 = s.get(f"{BASE_URL}/api/dashboard/prod_001", timeout=10)
    assert r2.status_code == 200
    d = r2.json()
    assert d["stats"]["total_feedback"] >= 1
    assert d["stats"]["avg_overall"] is not None
    assert len(d["rating_distribution"]) >= 1
    assert any("TEST_feedback" in (f.get("comment") or "") for f in d["recent_feedback"])


# ── Chat ─────────────────────────────────────────────────────────────────────
def test_chat_with_product(s):
    r = s.post(
        f"{BASE_URL}/api/chat",
        json={
            "productId": "prod_001",
            "messages": [{"role": "user", "content": "What are the allergens?"}],
        },
        timeout=60,
    )
    assert r.status_code == 200
    assert isinstance(r.json().get("reply"), str)
    assert len(r.json()["reply"]) > 0


def test_chat_no_product(s):
    r = s.post(
        f"{BASE_URL}/api/chat",
        json={"messages": [{"role": "user", "content": "hello"}]},
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert "scan" in body["reply"].lower()
    assert body.get("fallback") is True


# ── Open Food Facts (network-dependent) ──────────────────────────────────────
def test_barcode_openfoodfacts(s):
    r = s.get(f"{BASE_URL}/api/product/barcode/737628064502", timeout=30)
    assert r.status_code in (200, 502)
    if r.status_code == 200:
        p = r.json()["product"]
        assert p["id"].startswith("of_")
