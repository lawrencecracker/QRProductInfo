"""Backend tests for iteration 2: auth + admin CRUD + feedback contact fields."""
import os
import pathlib
import uuid
import pytest
import requests
from dotenv import load_dotenv

_repo_root = pathlib.Path(__file__).resolve().parents[2]
for _candidate in [
    _repo_root / "backend" / ".env",
    _repo_root / "frontend" / ".env",
    pathlib.Path(".env"),
]:
    if _candidate.exists():
        load_dotenv(_candidate)
        break

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")

DEMO_EMAIL = "demo@vera.app"
DEMO_PW = "demo1234"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def demo_token(s):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PW}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "token" in body and isinstance(body["token"], str) and len(body["token"]) > 0
    mf = body["manufacturer"]
    assert mf["email"] == DEMO_EMAIL
    assert "brand_name" in mf and "id" in mf
    assert "password_hash" not in mf
    return body["token"]


@pytest.fixture(scope="module")
def auth_headers(demo_token):
    return {"Authorization": f"Bearer {demo_token}"}


# ── Auth ─────────────────────────────────────────────────────────────────────
def test_login_wrong_password(s):
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": DEMO_EMAIL, "password": "wrongpw"}, timeout=10)
    assert r.status_code == 401


def test_auth_me(s, auth_headers):
    r = s.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=10)
    assert r.status_code == 200
    mf = r.json()["manufacturer"]
    assert mf["email"] == DEMO_EMAIL
    assert "password_hash" not in mf


def test_auth_me_no_token(s):
    r = s.get(f"{BASE_URL}/api/auth/me", timeout=10)
    assert r.status_code == 401


def test_register_and_duplicate(s):
    email = f"test_{uuid.uuid4().hex[:8]}@vera-test.com"
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": "secret123", "brand_name": "TEST_Brand"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token"]
    assert body["manufacturer"]["email"] == email
    # Duplicate
    r2 = s.post(f"{BASE_URL}/api/auth/register",
                json={"email": email, "password": "secret123", "brand_name": "TEST_Brand"}, timeout=15)
    assert r2.status_code == 400


# ── Admin products ───────────────────────────────────────────────────────────
def test_admin_list_products(s, auth_headers):
    r = s.get(f"{BASE_URL}/api/admin/products", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    products = r.json()["products"]
    assert len(products) >= 4
    ids = {p["id"] for p in products}
    for pid in ("prod_001", "prod_002", "prod_003", "prod_004"):
        assert pid in ids


def test_admin_list_unauthorized(s):
    r = s.get(f"{BASE_URL}/api/admin/products", timeout=10)
    assert r.status_code == 401


def test_admin_create_update_delete(s, auth_headers):
    # CREATE
    r = s.post(f"{BASE_URL}/api/admin/products", headers=auth_headers,
               json={"name": "TEST_Product_A", "brand": "TEST_Brand"}, timeout=15)
    assert r.status_code == 200, r.text
    prod = r.json()["product"]
    assert prod["id"].startswith("prod_")
    assert prod["name"] == "TEST_Product_A"
    pid = prod["id"]

    # UPDATE
    r = s.put(f"{BASE_URL}/api/admin/products/{pid}", headers=auth_headers,
              json={"name": "TEST_Product_A", "brand": "TEST_Brand", "category": "Snacks"}, timeout=15)
    assert r.status_code == 200
    assert r.json()["product"]["category"] == "Snacks"

    # GET via admin list to verify persistence
    r = s.get(f"{BASE_URL}/api/admin/products", headers=auth_headers, timeout=15)
    listed = next((p for p in r.json()["products"] if p["id"] == pid), None)
    assert listed is not None and listed["category"] == "Snacks"

    # DELETE
    r = s.delete(f"{BASE_URL}/api/admin/products/{pid}", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    assert r.json().get("success") is True

    # Verify gone
    r = s.get(f"{BASE_URL}/api/admin/products", headers=auth_headers, timeout=15)
    assert pid not in {p["id"] for p in r.json()["products"]}


def test_cross_tenant_forbidden(s, auth_headers):
    # Register a new manufacturer
    email = f"other_{uuid.uuid4().hex[:8]}@vera-test.com"
    reg = s.post(f"{BASE_URL}/api/auth/register",
                 json={"email": email, "password": "secret123", "brand_name": "OtherBrand"}, timeout=15)
    assert reg.status_code == 200
    other_headers = {"Authorization": f"Bearer {reg.json()['token']}"}

    # Other tries to PUT prod_001 (owned by demo)
    r = s.put(f"{BASE_URL}/api/admin/products/prod_001", headers=other_headers,
              json={"name": "hijack", "brand": "x"}, timeout=15)
    assert r.status_code == 403

    # Other tries DELETE prod_001
    r = s.delete(f"{BASE_URL}/api/admin/products/prod_001", headers=other_headers, timeout=15)
    assert r.status_code == 403


# ── Feedback with contact fields ─────────────────────────────────────────────
def test_feedback_with_contact_fields(s):
    r = s.post(f"{BASE_URL}/api/feedback", data={
        "product_id": "prod_001",
        "overall_rating": 4,
        "comment": "good TEST_contact",
        "would_buy_again": "true",
        "contact_email": "consumer@example.com",
        "contact_phone": "+15550001111",
    }, timeout=15)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["success"] is True
    assert j["incentive"]["code"].startswith("PURE-")
