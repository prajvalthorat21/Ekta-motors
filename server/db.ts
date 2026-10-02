import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type VehicleAvailability = 'Available' | 'Reserved' | 'Sold' | 'Archived';

export function normalizeAvailability(raw?: string | null): VehicleAvailability {
  if (!raw) return 'Available';
  const val = String(raw).trim().toLowerCase();
  if (val === 'available' || val === 'in stock' || val === 'active' || val === 'ready') {
    return 'Available';
  }
  if (val === 'reserved' || val === 'booked' || val === 'pending') {
    return 'Reserved';
  }
  if (val === 'sold' || val === 'delivered') {
    return 'Sold';
  }
  if (val === 'archived' || val === 'hidden' || val === 'draft' || val === 'unavailable') {
    return 'Archived';
  }
  return 'Available';
}

export interface Vehicle {
  id: string;
  name: string;
  brand: string;
  model: string;
  variant: string;
  year: number;
  category: string;
  fuelType: string;
  bodyType: string;
  price: number;
  priceFormatted: string;
  monthlyEst: string;
  trim: string;
  badge: string;
  badgeClass: string;
  mileage: string;
  kilometersDriven: string;
  range?: string;
  engine: string;
  power: string;
  transmission: string;
  drivetrain: string;
  seating: string;
  fuelEconomy: string;
  acceleration: string;
  topSpeed: string;
  safetyRating: string;
  warranty: string;
  color: string;
  registrationDetails: string;
  description: string;
  highlights: string[];
  images: string[];
  exterior360?: string[];
  interior360?: string[];
  availability: VehicleAvailability;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  authorName: string;
  authorCar?: string;
  purchaseYear?: number | string;
  rating: number;
  quote: string;
  avatar?: string;
  isVerified?: boolean;
  status: 'Approved' | 'Pending' | 'Hidden';
  createdAt: string;
}

export interface AdminCredential {
  username: string;
  email: string;
  salt: string;
  passwordHash: string;
}

export interface DealershipDatabase {
  reviews: Review[];
  admin: AdminCredential;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'dealership.json');

// Helper to format INR
export function formatINR(val: number): string {
  const num = Math.round(val);
  return '₹' + num.toLocaleString('en-IN');
}

export function calculateMonthlyEMI(price: number): string {
  // Assuming 20% down, 8.5% APR over 60 months
  const principal = price * 0.8;
  const monthlyRate = 0.085 / 12;
  const months = 60;
  const emi = (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
  return `${formatINR(Math.round(emi))}/mo*`;
}

// Hash password using crypto scrypt
export function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
  const finalSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, finalSalt, 64).toString('hex');
  return { salt: finalSalt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

// Memory cache of DB
let dbCache: DealershipDatabase | null = null;

// Active session tokens: token -> { username, expiresAt }
export interface SessionInfo {
  username: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}
const activeSessions: Map<string, SessionInfo> = new Map();
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
let sessionsLoaded = false;

function ensureSessionsLoaded(): void {
  if (sessionsLoaded) return;
  sessionsLoaded = true;
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      const now = Date.now();
      for (const [token, info] of Object.entries(parsed as Record<string, SessionInfo>)) {
        if (info && info.expiresAt > now) {
          activeSessions.set(token, info);
        }
      }
    }
  } catch (err) {
    console.warn('[Session Storage] Warning reading sessions.json:', err);
  }
}

function persistSessions(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const obj: Record<string, SessionInfo> = {};
    const now = Date.now();
    for (const [token, info] of activeSessions.entries()) {
      if (info && info.expiresAt > now) {
        obj[token] = info;
      }
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Session Storage] Warning saving sessions.json:', err);
  }
}

function ensureDbLoaded(): DealershipDatabase {
  if (dbCache) return dbCache;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(DB_FILE)) {
    try {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && parsed.admin) {
        dbCache = {
          admin: parsed.admin,
          reviews: Array.isArray(parsed.reviews) ? parsed.reviews : []
        };
        return dbCache;
      }
    } catch (err) {
      console.error('Error reading dealership.json, re-initializing', err);
    }
  }

  // Initialize DB
  const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'ekta0001';
  const { salt, hash } = hashPassword(defaultAdminPassword);

  dbCache = {
    reviews: [],
    admin: {
      username: 'ektamotors',
      email: 'admin@ektamotors.com',
      salt,
      passwordHash: hash
    }
  };

  saveDb();
  return dbCache;
}

function saveDb(): void {
  if (!dbCache) return;
  try {
    const tempFile = DB_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(dbCache, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('Failed to save dealership.json', err);
  }
}

// -------------------------------------------------------------
// SESSIONS & AUTH
// -------------------------------------------------------------
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export function createAdminSession(username: string, email: string): string {
  ensureSessionsLoaded();
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  activeSessions.set(token, {
    username,
    email,
    createdAt: now,
    expiresAt: now + SESSION_DURATION_MS
  });
  persistSessions();
  return token;
}

export function verifyAdminSession(token?: string): SessionInfo | null {
  if (!token) return null;
  ensureSessionsLoaded();
  const session = activeSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    persistSessions();
    return null;
  }
  return session;
}

export function revokeAdminSession(token: string): void {
  ensureSessionsLoaded();
  activeSessions.delete(token);
  persistSessions();
}

export function revokeAllAdminSessions(): void {
  ensureSessionsLoaded();
  activeSessions.clear();
  persistSessions();
}

export function getAdminCredentials(): AdminCredential {
  const db = ensureDbLoaded();
  return db.admin;
}

export function updateAdminPassword(newPassword: string): boolean {
  const db = ensureDbLoaded();
  const { salt, hash } = hashPassword(newPassword);
  db.admin.salt = salt;
  db.admin.passwordHash = hash;
  saveDb();
  revokeAllAdminSessions();
  return true;
}

// -------------------------------------------------------------
// VEHICLE NAME NORMALIZATION (SHARED HELPER)
// -------------------------------------------------------------
export function getCleanVehicleName(car: {
  name?: string;
  brand?: string;
  model?: string;
  variant?: string;
  trim?: string;
  year?: number | string;
}): string {
  if (!car) return "Certified Vehicle";
  const brand = String(car.brand || "").trim();
  const year = car.year ? String(car.year).trim() : "";
  const model = String(car.model || "").trim();
  const variant = String(car.variant || car.trim || "").trim();
  let rawName = String(car.name || "").trim();

  // If no name provided, synthesize from brand, model, variant
  if (!rawName) {
    const parts: string[] = [];
    if (brand) parts.push(brand);
    if (model) parts.push(model);
    if (variant && !model.toLowerCase().includes(variant.toLowerCase())) parts.push(variant);
    rawName = parts.join(" ").trim() || "Certified Vehicle";
  }

  let cleaned = rawName;

  // 1. Strip year from car name so it is NEVER part of the vehicle name
  if (year) {
    cleaned = cleaned.replace(new RegExp(`^${year}\\s*[-–/:]?\\s*`, "i"), "");
    cleaned = cleaned.replace(new RegExp(`\\b${year}\\b\\s*[-–/:]?\\s*`, "gi"), " ");
  }
  cleaned = cleaned.replace(/^(?:19|20)\d{2}\s*[-–/:]?\\s*/, "");
  cleaned = cleaned.replace(/\b(?:19|20)\d{2}\b\s*[-–/:]?\s*/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // 2. Brand Deduplication & Placement: Never repeat brand and don't prepend if already present
  if (brand) {
    const brandEscaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const leadingBrandRegex = new RegExp(`^(?:${brandEscaped}\\s*[-–/:]?\\s*)+`, "i");
    if (leadingBrandRegex.test(cleaned)) {
      const rest = cleaned.replace(leadingBrandRegex, "").trim();
      cleaned = rest ? `${brand} ${rest}` : brand;
    } else {
      const hasBrandInside = new RegExp(`\\b${brandEscaped}\\b`, "i").test(cleaned);
      if (!hasBrandInside) {
        cleaned = `${brand} ${cleaned}`;
      }
    }
  }

  // 3. Refine casing for automotive abbreviations and title-cased words
  cleaned = cleaned.split(/\s+/).map((word, idx) => {
    const lower = word.toLowerCase();
    if (lower === "gt") return "GT";
    if (lower === "dk") return "DK";
    if (lower === "ev") return "EV";
    if (lower === "cng") return "CNG";
    if (lower === "awd") return "AWD";
    if (lower === "fwd") return "FWD";
    if (lower === "4wd") return "4WD";
    if (lower === "at") return "AT";
    if (lower === "mt") return "MT";
    if (lower === "dct") return "DCT";
    if (lower === "line" && idx > 0) return "Line";
    if (word === lower && word.length > 1) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return word;
  }).join(" ");

  return cleaned.trim();
}
