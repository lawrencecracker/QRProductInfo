import React, { useEffect, useMemo, useRef, useState, useCallback, createContext, useContext } from "react";
import axios from "axios";
import { Html5Qrcode } from "html5-qrcode";
import QRCodeLib from "qrcode";
import { jsPDF } from "jspdf";
import {
  ScanLine, Sun, Moon, Monitor, Home as HomeIcon, Package, BarChart3, ArrowLeft,
  Sparkles, Send, Download, Share2, Copy, MapPin, Calendar, Tag, Leaf, Award,
  AlertTriangle, BookOpen, Archive, QrCode, Camera, X, Star, Image as ImageIcon,
  Mic, MicOff, Check, ChevronRight, Loader2, Gift, TrendingUp, Smile, Meh, Frown,
  Globe, Box, MessageSquare, ClipboardList, ExternalLink, LogIn, LogOut, Settings,
  Plus, Edit3, Trash2, Mail, Phone, User as UserIcon,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip as RTooltip,
  PieChart, Pie,
} from "recharts";
import { HOME, PRODUCT, DASHBOARD, AUTH, ADMIN } from "@/constants/testIds";

const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
const QR_PREFIX = "QRCONNECT:v1";

// ─── Auth ──────────────────────────────────────────────────────────────────
const AuthCtx = createContext(null);
function useAuth() { return useContext(AuthCtx); }
function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("vera_token") || null);
  const [me, setMe] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!token) { setMe(null); setLoaded(true); return; }
    axios.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setMe(r.data.manufacturer))
      .catch(() => { localStorage.removeItem("vera_token"); setToken(null); setMe(null); })
      .finally(() => setLoaded(true));
  }, [token]);

  const login = async (email, password) => {
    const r = await axios.post(`${API}/auth/login`, { email, password });
    localStorage.setItem("vera_token", r.data.token);
    setToken(r.data.token); setMe(r.data.manufacturer);
    return r.data.manufacturer;
  };
  const register = async (email, password, brand_name) => {
    const r = await axios.post(`${API}/auth/register`, { email, password, brand_name });
    localStorage.setItem("vera_token", r.data.token);
    setToken(r.data.token); setMe(r.data.manufacturer);
    return r.data.manufacturer;
  };
  const logout = () => { localStorage.removeItem("vera_token"); setToken(null); setMe(null); };

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  return <AuthCtx.Provider value={{ token, me, loaded, login, register, logout, authHeaders }}>{children}</AuthCtx.Provider>;
}

// ─── Theme ────────────────────────────────────────────────────────────────
function useTheme() {
  const [mode, setMode] = useState(() => localStorage.getItem("theme") || "auto");
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = mode === "dark" || (mode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", dark);
    };
    apply();
    localStorage.setItem("theme", mode);
    if (mode === "auto") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [mode]);
  return [mode, setMode];
}

// ─── QR helpers ───────────────────────────────────────────────────────────
function buildQrPayload(p) {
  if (!p) return "";
  const fromOf = typeof p.id === "string" && p.id.startsWith("of_") ? p.id.slice(3) : null;
  const barcode = p.barcode || fromOf;
  if (barcode) return `${QR_PREFIX};barcode=${encodeURIComponent(barcode)}`;
  if (p.batch_id) return `${QR_PREFIX};batch=${encodeURIComponent(p.batch_id)}`;
  return `${QR_PREFIX};id=${encodeURIComponent(p.id)}`;
}
function parseQrPayload(t) {
  const text = String(t || "").trim();
  if (!text) return null;
  if (/^QRCONNECT:v1;/i.test(text)) {
    const out = {};
    for (const part of text.replace(/^QRCONNECT:v1;/i, "").split(";").filter(Boolean)) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const k = part.slice(0, eq).toLowerCase();
      const v = decodeURIComponent(part.slice(eq + 1));
      if (k === "id") out.productId = v;
      else if (k === "batch") out.batchId = v;
      else if (k === "barcode") out.barcode = v;
    }
    return Object.keys(out).length ? out : null;
  }
  try {
    if (/^https?:\/\//i.test(text)) {
      const u = new URL(text);
      const productId = u.searchParams.get("productId");
      const batchId = u.searchParams.get("batchId");
      const barcode = u.searchParams.get("barcode");
      if (productId || batchId || barcode) return { productId, batchId, barcode };
    }
  } catch {}
  if (/^prod_/i.test(text) || /^of_\d+$/i.test(text)) return { productId: text };
  if (/^\d{8,14}$/.test(text)) return { barcode: text };
  if (/^BATCH-/i.test(text)) return { batchId: text };
  return null;
}

// ─── Auth Modal ───────────────────────────────────────────────────────────
function AuthModal({ onClose, initialMode = "login" }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [brand, setBrand] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true); setError("");
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, brand);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not sign you in.");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm anim-fade-up" onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit} className="card-luxe w-full max-w-sm p-6 relative">
        <button type="button" data-testid={AUTH.closeBtn} onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full hover:bg-accent flex items-center justify-center"><X className="w-4 h-4" /></button>
        <div className="text-[11px] uppercase tracking-[0.22em] text-primary font-semibold">{mode === "login" ? "Manufacturer sign in" : "Create your brand"}</div>
        <h2 className="font-display text-3xl mt-2">{mode === "login" ? "Welcome back" : "Join Vera"}</h2>
        <p className="text-sm text-muted-foreground mt-1">{mode === "login" ? "Access your products and live insights." : "Publish products and own your customer relationship."}</p>

        {mode === "login" && (
          <div className="mt-4 px-3 py-2 rounded-lg bg-secondary/60 text-xs text-muted-foreground">
            Demo: <span className="font-mono">demo@vera.app / demo1234</span>
          </div>
        )}

        <div className="mt-5 space-y-3">
          {mode === "register" && (
            <div>
              <label className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Brand name</label>
              <input data-testid={AUTH.brandInput} value={brand} onChange={e => setBrand(e.target.value)} required placeholder="PureEarth Foods"
                className="mt-1 w-full bg-secondary/60 border hairline rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:bg-card" />
            </div>
          )}
          <div>
            <label className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Email</label>
            <input data-testid={AUTH.emailInput} type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@brand.com"
              className="mt-1 w-full bg-secondary/60 border hairline rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:bg-card" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Password</label>
            <input data-testid={AUTH.passwordInput} type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} placeholder="••••••••"
              className="mt-1 w-full bg-secondary/60 border hairline rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:bg-card" />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <button data-testid={AUTH.submitBtn} type="submit" disabled={busy}
          className="mt-5 w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg shadow-primary/25 inline-flex items-center justify-center gap-2 disabled:opacity-60 hover:translate-y-[-1px] transition-transform">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (mode === "login" ? "Sign in" : "Create account")}
        </button>

        <button data-testid={AUTH.toggleModeBtn} type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
          className="mt-3 w-full text-center text-sm text-muted-foreground hover:text-primary">
          {mode === "login" ? "Don't have an account? Create one →" : "Already a brand on Vera? Sign in →"}
        </button>
      </form>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────
function Header({ mode, setMode, onHome, onSignIn }) {
  const { me, logout } = useAuth();
  const cycle = () => setMode(mode === "light" ? "dark" : mode === "dark" ? "auto" : "light");
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  return (
    <header className="sticky top-0 z-40 glass-strong">
      <div className="mx-auto max-w-6xl px-5 lg:px-8 py-4 flex items-center gap-4">
        <button onClick={onHome} className="flex items-center gap-3 group">
          <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-[hsl(var(--gold))] flex items-center justify-center text-primary-foreground font-display text-xl shadow-lg">
            V
            <span className="absolute -inset-1 rounded-xl bg-primary/20 blur-md -z-10 group-hover:bg-primary/40 transition-colors" />
          </div>
          <div className="text-left">
            <div className="font-display text-xl leading-none tracking-tight">Vera</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mt-1">Product Intelligence</div>
          </div>
        </button>
        <div className="ml-auto flex items-center gap-2">
          {me ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex flex-col items-end leading-tight">
                <span className="text-xs font-semibold">{me.brand_name}</span>
                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Signed in</span>
              </div>
              <button data-testid={HOME.signOutBtn} onClick={logout} title="Sign out"
                className="w-10 h-10 rounded-full border hairline flex items-center justify-center hover:bg-accent transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button data-testid={HOME.signInBtn} onClick={onSignIn}
              className="hidden sm:inline-flex items-center gap-2 px-4 h-10 rounded-full border-2 border-primary text-primary text-sm font-semibold hover:bg-primary hover:text-primary-foreground transition-colors">
              <LogIn className="w-4 h-4" /> Manufacturer
            </button>
          )}
          <button
            data-testid={HOME.themeToggle}
            onClick={cycle}
            title={`Theme: ${mode}`}
            className="w-10 h-10 rounded-full border hairline flex items-center justify-center hover:bg-accent transition-colors"
            aria-label="toggle theme"
          >
            <Icon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

// ─── Nav Bar ──────────────────────────────────────────────────────────────
function NavBar({ screen, navTo }) {
  const { me } = useAuth();
  const items = [
    { key: "home", icon: HomeIcon, label: "Home", id: HOME.navHome },
    { key: "product", icon: Package, label: "Product", id: HOME.navProduct },
    { key: "dashboard", icon: BarChart3, label: "Insights", id: HOME.navDashboard },
  ];
  if (me) items.push({ key: "admin", icon: Settings, label: "Admin", id: HOME.navAdmin });
  const cols = items.length === 4 ? "grid-cols-4" : "grid-cols-3";
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 glass-strong border-t" >
      <div className={`mx-auto max-w-md px-4 py-2 pb-6 grid ${cols} gap-1`}>
        {items.map(({ key, icon: Icon, label, id }) => {
          const active = screen === key;
          return (
            <button key={key} data-testid={id} onClick={() => navTo(key)} className="flex flex-col items-center justify-center py-2 rounded-xl">
              <span className={`flex items-center justify-center w-9 h-9 rounded-full transition-all ${active ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}>
                <Icon className="w-4 h-4" />
              </span>
              <span className={`mt-1 text-[10px] uppercase tracking-[0.16em] ${active ? "text-primary font-semibold" : "text-muted-foreground"}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Home Screen ─────────────────────────────────────────────────────────
function HomeScreen({ onPickProduct, onPayload }) {
  const [products, setProducts] = useState(null);
  const [paste, setPaste] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const scannerRef = useRef(null);

  useEffect(() => {
    axios.get(`${API}/products`).then(r => setProducts(r.data.products || [])).catch(() => setError("Could not reach the server."));
  }, []);

  const startScan = async () => {
    setScanning(true);
    setError("");
    setTimeout(async () => {
      try {
        if (!scannerRef.current) scannerRef.current = new Html5Qrcode("qr-reader");
        await scannerRef.current.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => { stopScan(); onPayload(decoded); },
          () => {}
        );
      } catch (e) { setScanning(false); setError("Camera not available: " + (e?.message || e)); }
    }, 80);
  };
  const stopScan = async () => {
    setScanning(false);
    try { if (scannerRef.current?.isScanning) await scannerRef.current.stop(); } catch {}
  };
  useEffect(() => () => { stopScan(); }, []);

  const submitPaste = () => { if (paste.trim()) { onPayload(paste.trim()); setPaste(""); } };

  return (
    <div className="relative mx-auto max-w-3xl px-5 lg:px-8 pt-8 pb-28">
      {/* Hero */}
      <section className="relative card-luxe p-7 lg:p-10 overflow-hidden anim-fade-up">
        <div className="ambient-glow" />
        <div className="relative">
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-primary font-semibold">
            <Sparkles className="w-3 h-3" /> Trust on every label
          </span>
          <h1 className="font-display text-4xl lg:text-5xl leading-[1.05] mt-4">
            Scan once.<br/>Know <span className="text-gradient italic">everything.</span>
          </h1>
          <p className="text-muted-foreground mt-4 max-w-md leading-relaxed">
            A QR-powered intelligence layer for modern products — traceability, nutrition, sustainability, AI answers and direct consumer feedback in one elegant experience.
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <button data-testid={HOME.scanBtn} onClick={scanning ? stopScan : startScan} className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/25 hover:translate-y-[-1px] transition-transform">
              <ScanLine className="w-4 h-4" />
              {scanning ? "Stop scanner" : "Scan product QR"}
            </button>
            <span className="inline-flex items-center gap-2 px-4 py-3 rounded-full border text-sm text-muted-foreground hairline">
              <QrCode className="w-3.5 h-3.5" /> QRCONNECT:v1 payload
            </span>
          </div>

          {scanning && (
            <div className="mt-5 rounded-2xl border hairline overflow-hidden bg-black/5 dark:bg-black/40">
              <div id="qr-reader" className="w-full min-h-[260px]" />
              <button data-testid={HOME.scanStopBtn} onClick={stopScan} className="w-full py-2.5 text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground border-t hairline">
                <X className="inline w-3 h-3 mr-1" /> Close camera
              </button>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <input
              data-testid={HOME.qrPasteInput}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitPaste()}
              placeholder="Paste QR text (QRCONNECT:v1;id=…)"
              className="flex-1 bg-secondary/60 border hairline rounded-full px-5 py-3 text-sm outline-none focus:border-primary focus:bg-card transition-colors"
            />
            <button data-testid={HOME.qrPasteLoadBtn} onClick={submitPaste} className="px-5 py-3 rounded-full border-2 border-primary text-primary text-sm font-semibold hover:bg-primary hover:text-primary-foreground transition-colors">Load</button>
          </div>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </div>
      </section>

      {/* Trust strip */}
      <section className="mt-6 grid grid-cols-3 gap-3">
        {[
          { i: Leaf, l: "Traceable", v: "Farm to shelf" },
          { i: Sparkles, l: "AI Assistant", v: "Powered by AI" },
          { i: TrendingUp, l: "Live Insight", v: "Real-time signal" },
        ].map(({ i: Icon, l, v }, idx) => (
          <div key={idx} className="card-luxe p-4 flex flex-col gap-1 anim-fade-up" style={{ animationDelay: `${idx * 80}ms` }}>
            <Icon className="w-4 h-4 text-primary" />
            <div className="text-sm font-semibold mt-1">{l}</div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{v}</div>
          </div>
        ))}
      </section>

      {/* Demo products */}
      <section className="mt-10">
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Collection</div>
            <h2 className="font-display text-2xl mt-1">Featured products</h2>
          </div>
          <span className="text-xs text-muted-foreground">Tap to explore</span>
        </div>
        <div data-testid={HOME.demoList} className="grid sm:grid-cols-2 gap-4">
          {products === null && Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card-luxe p-4 flex gap-3"><div className="w-16 h-16 rounded-xl shimmer" /><div className="flex-1 space-y-2"><div className="h-3 w-2/3 shimmer rounded" /><div className="h-3 w-1/2 shimmer rounded" /></div></div>
          ))}
          {products?.map((p, i) => (
            <button key={p.id} onClick={() => onPickProduct(p.id)} className="card-luxe p-4 flex items-center gap-4 text-left lift anim-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="w-16 h-16 rounded-xl overflow-hidden bg-secondary flex-shrink-0 ring-1 ring-border">
                {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <Box className="w-6 h-6 text-muted-foreground m-auto mt-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs uppercase tracking-[0.16em] text-primary font-semibold">{p.brand}</div>
                <div className="font-medium truncate mt-0.5">{p.name}</div>
                <div className="text-xs text-muted-foreground truncate">{p.category}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Stars ────────────────────────────────────────────────────────────────
function StarRow({ label, value, onChange, testId }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm">{label}</div>
        <div className="text-xs text-muted-foreground tabular-nums">{value || 0}/5</div>
      </div>
      <div className="flex gap-1.5" data-testid={testId}>
        {[1,2,3,4,5].map(n => (
          <button key={n} type="button" onClick={() => onChange(n)} className="star-btn">
            <Star className={`w-7 h-7 ${value >= n ? "fill-[hsl(var(--gold))] text-[hsl(var(--gold))]" : "text-border"}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Product Screen ──────────────────────────────────────────────────────
function ProductScreen({ productKey, onBack, onShareDashboard }) {
  const [product, setProduct] = useState(null);
  const [tab, setTab] = useState("info");
  const [error, setError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  // Chat
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatRef = useRef(null);

  // Feedback
  const [ratings, setRatings] = useState({ overall: 0, taste: 0, texture: 0, appearance: 0 });
  const [comment, setComment] = useState("");
  const [improvements, setImprovements] = useState("");
  const [buyAgain, setBuyAgain] = useState(true);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [voiceBlob, setVoiceBlob] = useState(null);
  const [voiceUrl, setVoiceUrl] = useState("");
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  useEffect(() => {
    setProduct(null); setError(""); setTab("info"); setSuccess(null);
    setRatings({ overall: 0, taste: 0, texture: 0, appearance: 0 });
    setComment(""); setImprovements(""); setBuyAgain(true);
    setPhoto(null); setPhotoPreview(""); setVoiceBlob(null); setVoiceUrl("");
    setContactEmail(""); setContactPhone("");
    const params = new URLSearchParams();
    if (productKey.productId) params.set("productId", productKey.productId);
    if (productKey.batchId) params.set("batchId", productKey.batchId);
    if (productKey.barcode) params.set("barcode", productKey.barcode);
    axios.get(`${API}/product?${params}`)
      .then(r => setProduct(r.data.product))
      .catch(e => setError(e?.response?.data?.error || e?.response?.data?.detail || "Failed to load product"));
  }, [productKey.productId, productKey.batchId, productKey.barcode]);

  const qrPayload = useMemo(() => product ? buildQrPayload(product) : "", [product]);

  useEffect(() => {
    if (!qrPayload) return;
    QRCodeLib.toDataURL(qrPayload, { width: 480, margin: 2, errorCorrectionLevel: "M" }).then(setQrDataUrl);
  }, [qrPayload]);

  // Chat
  useEffect(() => {
    if (tab !== "chat") return;
    if (chat.length === 0 && product) {
      setChat([{ role: "assistant", content: `Hi — I'm the ${product.brand} assistant. Ask anything about "${product.name}". Try ingredients, allergens, nutrition or sourcing.` }]);
    }
  }, [tab, product, chat.length]);

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [chat]);

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatInput("");
    const msgs = [...chat, { role: "user", content: text }];
    setChat(msgs);
    setChatBusy(true);
    try {
      const r = await axios.post(`${API}/chat`, { productId: product.id, batchId: product.batch_id, messages: msgs });
      setChat([...msgs, { role: "assistant", content: r.data.reply || "Sorry, I couldn't answer." }]);
    } catch {
      setChat([...msgs, { role: "assistant", content: "Sorry, I had trouble connecting. Please try again." }]);
    } finally { setChatBusy(false); }
  };

  // Feedback
  const onPhoto = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setPhoto(f);
    const reader = new FileReader();
    reader.onload = ev => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(f);
  };
  const toggleRecord = async () => {
    if (recording && recorderRef.current) {
      recorderRef.current.stop();
      setRecording(false);
      return;
    }
    if (!navigator.mediaDevices || !window.MediaRecorder) { alert("Voice recording not supported."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = e => e.data?.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        setVoiceBlob(blob);
        setVoiceUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch { alert("Microphone permission denied."); }
  };
  const submitFeedback = async () => {
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("product_id", product.id);
      fd.append("batch_id", product.batch_id || "");
      Object.entries(ratings).forEach(([k, v]) => fd.append(`${k}_rating`, v));
      fd.append("comment", comment);
      fd.append("improvements", improvements);
      fd.append("would_buy_again", buyAgain ? "true" : "false");
      if (contactEmail) fd.append("contact_email", contactEmail);
      if (contactPhone) fd.append("contact_phone", contactPhone);
      if (photo) fd.append("photo", photo);
      if (voiceBlob) fd.append("voice", voiceBlob, "voice-feedback.webm");
      const r = await axios.post(`${API}/feedback`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setSuccess(r.data);
    } catch { alert("Failed to submit. Please try again."); }
    finally { setSubmitting(false); }
  };

  // Share + PDF
  const sharePage = async () => {
    const url = `${window.location.origin}?qr=${encodeURIComponent(qrPayload)}`;
    if (navigator.share) {
      try { await navigator.share({ title: product.name, text: `${product.brand} — ${product.name}`, url }); return; } catch {}
    }
    try { await navigator.clipboard.writeText(url); alert("Share link copied!"); }
    catch { window.prompt("Share link:", url); }
  };
  const exportPdf = async () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pad = 40; let y = pad;
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.text(product.name, pad, y); y += 24;
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(120); doc.text(`${product.brand}${product.category ? "  ·  " + product.category : ""}`, pad, y); y += 20;
    doc.setTextColor(40);
    const lines = (label, value) => {
      if (!value) return;
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(label.toUpperCase(), pad, y); y += 13;
      doc.setFont("helvetica", "normal"); doc.setFontSize(11);
      const split = doc.splitTextToSize(String(value), 515);
      doc.text(split, pad, y); y += split.length * 14 + 8;
      if (y > 760) { doc.addPage(); y = pad; }
    };
    lines("Batch ID", product.batch_id);
    lines("Lot Number", product.lot_number);
    lines("Origin", product.origin_country);
    lines("Manufactured", product.manufactured_date);
    lines("Expiry", product.expiry_date);
    lines("Ingredients", product.ingredients);
    lines("Allergens", product.allergens);
    lines("Storage", product.storage_instructions);
    lines("Sustainability", product.sustainability_info);
    lines("Brand Story", product.brand_story);
    lines("Certifications", product.certifications);
    const n = product.nutritional_info;
    if (n && typeof n === "object") {
      lines("Nutrition Facts", Object.entries(n).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("  ·  "));
    }
    if (qrDataUrl) {
      if (y > 600) { doc.addPage(); y = pad; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text("QR PAYLOAD", pad, y); y += 12;
      doc.addImage(qrDataUrl, "PNG", pad, y, 140, 140); y += 150;
    }
    doc.save(`${product.id || "product"}-vera.pdf`);
  };
  const copyQr = async () => { try { await navigator.clipboard.writeText(qrPayload); alert("QR payload copied"); } catch { window.prompt("Copy:", qrPayload); } };
  const downloadQrPng = async () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a"); a.href = qrDataUrl; a.download = `qr-${product?.id || "product"}.png`; a.click();
  };

  if (error) return (
    <div className="mx-auto max-w-2xl px-5 pt-10 pb-28">
      <div className="card-luxe p-8 text-center">
        <p className="text-destructive">{error}</p>
        <button onClick={onBack} className="mt-4 text-sm underline">Go home</button>
      </div>
    </div>
  );

  if (!product) return (
    <div className="mx-auto max-w-2xl px-5 pt-10 pb-28">
      <div className="card-luxe p-8 flex items-center gap-3 justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <span className="text-muted-foreground text-sm">Loading product…</span>
      </div>
    </div>
  );

  const TABS = [
    { k: "info", l: "Overview", id: PRODUCT.tabInfo },
    { k: "nutrition", l: "Nutrition", id: PRODUCT.tabNutrition },
    { k: "chat", l: "Ask AI", id: PRODUCT.tabChat },
    { k: "feedback", l: "Review", id: PRODUCT.tabFeedback },
  ];

  return (
    <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-6 pb-28">
      {/* Top bar */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="w-10 h-10 rounded-full border hairline flex items-center justify-center hover:bg-accent transition-colors"><ArrowLeft className="w-4 h-4" /></button>
        <div className="text-xs text-muted-foreground truncate">{product.brand}</div>
        <div className="ml-auto flex gap-2">
          <button data-testid={PRODUCT.shareBtn} onClick={sharePage} className="w-10 h-10 rounded-full border hairline flex items-center justify-center hover:bg-accent transition-colors" title="Share"><Share2 className="w-4 h-4" /></button>
          <button data-testid={PRODUCT.exportPdfBtn} onClick={exportPdf} className="inline-flex items-center gap-2 px-4 h-10 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-md hover:translate-y-[-1px] transition-transform"><Download className="w-4 h-4" />PDF</button>
        </div>
      </div>

      {/* Hero */}
      <section className="relative card-luxe overflow-hidden anim-fade-up">
        <div className="relative h-56 lg:h-72 overflow-hidden bg-secondary">
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center"><Box className="w-16 h-16 text-muted-foreground" /></div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
          {product.certifications && (
            <span className="absolute top-4 right-4 glass rounded-full px-3 py-1.5 text-[11px] font-semibold text-primary">
              <Award className="inline w-3 h-3 mr-1 -mt-0.5" /> {product.certifications.split(",")[0]}
            </span>
          )}
          <div className="absolute bottom-4 left-4 right-4 text-white">
            <div className="text-[11px] uppercase tracking-[0.22em] font-semibold opacity-90">{product.category || product.brand}</div>
            <h1 className="font-display text-3xl lg:text-4xl mt-1.5 leading-tight drop-shadow">{product.name}</h1>
          </div>
        </div>
        <div className="px-5 py-4 flex flex-wrap gap-2">
          {product.origin_country && <Chip icon={MapPin}>{product.origin_country}</Chip>}
          {product.batch_id && <Chip icon={Tag}>{product.batch_id}</Chip>}
          {product.expiry_date && <Chip icon={Calendar}>Exp: {product.expiry_date}</Chip>}
        </div>
      </section>

      {/* Tabs */}
      <div className="mt-5 grid grid-cols-4 gap-1 p-1 rounded-2xl bg-secondary/70 border hairline">
        {TABS.map(t => (
          <button key={t.k} data-testid={t.id} data-state={tab === t.k ? "active" : "inactive"} onClick={() => setTab(t.k)} className="tab-pill text-sm py-2.5 rounded-xl font-medium text-muted-foreground transition-all">
            {t.l}
          </button>
        ))}
      </div>

      {tab === "info" && (
        <div className="mt-5 space-y-4">
          <Card title="Traceability" icon={MapPin}>
            <KV rows={[
              ["Batch ID", product.batch_id],
              ["Lot Number", product.lot_number],
              ["Manufactured", product.manufactured_date],
              ["Expiry Date", product.expiry_date],
              ["Origin", product.origin_country],
            ]} />
          </Card>
          {product.allergens && (
            <div className="card-luxe p-5 border-l-4 border-l-[hsl(var(--gold))] flex gap-3">
              <AlertTriangle className="w-5 h-5 text-[hsl(var(--gold))] flex-shrink-0 mt-0.5" />
              <div className="text-sm leading-relaxed">{product.allergens}</div>
            </div>
          )}
          {product.sustainability_info && (
            <Card title="Sustainability" icon={Leaf}>
              <p className="text-[14px] leading-relaxed text-muted-foreground">{product.sustainability_info}</p>
              {product.certifications && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {product.certifications.split(",").map((c, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-accent text-accent-foreground text-xs font-medium">
                      <Check className="w-3 h-3" /> {c.trim()}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          )}
          {product.brand_story && (
            <Card title="Brand Story" icon={BookOpen}>
              <p className="text-[14px] leading-relaxed text-muted-foreground">{product.brand_story}</p>
            </Card>
          )}
          {product.storage_instructions && (
            <Card title="Storage" icon={Archive}>
              <p className="text-[14px] leading-relaxed text-muted-foreground">{product.storage_instructions}</p>
            </Card>
          )}
          <Card title="Product QR Code" icon={QrCode}>
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="p-4 rounded-2xl bg-white shadow-inner ring-1 ring-border">
                {qrDataUrl ? <img src={qrDataUrl} alt="QR" className="w-44 h-44" /> : <div className="w-44 h-44 shimmer rounded" />}
              </div>
              <div className="w-full rounded-xl bg-secondary/60 border hairline p-3 font-mono text-[11px] break-all text-muted-foreground">{qrPayload}</div>
              <div className="flex gap-2 w-full">
                <button data-testid={PRODUCT.qrCopyBtn} onClick={copyQr} className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl border hairline text-sm hover:bg-accent transition-colors"><Copy className="w-3.5 h-3.5" />Copy</button>
                <button data-testid={PRODUCT.qrDownloadBtn} onClick={downloadQrPng} className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl border hairline text-sm hover:bg-accent transition-colors"><Download className="w-3.5 h-3.5" />PNG</button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === "nutrition" && (
        <div className="mt-5 space-y-4">
          {product.ingredients && (
            <Card title="Ingredients" icon={ClipboardList}>
              <p className="text-[14px] leading-[1.7] text-muted-foreground">{product.ingredients}</p>
            </Card>
          )}
          <Card title="Nutrition Facts" icon={TrendingUp}>
            <NutritionTable info={product.nutritional_info} />
          </Card>
        </div>
      )}

      {tab === "chat" && (
        <div className="mt-5 card-luxe flex flex-col h-[560px] overflow-hidden">
          <div ref={chatRef} className="flex-1 overflow-y-auto scroll-smoothy p-5 space-y-3">
            {chat.map((m, i) => (
              <div key={i} className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed ${m.role === "user" ? "ml-auto bg-primary text-primary-foreground rounded-br-md" : "bg-accent text-accent-foreground rounded-bl-md"}`}>
                {m.content}
              </div>
            ))}
            {chatBusy && (
              <div className="flex gap-1 px-4 py-2.5 w-fit bg-accent rounded-2xl rounded-bl-md">
                <span className="w-1.5 h-1.5 rounded-full bg-current pulse-dot" />
                <span className="w-1.5 h-1.5 rounded-full bg-current pulse-dot" style={{ animationDelay: ".2s" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-current pulse-dot" style={{ animationDelay: ".4s" }} />
              </div>
            )}
          </div>
          <div className="px-5 pb-3 flex flex-wrap gap-1.5">
            {["Allergens?", "Protein per serving?", "Where sourced?", "How to store?"].map(q => (
              <button key={q} onClick={() => { setChatInput(q); setTimeout(sendChat, 30); }} className="px-3 py-1.5 rounded-full text-xs border hairline text-muted-foreground hover:text-primary hover:border-primary hover:bg-accent transition-colors">{q}</button>
            ))}
          </div>
          <div className="p-3 border-t hairline flex gap-2">
            <input
              data-testid={PRODUCT.chatInput}
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendChat()}
              placeholder="Ask anything about this product…"
              className="flex-1 bg-secondary/60 border hairline rounded-full px-4 py-2.5 text-sm outline-none focus:border-primary focus:bg-card"
            />
            <button data-testid={PRODUCT.chatSendBtn} onClick={sendChat} disabled={chatBusy} className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50 hover:translate-y-[-1px] transition-transform">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {tab === "feedback" && (
        success ? <SuccessPanel success={success} onReset={() => setSuccess(null)} /> : (
          <div className="mt-5 space-y-4">
            <Card title="Rate this product" icon={Star}>
              <div className="grid sm:grid-cols-2 gap-5">
                <StarRow label="Overall" value={ratings.overall} onChange={(n) => setRatings(r => ({ ...r, overall: n }))} />
                <StarRow label="Taste" value={ratings.taste} onChange={(n) => setRatings(r => ({ ...r, taste: n }))} />
                <StarRow label="Texture" value={ratings.texture} onChange={(n) => setRatings(r => ({ ...r, texture: n }))} />
                <StarRow label="Appearance" value={ratings.appearance} onChange={(n) => setRatings(r => ({ ...r, appearance: n }))} />
              </div>
            </Card>
            <Card title="Your Feedback" icon={MessageSquare}>
              <label className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Experience</label>
              <textarea data-testid={PRODUCT.fbComment} value={comment} onChange={e => setComment(e.target.value)} placeholder="Tell us what you loved or what could be better…"
                className="mt-2 w-full bg-secondary/50 border hairline rounded-xl p-3 text-sm outline-none focus:border-primary focus:bg-card min-h-[90px]" />
              <label className="text-xs uppercase tracking-[0.16em] text-muted-foreground mt-4 block">What could we improve?</label>
              <textarea data-testid={PRODUCT.fbImprove} value={improvements} onChange={e => setImprovements(e.target.value)} placeholder="Packaging, taste, portion size…"
                className="mt-2 w-full bg-secondary/50 border hairline rounded-xl p-3 text-sm outline-none focus:border-primary focus:bg-card min-h-[70px]" />
              <div className="mt-4 flex items-center justify-between py-2 border-t hairline pt-3">
                <span className="text-sm">Would you buy again?</span>
                <button data-testid={PRODUCT.fbBuyAgain} onClick={() => setBuyAgain(v => !v)} className={`relative w-12 h-7 rounded-full transition-colors ${buyAgain ? "bg-primary" : "bg-muted"}`}>
                  <span className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${buyAgain ? "translate-x-5" : ""}`} />
                </button>
              </div>
            </Card>
            <Card title="Add a Photo" icon={ImageIcon}>
              <label className="block w-full border-2 border-dashed hairline rounded-2xl p-6 text-center cursor-pointer hover:bg-accent/40 transition-colors">
                <input data-testid={PRODUCT.fbPhoto} type="file" accept="image/*" onChange={onPhoto} className="hidden" />
                {photoPreview ? (
                  <img src={photoPreview} alt="preview" className="w-24 h-24 rounded-xl object-cover mx-auto" />
                ) : (
                  <>
                    <Camera className="w-7 h-7 mx-auto text-muted-foreground" />
                    <div className="text-xs text-muted-foreground mt-2">Tap to upload (optional)</div>
                  </>
                )}
              </label>
            </Card>
            <Card title="Voice note" icon={Mic}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <button onClick={toggleRecord} className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold transition-colors ${recording ? "bg-destructive text-destructive-foreground" : "border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground"}`}>
                  {recording ? (<><MicOff className="w-4 h-4" />Stop</>) : (<><Mic className="w-4 h-4" />Record</>)}
                </button>
                <span className="text-xs text-muted-foreground">{recording ? "Recording…" : voiceUrl ? "Voice ready ✓" : "Optional"}</span>
              </div>
              {voiceUrl && <audio src={voiceUrl} controls className="mt-3 w-full" />}
            </Card>
            <Card title="Send my coupon to (optional)" icon={Gift}>
              <p className="text-xs text-muted-foreground mb-3">Add an email or phone so we can deliver your reward directly. We won't share it with anyone else.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input data-testid={PRODUCT.fbEmail} type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="you@email.com"
                    className="w-full pl-10 pr-3 py-2.5 bg-secondary/50 border hairline rounded-xl text-sm outline-none focus:border-primary focus:bg-card" />
                </div>
                <div className="relative">
                  <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input data-testid={PRODUCT.fbPhone} type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="+91 98765 43210"
                    className="w-full pl-10 pr-3 py-2.5 bg-secondary/50 border hairline rounded-xl text-sm outline-none focus:border-primary focus:bg-card" />
                </div>
              </div>
            </Card>
            <button data-testid={PRODUCT.feedbackSubmitBtn} onClick={submitFeedback} disabled={submitting} className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-semibold shadow-lg shadow-primary/25 disabled:opacity-60 hover:translate-y-[-1px] transition-transform inline-flex items-center justify-center gap-2">
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />Submitting…</> : "Submit Feedback"}
            </button>
          </div>
        )
      )}
    </div>
  );
}

function Chip({ icon: Icon, children }) {
  return <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary text-secondary-foreground text-xs"><Icon className="w-3 h-3" />{children}</span>;
}
function Card({ title, icon: Icon, children }) {
  return (
    <section className="card-luxe p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5 text-primary" />
        <h3 className="text-[11px] uppercase tracking-[0.22em] font-semibold text-primary">{title}</h3>
      </div>
      {children}
    </section>
  );
}
function KV({ rows }) {
  return (
    <div className="divide-y hairline">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-3 py-2.5">
          <div className="text-xs text-muted-foreground uppercase tracking-[0.12em]">{k}</div>
          <div className="text-sm text-right max-w-[70%]">{v}</div>
        </div>
      ))}
    </div>
  );
}
function NutritionTable({ info }) {
  const n = typeof info === "string" ? null : (info || {});
  if (!n) return <p className="text-sm text-muted-foreground">Nutrition not available.</p>;
  const rows = [
    ["Serving Size", n.serving_size, false],
    ["Calories", n.calories, true],
    ["Total Fat", n.total_fat != null ? `${n.total_fat}g` : null, true],
    ["Saturated Fat", n.saturated_fat != null ? `${n.saturated_fat}g` : null, false],
    ["Sodium", n.sodium != null ? `${n.sodium}mg` : null, true],
    ["Total Carbs", n.total_carbs != null ? `${n.total_carbs}g` : null, true],
    ["Dietary Fiber", n.dietary_fiber != null ? `${n.dietary_fiber}g` : null, false],
    ["Total Sugars", n.total_sugars != null ? `${n.total_sugars}g` : null, false],
    ["Protein", n.protein != null ? `${n.protein}g` : null, true],
  ].filter(([, v]) => v != null);
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nutrition not available.</p>;
  return (
    <div className="divide-y hairline">
      {rows.map(([l, v, bold]) => (
        <div key={l} className={`flex justify-between py-2.5 ${bold ? "font-semibold" : ""}`}>
          <span className="text-sm">{l}</span><span className="text-sm text-muted-foreground tabular-nums">{v}</span>
        </div>
      ))}
    </div>
  );
}
function SuccessPanel({ success, onReset }) {
  return (
    <div className="mt-5 space-y-4 anim-fade-up">
      <div className="card-luxe p-8 text-center relative overflow-hidden">
        <div className="ambient-glow" />
        <div className="relative">
          <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center mx-auto"><Check className="w-7 h-7 text-primary" /></div>
          <h2 className="font-display text-3xl mt-3">Thank you</h2>
          <p className="text-muted-foreground mt-2 max-w-sm mx-auto">Your feedback helps brands build better products — and helps other consumers make informed choices.</p>
        </div>
      </div>
      {success.incentive && (
        <div className="rounded-2xl p-6 text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(158 60% 12%) 100%)" }}>
          <Gift className="absolute -top-4 -right-4 w-32 h-32 opacity-10" />
          <div className="text-xs uppercase tracking-[0.22em] opacity-90">Your incentive</div>
          <div className="font-display text-3xl mt-1">{success.incentive.value} off</div>
          <p className="text-sm opacity-80 mt-1">{success.incentive.description}</p>
          <div className="mt-4 inline-block px-4 py-2.5 rounded-xl bg-white/15 font-mono text-lg tracking-[0.18em] font-bold">{success.incentive.code}</div>
          <div className="text-xs opacity-70 mt-2">Valid until {success.incentive.expires}</div>
        </div>
      )}
      <button onClick={onReset} className="w-full py-3 rounded-2xl border-2 border-primary text-primary font-semibold hover:bg-primary hover:text-primary-foreground transition-colors">Leave another review</button>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────
function DashboardScreen({ onSignIn }) {
  const { me, authHeaders } = useAuth();
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const url = me ? `${API}/admin/products` : `${API}/products`;
    axios.get(url, { headers: authHeaders }).then(r => {
      const list = r.data.products || [];
      setProducts(list);
      if (list[0]) setSelected(list[0].id);
      else { setSelected(""); setData(null); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);
  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    axios.get(`${API}/dashboard/${selected}`)
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [selected]);

  const stats = data?.stats || {};
  const dist = data?.rating_distribution || [];
  const fullDist = [5,4,3,2,1].map(r => {
    const d = dist.find(x => x.rating === r);
    return { rating: r, count: d?.count || 0 };
  });
  const total = fullDist.reduce((a,b)=>a+b.count, 0) || 1;

  const sentimentBreakdown = useMemo(() => {
    const fb = data?.recent_feedback || [];
    let p=0, ne=0, nu=0;
    fb.forEach(f => { const s = f.sentiment_score || 0; if (s > 0.2) p++; else if (s < -0.2) ne++; else nu++; });
    return [
      { name: "Positive", value: p, color: "hsl(var(--chart-1))" },
      { name: "Neutral", value: nu, color: "hsl(var(--chart-2))" },
      { name: "Negative", value: ne, color: "hsl(var(--chart-4))" },
    ];
  }, [data]);

  return (
    <div className="mx-auto max-w-5xl px-5 lg:px-8 pt-8 pb-28">
      <div className="flex flex-wrap items-end gap-4 justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{me ? me.brand_name : "Showcase view"}</div>
          <h1 className="font-display text-3xl lg:text-4xl mt-1">Insights dashboard</h1>
        </div>
        {products.length > 0 && (
          <select
            data-testid={DASHBOARD.productSelect}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="bg-card border hairline rounded-full px-4 py-2.5 text-sm outline-none min-w-[240px] focus:border-primary"
          >
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {!me && (
        <div className="card-luxe p-5 mb-4 flex flex-wrap items-center gap-4 border-l-4 border-l-primary">
          <div className="flex-1 min-w-[220px]">
            <div className="font-semibold">Showing demo products</div>
            <p className="text-sm text-muted-foreground">Sign in as a manufacturer to see only your own products and consumer feedback.</p>
          </div>
          <button onClick={onSignIn} className="px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2"><LogIn className="w-4 h-4" />Manufacturer sign in</button>
        </div>
      )}

      {me && products.length === 0 && (
        <div className="card-luxe p-8 text-center">
          <Package className="w-8 h-8 text-muted-foreground mx-auto" />
          <h3 className="font-display text-2xl mt-3">No products yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Use the Admin tab to publish your first product.</p>
        </div>
      )}

      {loading && <div className="card-luxe p-6 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm text-muted-foreground">Loading insights…</span></div>}

      {!loading && data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="Reviews" value={stats.total_feedback ?? 0} icon={MessageSquare} />
            <Metric label="Avg rating" value={stats.avg_overall != null ? `${stats.avg_overall}★` : "—"} icon={Star} />
            <Metric label="Buy again" value={stats.buy_again_pct != null ? `${stats.buy_again_pct}%` : "—"} icon={TrendingUp} />
            <Metric label="Sentiment" value={
              stats.avg_sentiment == null ? "—" :
              stats.avg_sentiment > 0.2 ? "Positive" : stats.avg_sentiment < -0.2 ? "Negative" : "Neutral"
            } icon={stats.avg_sentiment > 0.2 ? Smile : stats.avg_sentiment < -0.2 ? Frown : Meh} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mt-4">
            <div className="lg:col-span-2 card-luxe p-5">
              <h3 className="text-[11px] uppercase tracking-[0.22em] text-primary font-semibold mb-4">Rating distribution</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={fullDist} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="rating" tickFormatter={(v) => `${v}★`} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} width={28} axisLine={false} tickLine={false} />
                    <RTooltip cursor={{ fill: "hsl(var(--accent))" }} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} />
                    <Bar dataKey="count" radius={[0, 8, 8, 0]}>
                      {fullDist.map((d, i) => (<Cell key={i} fill={d.rating >= 4 ? "hsl(var(--chart-1))" : d.rating === 3 ? "hsl(var(--chart-2))" : "hsl(var(--chart-4))"} />))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card-luxe p-5">
              <h3 className="text-[11px] uppercase tracking-[0.22em] text-primary font-semibold mb-4">Sentiment mix</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={sentimentBreakdown} dataKey="value" innerRadius={48} outerRadius={70} paddingAngle={3} strokeWidth={0}>
                      {sentimentBreakdown.map((s, i) => <Cell key={i} fill={s.color} />)}
                    </Pie>
                    <RTooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 space-y-1.5">
                {sentimentBreakdown.map(s => (
                  <div key={s.name} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                    <span className="text-muted-foreground">{s.name}</span>
                    <span className="ml-auto font-medium tabular-nums">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card-luxe p-5 mt-4">
            <h3 className="text-[11px] uppercase tracking-[0.22em] text-primary font-semibold mb-4">Recent reviews</h3>
            {(!data.recent_feedback || !data.recent_feedback.length) ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No reviews yet. Share product QRs to gather signal.</p>
            ) : (
              <ul className="divide-y hairline">
                {data.recent_feedback.map(fb => {
                  const s = fb.sentiment_score || 0;
                  const sentLabel = s > 0.2 ? "Positive" : s < -0.2 ? "Negative" : "Neutral";
                  const sentClass = s > 0.2 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : s < -0.2 ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : "bg-muted text-muted-foreground";
                  return (
                    <li key={fb.id} className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex gap-0.5">
                          {Array.from({ length: 5 }, (_, i) => <Star key={i} className={`w-3.5 h-3.5 ${i < (fb.overall_rating || 0) ? "fill-[hsl(var(--gold))] text-[hsl(var(--gold))]" : "text-border"}`} />)}
                        </div>
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium ${sentClass}`}>{sentLabel}</span>
                      </div>
                      {fb.comment && <p className="text-sm mt-2 leading-relaxed">{fb.comment}</p>}
                      <div className="text-[11px] text-muted-foreground mt-1.5 flex gap-3">
                        <span>{fb.created_at?.split("T")[0]}</span>
                        <span>{fb.would_buy_again ? "👍 Would buy again" : "👎 Might not buy again"}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, icon: Icon }) {
  return (
    <div className="card-luxe p-4 relative overflow-hidden">
      <Icon className="absolute top-3 right-3 w-4 h-4 text-muted-foreground/40" />
      <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</div>
      <div className="font-display text-3xl mt-1 text-gradient">{value}</div>
    </div>
  );
}

// ─── Admin Screen ────────────────────────────────────────────────────────
function AdminScreen({ onPickProduct }) {
  const { me, authHeaders } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // product object or "new" or null

  const load = useCallback(() => {
    setLoading(true);
    axios.get(`${API}/admin/products`, { headers: authHeaders })
      .then(r => setProducts(r.data.products || []))
      .finally(() => setLoading(false));
  }, [authHeaders]);
  useEffect(() => { if (me) load(); }, [me, load]);

  if (!me) return null;

  return (
    <div className="mx-auto max-w-5xl px-5 lg:px-8 pt-8 pb-28">
      <div className="flex flex-wrap items-end gap-4 justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{me.brand_name}</div>
          <h1 className="font-display text-3xl lg:text-4xl mt-1">Product workshop</h1>
        </div>
        <button data-testid={ADMIN.newProductBtn} onClick={() => setEditing("new")}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/25 hover:translate-y-[-1px] transition-transform">
          <Plus className="w-4 h-4" /> New product
        </button>
      </div>

      {loading ? (
        <div className="card-luxe p-6 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm text-muted-foreground">Loading your catalog…</span></div>
      ) : products.length === 0 ? (
        <div className="card-luxe p-10 text-center">
          <Box className="w-10 h-10 text-muted-foreground mx-auto" />
          <h3 className="font-display text-2xl mt-3">Your catalog is empty</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">Publish your first product to generate a Vera QR code and start gathering consumer insight.</p>
          <button onClick={() => setEditing("new")} className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold">
            <Plus className="w-4 h-4" />Create product
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map(p => (
            <div key={p.id} className="card-luxe overflow-hidden lift">
              <div className="h-32 bg-secondary relative">
                {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <Box className="w-8 h-8 text-muted-foreground absolute inset-0 m-auto" />}
              </div>
              <div className="p-4">
                <div className="text-[10px] uppercase tracking-[0.16em] text-primary font-semibold">{p.brand}</div>
                <div className="font-medium mt-0.5 truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground truncate">{p.category || "—"}</div>
                <div className="text-[11px] text-muted-foreground mt-1 font-mono">{p.batch_id || p.id}</div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => onPickProduct(p.id)} className="flex-1 py-1.5 rounded-lg border hairline text-xs hover:bg-accent inline-flex items-center justify-center gap-1"><ExternalLink className="w-3 h-3" />View</button>
                  <button onClick={() => setEditing(p)} className="flex-1 py-1.5 rounded-lg border hairline text-xs hover:bg-accent inline-flex items-center justify-center gap-1"><Edit3 className="w-3 h-3" />Edit</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ProductFormModal
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          authHeaders={authHeaders}
        />
      )}
    </div>
  );
}

function ProductFormModal({ product, onClose, onSaved, authHeaders }) {
  const isNew = !product;
  const [form, setForm] = useState({
    name: "", brand: "", category: "", batch_id: "", lot_number: "",
    manufactured_date: "", expiry_date: "", origin_country: "",
    ingredients: "", allergens: "", sustainability_info: "",
    brand_story: "", storage_instructions: "", certifications: "", image_url: "",
    nutritional_info_raw: "",
    ...(product || {}),
    nutritional_info_raw: product?.nutritional_info ? JSON.stringify(product.nutritional_info, null, 2) : "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true); setError("");
    try {
      let nutritional_info = null;
      if (form.nutritional_info_raw?.trim()) {
        try { nutritional_info = JSON.parse(form.nutritional_info_raw); }
        catch { setError("Nutrition JSON is invalid. Leave blank or use valid JSON."); setBusy(false); return; }
      }
      const payload = {
        name: form.name, brand: form.brand, category: form.category || null,
        batch_id: form.batch_id || null, lot_number: form.lot_number || null,
        manufactured_date: form.manufactured_date || null, expiry_date: form.expiry_date || null,
        origin_country: form.origin_country || null, ingredients: form.ingredients || null,
        allergens: form.allergens || null, nutritional_info,
        sustainability_info: form.sustainability_info || null, brand_story: form.brand_story || null,
        storage_instructions: form.storage_instructions || null,
        certifications: form.certifications || null, image_url: form.image_url || null,
      };
      if (isNew) await axios.post(`${API}/admin/products`, payload, { headers: authHeaders });
      else await axios.put(`${API}/admin/products/${product.id}`, payload, { headers: authHeaders });
      onSaved();
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not save product.");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm("Delete this product permanently?")) return;
    setBusy(true);
    try {
      await axios.delete(`${API}/admin/products/${product.id}`, { headers: authHeaders });
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-sm anim-fade-up" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="card-luxe w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 glass-strong px-5 py-4 flex items-center justify-between border-b hairline z-10">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-primary font-semibold">{isNew ? "Create" : "Edit"}</div>
            <h2 className="font-display text-2xl mt-0.5">{isNew ? "New product" : product.name}</h2>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-accent flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name *" testId={ADMIN.formName} value={form.name} onChange={v => update("name", v)} />
            <Field label="Brand *" testId={ADMIN.formBrand} value={form.brand} onChange={v => update("brand", v)} />
            <Field label="Category" testId={ADMIN.formCategory} value={form.category} onChange={v => update("category", v)} />
            <Field label="Batch ID" testId={ADMIN.formBatchId} value={form.batch_id} onChange={v => update("batch_id", v)} />
            <Field label="Lot number" value={form.lot_number} onChange={v => update("lot_number", v)} />
            <Field label="Origin country" value={form.origin_country} onChange={v => update("origin_country", v)} />
            <Field label="Manufactured (YYYY-MM-DD)" value={form.manufactured_date} onChange={v => update("manufactured_date", v)} />
            <Field label="Expiry (YYYY-MM-DD)" value={form.expiry_date} onChange={v => update("expiry_date", v)} />
          </div>
          <Field label="Image URL" testId={ADMIN.formImageUrl} value={form.image_url} onChange={v => update("image_url", v)} />
          <Field label="Ingredients" testId={ADMIN.formIngredients} value={form.ingredients} onChange={v => update("ingredients", v)} textarea />
          <Field label="Allergens" testId={ADMIN.formAllergens} value={form.allergens} onChange={v => update("allergens", v)} textarea />
          <Field label="Sustainability" value={form.sustainability_info} onChange={v => update("sustainability_info", v)} textarea />
          <Field label="Brand story" value={form.brand_story} onChange={v => update("brand_story", v)} textarea />
          <Field label="Storage" value={form.storage_instructions} onChange={v => update("storage_instructions", v)} textarea />
          <Field label="Certifications (comma-separated)" value={form.certifications} onChange={v => update("certifications", v)} />
          <div>
            <label className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Nutrition (JSON, optional)</label>
            <textarea value={form.nutritional_info_raw} onChange={e => update("nutritional_info_raw", e.target.value)}
              placeholder='{"serving_size":"45g","calories":180,"protein":4}'
              className="mt-1 w-full bg-secondary/50 border hairline rounded-xl px-3 py-2.5 text-sm font-mono outline-none focus:border-primary focus:bg-card min-h-[110px]" />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="sticky bottom-0 glass-strong px-5 py-3 border-t hairline flex gap-2 z-10">
          {!isNew && (
            <button data-testid={ADMIN.deleteBtn} onClick={remove} disabled={busy}
              className="px-4 py-2.5 rounded-xl text-destructive border hairline hover:bg-destructive/10 inline-flex items-center gap-2 text-sm">
              <Trash2 className="w-4 h-4" />Delete
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button data-testid={ADMIN.cancelBtn} onClick={onClose} className="px-4 py-2.5 rounded-xl border hairline text-sm">Cancel</button>
            <button data-testid={ADMIN.saveBtn} onClick={save} disabled={busy || !form.name || !form.brand}
              className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50 hover:translate-y-[-1px] transition-transform">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {isNew ? "Publish product" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, testId, textarea }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</label>
      {textarea ? (
        <textarea data-testid={testId} value={value || ""} onChange={e => onChange(e.target.value)}
          className="mt-1 w-full bg-secondary/50 border hairline rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary focus:bg-card min-h-[70px]" />
      ) : (
        <input data-testid={testId} value={value || ""} onChange={e => onChange(e.target.value)}
          className="mt-1 w-full bg-secondary/50 border hairline rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:bg-card" />
      )}
    </div>
  );
}

// ─── App ────────────────────────────────────────────────────────────────
function AppInner() {
  const [mode, setMode] = useTheme();
  const [screen, setScreen] = useState("home");
  const [productKey, setProductKey] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const { me } = useAuth();

  const onPayload = useCallback((text) => {
    const parsed = parseQrPayload(text);
    if (!parsed) { alert("Unrecognized QR code. Expected QRCONNECT product data."); return; }
    setProductKey(parsed);
    setScreen("product");
  }, []);

  const onPickProduct = (id) => { setProductKey({ productId: id }); setScreen("product"); };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qr = params.get("qr");
    const productId = params.get("productId");
    const batchId = params.get("batchId");
    const barcode = params.get("barcode");
    if (qr) onPayload(decodeURIComponent(qr));
    else if (barcode) { setProductKey({ barcode }); setScreen("product"); }
    else if (productId || batchId) { setProductKey({ productId, batchId }); setScreen("product"); }
  }, [onPayload]);

  return (
    <div className="min-h-screen relative">
      <Header mode={mode} setMode={setMode} onHome={() => setScreen("home")} onSignIn={() => setAuthOpen(true)} />
      <main className="relative z-10">
        {screen === "home" && <HomeScreen onPickProduct={onPickProduct} onPayload={onPayload} />}
        {screen === "product" && productKey && <ProductScreen productKey={productKey} onBack={() => setScreen("home")} />}
        {screen === "dashboard" && <DashboardScreen onSignIn={() => setAuthOpen(true)} />}
        {screen === "admin" && (me ? <AdminScreen onPickProduct={onPickProduct} /> : <SignInPrompt onSignIn={() => setAuthOpen(true)} />)}
      </main>
      <NavBar screen={screen} navTo={(k) => {
        if (k === "product" && !productKey) { setScreen("home"); return; }
        if (k === "admin" && !me) { setAuthOpen(true); return; }
        setScreen(k);
      }} />
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </div>
  );
}

function SignInPrompt({ onSignIn }) {
  return (
    <div className="mx-auto max-w-2xl px-5 pt-12 pb-28">
      <div className="card-luxe p-10 text-center relative overflow-hidden">
        <div className="ambient-glow" />
        <div className="relative">
          <Settings className="w-10 h-10 text-primary mx-auto" />
          <h2 className="font-display text-3xl mt-3">Manufacturer area</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">Sign in to publish your own products, generate Vera QR codes and own the consumer relationship.</p>
          <button onClick={onSignIn} className="mt-5 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/25 hover:translate-y-[-1px] transition-transform">
            <LogIn className="w-4 h-4" />Sign in
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return <AuthProvider><AppInner /></AuthProvider>;
}
