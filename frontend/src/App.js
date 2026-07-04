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

// Prefer an explicit backend URL when provided at build time (REACT_APP_BACKEND_URL),
// otherwise use same-origin relative API paths so the app works when served from
// the backend process (recommended single-process deploy).
const REACT_BACKEND = (process.env.REACT_APP_BACKEND_URL || "").trim();
const API = REACT_BACKEND ? `${REACT_BACKEND.replace(/\/$/, "")}/api` : "/api";
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
      if (dark) root.classList.add("dark"); else root.classList.remove("dark");
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply();
    mq.addEventListener && mq.addEventListener("change", onChange);
    return () => mq.removeEventListener && mq.removeEventListener("change", onChange);
  }, [mode]);
  return { mode, setMode };
}
