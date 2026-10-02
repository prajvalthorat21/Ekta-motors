import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
// Dynamic import used in development only
import {
  getAdminCredentials,
  verifyPassword,
  updateAdminPassword,
  createAdminSession,
  verifyAdminSession,
  revokeAdminSession,
  revokeAllAdminSessions,
  SessionInfo,
  Vehicle,
  VehicleAvailability,
  normalizeAvailability,
  formatINR
} from './server/db.js';
import {
  insertTestDriveBooking,
  insertCarBooking,
  getAllSupabaseBookings,
  updateSupabaseBookingStatus,
  deleteSupabaseBooking,
  getSupabaseStatus,
  ensureVehicleImagesBucket,
  uploadVehicleImageToSupabase,
  deleteVehicleImagesFromSupabase,
  insertVehicleIntoSupabase,
  updateVehicleInSupabase,
  deleteVehicleFromSupabase,
  getVehiclesFromSupabase,
  getSingleVehicleFromSupabase,
  getReviewsFromSupabase,
  insertReviewToSupabase,
  updateSupabaseReviewStatus,
  deleteSupabaseReview,
  upload360FramesToSupabase,
  VEHICLE_IMAGES_BUCKET,
  SUPABASE_PROJECT_ID,
  SUPABASE_URL,
  SUPABASE_KEY
} from './server/supabase.js';
import multer from 'multer';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Render health check
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Explicit allowed CORS origins
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.APP_URL,
  'https://ekta-motors.onrender.com',
  'https://ekta-motors.vercel.app'
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like same-origin browser navigations, mobile apps, curl)
    if (!origin) return callback(null, true);
    
    const isDev = process.env.NODE_ENV !== 'production';
    const isLocalhost = isDev && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'));
    const isVercel = origin.endsWith('.vercel.app');
    if (allowedOrigins.includes(origin) || isLocalhost || isVercel) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy violation: origin ${origin} is not allowed.`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'apikey']
}));

// HTTP Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Cloud Run / AI Studio Security Cookie Keepalive Middleware
app.use((req, res, next) => {
  const proxyCookie = `__SECURE-aistudio_auth_flow_may_set_cookies=true; Path=/; Secure; SameSite=None; Partitioned; Max-Age=86400`;
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [proxyCookie]);
  } else if (Array.isArray(existing)) {
    if (!existing.some((c: string) => typeof c === 'string' && c.includes('__SECURE-aistudio_auth_flow_may_set_cookies'))) {
      res.setHeader('Set-Cookie', [...existing, proxyCookie]);
    }
  } else {
    if (!String(existing).includes('__SECURE-aistudio_auth_flow_may_set_cookies')) {
      res.setHeader('Set-Cookie', [String(existing), proxyCookie]);
    }
  }
  next();
});

// Block direct access to server bundles, source maps, backend source, and private data files
app.use((req, res, next) => {
  const normalizedPath = req.path.toLowerCase();
  if (
    normalizedPath.endsWith('.map') ||
    normalizedPath.endsWith('.ts') ||
    normalizedPath.endsWith('.cjs') ||
    normalizedPath.includes('server.cjs') ||
    normalizedPath.includes('dealership.json') ||
    normalizedPath.includes('sessions.json') ||
    normalizedPath.startsWith('/server') ||
    normalizedPath.startsWith('/data')
  ) {
    return res.status(404).send('Not found');
  }
  next();
});

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static images & branding assets serving
app.use('/images', express.static(path.join(process.cwd(), 'images')));
app.use('/images', express.static(path.join(process.cwd(), 'public', 'images')));
app.use('/images', express.static(path.join(process.cwd(), 'public')));
app.use('/assets', express.static(path.join(process.cwd(), 'public', 'assets')));
app.use('/src', express.static(path.join(process.cwd(), 'src')));

app.get(['/logo.png', '/images/logo.png', '/favicon.ico', '/favicon.png'], (req, res) => {
  const logoInPublic = path.join(process.cwd(), 'public', 'logo.png');
  const logoInDist = path.join(process.cwd(), 'dist', 'logo.png');
  const file = fs.existsSync(logoInPublic) ? logoInPublic : (fs.existsSync(logoInDist) ? logoInDist : null);
  if (file) {
    res.setHeader('Content-Type', 'image/png');
    return res.sendFile(file);
  }
  res.status(404).send('Logo not found');
});

// Multer in-memory storage for handling image uploads directly to Supabase Storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 10 // Max 10 photos per upload batch
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/pjpeg', 'image/x-png'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.jfif'];
    if (allowedMimes.includes((file.mimetype || '').toLowerCase()) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type "${file.mimetype || ext}". Only JPG, JPEG, PNG, and WebP images are supported.`));
    }
  }
});

// Multer in-memory storage for 360° frame sequences (up to 72 frames, 10MB per file)
const upload360 = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 72
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/pjpeg'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
    if (allowedMimes.includes((file.mimetype || '').toLowerCase()) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type "${file.mimetype || ext}". Only JPG, JPEG, PNG, and WebP images are supported for 360 frames.`));
    }
  }
});

// Helper to parse cookies from request
function parseCookies(req: express.Request): Record<string, string> {
  const list: Record<string, string> = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      const key = parts.shift()?.trim();
      const val = parts.join('=').trim();
      if (key) list[key] = decodeURIComponent(val);
    });
  }
  return list;
}

// Helper to extract session token from Authorization header or cookie (Never query strings)
function getRequestToken(req: express.Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req);
  if (cookies['ekta_admin_token']) {
    return cookies['ekta_admin_token'];
  }
  if (cookies['ekta_admin_token_sec']) {
    return cookies['ekta_admin_token_sec'];
  }
  return undefined;
}

// Middleware to protect admin API endpoints
function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = getRequestToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized. Admin authentication required.' });
  }
  const session = verifyAdminSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
  (req as any).adminSession = session;
  next();
}

// -------------------------------------------------------------
// RATE LIMITING & ANTI-ABUSE ENGINE
// -------------------------------------------------------------
function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

interface LoginAttemptRecord {
  attempts: number;
  lockUntil: number;
  firstAttemptAt: number;
}
const loginAttemptsMap = new Map<string, LoginAttemptRecord>();

// Clean up stale login rate limit records every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttemptsMap.entries()) {
    if (now > record.lockUntil && now - record.firstAttemptAt > 15 * 60 * 1000) {
      loginAttemptsMap.delete(ip);
    }
  }
}, 10 * 60 * 1000);

function loginRateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = getClientIp(req);
  const now = Date.now();
  const record = loginAttemptsMap.get(ip);

  if (record) {
    if (now < record.lockUntil) {
      const waitMinutes = Math.ceil((record.lockUntil - now) / 60000);
      return res.status(429).json({
        success: false,
        error: `Too many failed login attempts. Please wait ${waitMinutes} minute(s) before trying again.`
      });
    }
    if (now - record.firstAttemptAt > 15 * 60 * 1000) {
      loginAttemptsMap.delete(ip);
    }
  }
  next();
}

function recordFailedLogin(req: express.Request): void {
  const ip = getClientIp(req);
  const now = Date.now();
  const record = loginAttemptsMap.get(ip) || { attempts: 0, lockUntil: 0, firstAttemptAt: now };
  record.attempts += 1;
  if (record.attempts >= 5) {
    record.lockUntil = now + 15 * 60 * 1000; // 15 minute lock
  }
  loginAttemptsMap.set(ip, record);
}

function clearLoginAttempts(req: express.Request): void {
  const ip = getClientIp(req);
  loginAttemptsMap.delete(ip);
}

// Public Forms Abuse Protection (Rate limiting: max 10 submissions per 5 minutes per IP)
const publicFormRequestsMap = new Map<string, number[]>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of publicFormRequestsMap.entries()) {
    const valid = timestamps.filter(t => now - t < 5 * 60 * 1000);
    if (valid.length === 0) {
      publicFormRequestsMap.delete(ip);
    } else {
      publicFormRequestsMap.set(ip, valid);
    }
  }
}, 5 * 60 * 1000);

function publicFormRateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = getClientIp(req);
  const now = Date.now();
  const timestamps = (publicFormRequestsMap.get(ip) || []).filter(t => now - t < 5 * 60 * 1000);

  if (timestamps.length >= 40) {
    return res.status(429).json({
      success: false,
      error: 'Too many requests. Please wait a few moments before submitting again.'
    });
  }

  timestamps.push(now);
  publicFormRequestsMap.set(ip, timestamps);
  next();
}

// ============================================================================
// HEALTH CHECK (Supports /healthz for Render and /api/health)
// ============================================================================
app.get(['/healthz', '/api/health'], (req, res) => {
  return res.json({ status: 'ok', service: 'ekta-motors', time: new Date().toISOString() });
});

// ============================================================================
// 1. AUTHENTICATION API ROUTES
// ============================================================================

// Admin Login (Protected by IP rate limiting, secure scrypt hash verification, zero bypasses)
app.post('/api/auth/login', loginRateLimiter, (req, res) => {
  const { usernameOrEmail, password, id, pass, username } = req.body || {};
  const enteredId = String(id || usernameOrEmail || username || '').trim();
  const enteredPass = String(pass !== undefined ? pass : password || '');

  if (!enteredId || !enteredPass) {
    return res.status(400).json({ success: false, error: 'Administrator ID and password are required.' });
  }

  const admin = getAdminCredentials();
  const inputIdentifier = enteredId.toLowerCase();
  const matchesUser = admin.username.toLowerCase() === inputIdentifier;
  const matchesEmail = (admin.email || '').toLowerCase() === inputIdentifier;

  if (!matchesUser && !matchesEmail) {
    recordFailedLogin(req);
    return res.status(401).json({ success: false, error: 'Invalid Administrator ID or password.' });
  }

  const isValidHash = verifyPassword(enteredPass, admin.salt, admin.passwordHash);
  if (!isValidHash) {
    recordFailedLogin(req);
    return res.status(401).json({ success: false, error: 'Invalid Administrator ID or password.' });
  }

  clearLoginAttempts(req);

  const sessionUsername = admin.username;
  const sessionEmail = admin.email || 'admin@ektamotors.com';
  const token = createAdminSession(sessionUsername, sessionEmail);

  const isProduction = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', [
    `ekta_admin_token=${token}; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly${isProduction ? '; Secure' : ''}`,
    `ekta_admin_token_sec=${token}; Path=/; Max-Age=86400; SameSite=None; Secure; Partitioned; HttpOnly`
  ]);

  return res.json({
    success: true,
    token,
    user: {
      username: sessionUsername,
      email: sessionEmail
    }
  });
});

// Admin Logout
app.post('/api/auth/logout', (req, res) => {
  const token = getRequestToken(req);
  if (token) {
    revokeAdminSession(token);
  }
  res.setHeader('Set-Cookie', [
    `ekta_admin_token=; Path=/; Max-Age=0; SameSite=Lax`,
    `ekta_admin_token_sec=; Path=/; Max-Age=0; SameSite=None; Secure; Partitioned`
  ]);
  return res.json({ success: true, message: 'Logged out successfully.' });
});

// Admin Session Status Check
app.get('/api/auth/me', (req, res) => {
  const token = getRequestToken(req);
  if (!token) {
    return res.status(401).json({ authenticated: false });
  }
  const session = verifyAdminSession(token);
  if (!session) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    user: {
      username: session.username,
      email: session.email
    }
  });
});

// Admin Change Password (Invalidates all active sessions upon change)
app.post('/api/auth/change-password', requireAdminAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Current and new password are required.' });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long.' });
  }
  const admin = getAdminCredentials();
  const isValid = verifyPassword(String(currentPassword), admin.salt, admin.passwordHash);
  if (!isValid) {
    return res.status(400).json({ success: false, error: 'Current password is incorrect.' });
  }
  updateAdminPassword(String(newPassword));

  res.setHeader('Set-Cookie', [
    `ekta_admin_token=; Path=/; Max-Age=0; SameSite=Lax`,
    `ekta_admin_token_sec=; Path=/; Max-Age=0; SameSite=None; Secure; Partitioned`
  ]);

  return res.json({
    success: true,
    message: 'Administrator password updated successfully. All existing sessions have been invalidated. Please log in with your new password.'
  });
});

// ============================================================================
// 2. PUBLIC INVENTORY & INQUIRY & REVIEWS ROUTES
// ============================================================================

// Public: Supabase Configuration (URL and Public Anon Key for Frontend Supabase Client)
app.get('/api/config/supabase', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  return res.json({
    success: true,
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_KEY,
    projectId: SUPABASE_PROJECT_ID,
    bucket: VEHICLE_IMAGES_BUCKET
  });
});

// Helper to validate vehicle ID and status for booking operations
async function validateBookingVehicle(vehicleId?: string, vehicleName?: string): Promise<{
  valid: boolean;
  vehicle?: any;
  resolvedName: string;
  error?: string;
  statusCode: number;
}> {
  const cleanId = (vehicleId || '').trim();
  const cleanName = (vehicleName || '').trim();
  const fallbackName = cleanName || 'General Inquiry';

  if (!cleanId && (!cleanName || cleanName.toLowerCase() === 'general inquiry')) {
    return { valid: true, resolvedName: fallbackName, statusCode: 200 };
  }

  let vehicle = null;
  try {
    if (cleanId) {
      vehicle = await getSingleVehicleFromSupabase(cleanId);
      if (!vehicle) {
        return {
          valid: false,
          resolvedName: fallbackName,
          error: `Vehicle with ID "${cleanId}" does not exist in our live inventory.`,
          statusCode: 404
        };
      }
    } else if (cleanName) {
      // Find matching vehicle by name from authoritative Supabase records
      const { vehicles } = await getVehiclesFromSupabase();
      vehicle = (vehicles || []).find(v => 
        (v.name && v.name.toLowerCase() === cleanName.toLowerCase()) ||
        (v.id && v.id.toLowerCase() === cleanName.toLowerCase())
      );
    }
  } catch (err: any) {
    console.error(`[Booking Validation] Error verifying vehicle:`, err.message);
    return {
      valid: false,
      resolvedName: fallbackName,
      error: `Could not verify vehicle availability: ${err.message}`,
      statusCode: 500
    };
  }

  if (vehicle) {
    const status = normalizeAvailability(vehicle.availability);
    if (status !== 'Available') {
      return {
        valid: false,
        resolvedName: vehicle.name || fallbackName,
        error: `Vehicle "${vehicle.name}" is currently marked as ${status} and is not available for bookings or test drives.`,
        statusCode: 400
      };
    }
    return {
      valid: true,
      vehicle,
      resolvedName: vehicle.name || fallbackName,
      statusCode: 200
    };
  }

  return {
    valid: true,
    resolvedName: fallbackName,
    statusCode: 200
  };
}

// Public: Get all vehicles - Supabase 'vehicles' table is the SINGLE SOURCE OF TRUTH
app.get('/api/cars', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { vehicles, error, code } = await getVehiclesFromSupabase();

    if (error) {
      console.error('[Public Cars] Supabase error:', error, 'code:', code);
      return res.status(500).json({
        success: false,
        error: `Supabase database error: ${error}`,
        code
      });
    }

    // Public showroom rule: Only 'Available' vehicles are visible
    // Reserved, Sold, and Archived vehicles are NOT shown in public available inventory
    const availableCars = (vehicles || []).filter(v => normalizeAvailability(v.availability) === 'Available');

    return res.json({
      success: true,
      count: availableCars.length,
      cars: availableCars,
      source: 'supabase'
    });
  } catch (err: any) {
    console.error('[Public Cars] Unhandled error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal error loading vehicles from Supabase'
    });
  }
});

// Public: Get single vehicle - strictly Supabase
app.get('/api/cars/:id', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const car = await getSingleVehicleFromSupabase(req.params.id);
    if (!car) {
      return res.status(404).json({ success: false, error: 'Vehicle not found.' });
    }
    return res.json({ success: true, car, source: 'supabase' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || 'Error fetching vehicle from Supabase' });
  }
});

// Dynamic Date Validation Helper: ensures dates are today or in the future
function isDateBeforeToday(dateStr?: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const trimmed = dateStr.trim();
  if (!trimmed) return false;

  // Check if string begins with YYYY-MM-DD
  const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const sYear = parseInt(match[1], 10);
    const sMonth = parseInt(match[2], 10);
    const sDay = parseInt(match[3], 10);

    const now = new Date();
    const tYear = now.getFullYear();
    const tMonth = now.getMonth() + 1;
    const tDay = now.getDate();

    if (sYear < tYear) return true;
    if (sYear > tYear) return false;
    if (sMonth < tMonth) return true;
    if (sMonth > tMonth) return false;
    return sDay < tDay;
  }

  // Fallback to native Date parser
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    return parsed < startOfToday;
  }

  return false;
}

// Input sanitizer & validator helper
function sanitizeString(val: any, maxLen: number = 255): string {
  if (val === null || val === undefined) return '';
  return String(val).trim().slice(0, maxLen);
}

// Public: Submit customer booking query / test drive request
app.post('/api/inquiries', publicFormRateLimiter, async (req, res) => {
  const { name, phone, email, service, vehicleId, vehicleName, preferredDate, preferredTime, message, city } = req.body || {};

  const cleanName = sanitizeString(name, 100);
  const cleanPhone = sanitizeString(phone, 25);
  const cleanEmail = sanitizeString(email, 120).toLowerCase();
  const cleanCity = sanitizeString(city, 80) || 'Jalna';
  const cleanMessage = sanitizeString(message, 1500);

  if (!cleanName || cleanName.length < 2) {
    return res.status(400).json({ success: false, error: 'A valid customer name is required (minimum 2 characters).' });
  }
  if (!cleanPhone || !/^[\d\s\-\+\(\)]{7,25}$/.test(cleanPhone)) {
    return res.status(400).json({ success: false, error: 'A valid contact phone number is required.' });
  }
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ success: false, error: 'A valid email address is required.' });
  }

  if (preferredDate && isDateBeforeToday(preferredDate)) {
    return res.status(400).json({ success: false, error: 'Booking date cannot be in the past. Please select today or a future date.' });
  }

  // Validate vehicle ID and availability
  const validation = await validateBookingVehicle(vehicleId, vehicleName);
  if (!validation.valid) {
    return res.status(validation.statusCode || 400).json({ success: false, error: validation.error });
  }

  const resolvedVehicleName = validation.resolvedName;
  const selectedService = sanitizeString(service, 80) || 'Showroom Test Drive';
  const isCarPurchase = selectedService.toLowerCase().includes('price') || 
                        selectedService.toLowerCase().includes('purchase') || 
                        selectedService.toLowerCase().includes('booking') ||
                        selectedService.toLowerCase().includes('quote');

  try {
    if (isCarPurchase) {
      const inserted = await insertCarBooking({
        name: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        city: cleanCity,
        vehicleName: resolvedVehicleName,
        vehicleId: validation.vehicle?.id || (vehicleId ? vehicleId.trim() : undefined),
        specialRequests: cleanMessage,
        preferredDeliveryDate: preferredDate ? sanitizeString(preferredDate, 40) : undefined
      });

      return res.status(201).json({
        success: true,
        ref: inserted.booking_ref,
        message: 'Your inquiry has been recorded in Supabase. A dealership coordinator will contact you shortly.',
        booking: {
          id: inserted.id,
          ref: inserted.booking_ref,
          createdAt: inserted.created_at
        },
        supabase: { synced: true, table: 'car_bookings', data: [inserted] }
      });
    } else {
      const inserted = await insertTestDriveBooking({
        name: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        vehicleName: resolvedVehicleName,
        vehicleId: validation.vehicle?.id || (vehicleId ? vehicleId.trim() : undefined),
        driveType: selectedService,
        preferredDate: preferredDate ? sanitizeString(preferredDate, 40) : '',
        preferredTime: preferredTime ? sanitizeString(preferredTime, 40) : '',
        city: cleanCity,
        message: cleanMessage
      });

      return res.status(201).json({
        success: true,
        ref: inserted.booking_ref,
        message: 'Your test drive request has been recorded in Supabase. Our coordinator will contact you to verify your slot.',
        booking: {
          id: inserted.id,
          ref: inserted.booking_ref,
          createdAt: inserted.created_at
        },
        supabase: { synced: true, table: 'test_drive_bookings', data: [inserted] }
      });
    }
  } catch (err: any) {
    console.error('[Supabase API Error] Inquiries route failed:', err);
    return res.status(500).json({
      success: false,
      error: `Failed to save inquiry to Supabase: ${err.message}`
    });
  }
});

// Dedicated Public Route: Test Drive Booking
app.post('/api/bookings/test-drive', publicFormRateLimiter, async (req, res) => {
  const body = req.body || {};
  const rawName = body.name || body.customer_name || body.buyer_name;
  const rawPhone = body.phone || body.customer_phone || body.phone_number;
  const rawEmail = body.email || body.customer_email || body.email_address;
  const vehicleName = body.vehicleName || body.vehicle_name || 'General Inquiry';
  const vehicleId = body.vehicleId || body.vehicle_id || '';
  const driveType = body.driveType || body.test_drive_type || body.service || 'Showroom Test Drive';
  const preferredDate = body.preferredDate || body.preferred_date || body.preferred_slot || '';
  const preferredTime = body.preferredTime || body.preferred_time || '';
  const city = body.city || 'Jalna';
  const message = body.message || body.notes || '';

  const cleanName = sanitizeString(rawName, 100);
  const cleanPhone = sanitizeString(rawPhone, 25);
  const cleanEmail = sanitizeString(rawEmail, 120).toLowerCase();
  const cleanCity = sanitizeString(city, 80) || 'Jalna';
  const cleanMessage = sanitizeString(message, 1500);

  if (!cleanName || cleanName.length < 2) {
    return res.status(400).json({ success: false, error: 'Name is required (minimum 2 characters).' });
  }
  if (!cleanPhone || !/^[\d\s\-\+\(\)]{7,25}$/.test(cleanPhone)) {
    return res.status(400).json({ success: false, error: 'A valid phone number is required.' });
  }
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ success: false, error: 'A valid email address is required.' });
  }

  if (preferredDate && isDateBeforeToday(preferredDate)) {
    return res.status(400).json({
      success: false,
      error: 'Selected test drive date cannot be in the past. Please select today or a future date.'
    });
  }

  // Authoritative vehicle validation
  const validation = await validateBookingVehicle(vehicleId, vehicleName);
  if (!validation.valid) {
    return res.status(validation.statusCode || 400).json({ success: false, error: validation.error });
  }

  try {
    const inserted = await insertTestDriveBooking({
      name: cleanName,
      phone: cleanPhone,
      email: cleanEmail,
      vehicleName: validation.resolvedName,
      vehicleId: validation.vehicle?.id || (vehicleId ? vehicleId.trim() : undefined),
      driveType: sanitizeString(driveType, 80),
      preferredDate: sanitizeString(preferredDate, 40),
      preferredTime: sanitizeString(preferredTime, 40),
      city: cleanCity,
      message: cleanMessage
    });

    return res.status(201).json({
      success: true,
      ref: inserted.booking_ref,
      message: `Test drive request submitted successfully with Ref ${inserted.booking_ref}. Our advisor will contact you to verify your schedule.`,
      booking: {
        id: inserted.id,
        ref: inserted.booking_ref,
        createdAt: inserted.created_at
      },
      supabase: {
        synced: true,
        table: 'test_drive_bookings',
        data: [inserted]
      }
    });
  } catch (err: any) {
    console.error('[Supabase API Error] Test drive insert failed:', err);
    return res.status(500).json({
      success: false,
      error: `Could not save test drive to Supabase: ${err.message}`
    });
  }
});

// Dedicated Public Route: Car Booking / Reservation Request
app.post('/api/bookings/car', publicFormRateLimiter, async (req, res) => {
  const body = req.body || {};
  const rawName = body.name || body.buyer_name || body.customer_name;
  const rawPhone = body.phone || body.customer_phone || body.phone_number;
  const rawEmail = body.email || body.customer_email || body.email_address;
  const city = body.city || 'Jalna';
  const vehicleName = body.vehicleName || body.vehicle_name || '';
  const vehicleId = body.vehicleId || body.vehicle_id || '';
  const variant = body.variant || body.trim || '';
  const fuelType = body.fuelType || body.fuel_type || '';
  const colorPreference = body.colorPreference || body.preferred_color || 'Standard';
  const paymentPreference = body.paymentPreference || body.payment_mode || 'Financing';
  const tokenAmount = body.tokenAmount || body.deposit_token || '₹25,000';
  const tradeInVehicle = body.tradeInVehicle || body.trade_in_details || '';
  const preferredDeliveryDate = body.preferredDeliveryDate || body.preferred_delivery_date || body.delivery_target || '';
  const specialRequests = body.specialRequests || body.notes || '';

  const cleanName = sanitizeString(rawName, 100);
  const cleanPhone = sanitizeString(rawPhone, 25);
  const cleanEmail = sanitizeString(rawEmail, 120).toLowerCase();
  const cleanCity = sanitizeString(city, 80) || 'Jalna';

  if (!cleanName || cleanName.length < 2) {
    return res.status(400).json({ success: false, error: 'Buyer name is required (minimum 2 characters).' });
  }
  if (!cleanPhone || !/^[\d\s\-\+\(\)]{7,25}$/.test(cleanPhone)) {
    return res.status(400).json({ success: false, error: 'A valid phone number is required.' });
  }
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ success: false, error: 'A valid email address is required.' });
  }

  if (preferredDeliveryDate && isDateBeforeToday(preferredDeliveryDate)) {
    return res.status(400).json({
      success: false,
      error: 'Target delivery date cannot be in the past. Please select today or a future date.'
    });
  }

  // Authoritative vehicle validation
  const validation = await validateBookingVehicle(vehicleId, vehicleName);
  if (!validation.valid) {
    return res.status(validation.statusCode || 400).json({ success: false, error: validation.error });
  }

  try {
    const inserted = await insertCarBooking({
      name: cleanName,
      phone: cleanPhone,
      email: cleanEmail,
      city: cleanCity,
      vehicleName: validation.resolvedName,
      vehicleId: validation.vehicle?.id || (vehicleId ? vehicleId.trim() : undefined),
      variant: sanitizeString(variant, 60),
      fuelType: sanitizeString(fuelType, 40),
      colorPreference: sanitizeString(colorPreference, 50),
      paymentPreference: sanitizeString(paymentPreference, 60),
      tokenAmount: sanitizeString(tokenAmount, 40),
      tradeInVehicle: sanitizeString(tradeInVehicle, 120),
      preferredDeliveryDate: sanitizeString(preferredDeliveryDate, 40),
      specialRequests: sanitizeString(specialRequests, 1500)
    });

    return res.status(201).json({
      success: true,
      ref: inserted.booking_ref,
      message: `Booking request recorded for ${validation.resolvedName}! Ref: ${inserted.booking_ref}. Our relationship manager will contact you to confirm reservation and allotment details.`,
      booking: {
        id: inserted.id,
        ref: inserted.booking_ref,
        createdAt: inserted.created_at
      },
      supabase: {
        synced: true,
        table: 'car_bookings',
        data: [inserted]
      }
    });
  } catch (err: any) {
    console.error('[Supabase API Error] Car booking insert failed:', err);
    return res.status(500).json({
      success: false,
      error: `Could not save car reservation to Supabase: ${err.message}`
    });
  }
});

// Public: Supabase Connection & Table Health Status
app.get('/api/supabase/status', async (req, res) => {
  try {
    const status = await getSupabaseStatus();
    return res.json({ success: true, ...status });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Public: Get approved customer reviews (Strictly Supabase)
app.get('/api/reviews', async (req, res) => {
  try {
    const token = getRequestToken(req);
    const isAdmin = Boolean(token && verifyAdminSession(token));
    const reqStatus = String(req.query.status || '').toLowerCase();
    const approvedOnly = !(isAdmin && (reqStatus === 'pending' || reqStatus === 'all' || req.query.includePending === 'true'));

    const sResult = await getReviewsFromSupabase(approvedOnly);
    if (!sResult.tableExists || sResult.error) {
      return res.status(500).json({
        success: false,
        error: sResult.error || "Could not find the table 'public.reviews' in Supabase. Please ensure the 'reviews' table is created in Supabase SQL Editor.",
        code: 'PGRST205',
        reviews: [],
        count: 0
      });
    }

    let returnedReviews = sResult.reviews;
    if (isAdmin && reqStatus === 'pending') {
      returnedReviews = returnedReviews.filter(r => (r.status || '').toLowerCase() === 'pending');
    }

    const totalReviews = returnedReviews.length;
    const verifiedCount = returnedReviews.filter(r => r.isVerified === true || r.verified === true).length;
    const averageRating = totalReviews > 0
      ? Number((returnedReviews.reduce((acc, r) => acc + (Number(r.rating) || 5), 0) / totalReviews).toFixed(1))
      : null;

    return res.json({
      success: true,
      count: totalReviews,
      reviews: returnedReviews,
      stats: {
        totalReviews,
        verifiedCount,
        averageRating
      },
      tableExists: true
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || "Could not find the table 'public.reviews' in Supabase. Please ensure the 'reviews' table is created in Supabase SQL Editor.",
      reviews: [],
      count: 0
    });
  }
});

// Public: Submit customer review (Strictly Supabase only, NO local fake/fallback data)
app.post('/api/reviews', publicFormRateLimiter, async (req, res) => {
  const { authorName, customerName, authorCar, vehicleName, vehicleId, purchaseYear, rating, quote, review } = req.body || {};
  
  const cleanName = sanitizeString(customerName || authorName, 100);
  const cleanQuote = sanitizeString(review || quote, 2000);
  const cleanCar = sanitizeString(vehicleName || authorCar, 100);
  
  if (!cleanName || cleanName.length < 2) {
    return res.status(400).json({ success: false, error: 'Customer name is required (minimum 2 characters).' });
  }

  // Strict rating validation: MUST be an integer between 1 and 5. Reject missing/invalid/non-integer.
  if (rating === undefined || rating === null || rating === '' || isNaN(Number(rating))) {
    return res.status(400).json({ success: false, error: 'A valid rating between 1 and 5 stars is required.' });
  }
  const parsedRating = Number(rating);
  if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
    return res.status(400).json({ success: false, error: 'Rating must be an integer between 1 and 5 stars.' });
  }

  if (!cleanQuote || cleanQuote.length < 5) {
    return res.status(400).json({ success: false, error: 'Review text is required (minimum 5 characters).' });
  }

  // Strictly insert into Supabase 'reviews' table as 'pending' and verified = false
  const { data, error } = await insertReviewToSupabase({
    customerName: cleanName,
    authorName: cleanName,
    rating: parsedRating,
    review: cleanQuote,
    quote: cleanQuote,
    vehicleName: cleanCar || undefined,
    authorCar: cleanCar || undefined,
    vehicleId: vehicleId ? sanitizeString(vehicleId, 60) : undefined,
    purchaseYear: purchaseYear ? sanitizeString(purchaseYear, 10) : undefined,
    status: 'pending',
    verified: false
  });

  if (error || !data) {
    const errorMsg = error?.message || "Could not find the table 'public.reviews' in Supabase. Please ensure the 'reviews' table is created in Supabase SQL Editor.";
    console.error('[Supabase Review Insert Failed]:', errorMsg);
    return res.status(500).json({
      success: false,
      error: errorMsg,
      code: error?.code || 'PGRST205'
    });
  }

  console.log(`[Supabase] Successfully saved customer review to Supabase! ID: ${data.id}`);
  return res.status(201).json({
    success: true,
    message: 'Thank you for sharing your experience.\nYour review has been submitted and is awaiting approval.',
    review: data
  });
});

// ============================================================================
// 3. ADMIN MANAGEMENT ROUTES (PROTECTED)
// ============================================================================

// Admin: Dashboard Overview Statistics
app.get('/api/admin/stats', requireAdminAuth, async (req, res) => {
  let vehicles: any[] = [];
  try {
    const { vehicles: sVehicles, error } = await getVehiclesFromSupabase();
    if (!error && Array.isArray(sVehicles)) {
      vehicles = sVehicles;
    }
  } catch (err: any) {
    console.warn('[Admin Stats] Error querying vehicles from Supabase:', err.message);
  }

  // Calculate stats strictly for available vehicles
  const availableVehiclesList = vehicles.filter(v => (v.availability || 'Available').toString().trim().toLowerCase() === 'available');
  const inventoryValue = availableVehiclesList.reduce((acc, v) => {
    let rawPrice = v.price;
    if (typeof rawPrice === 'string') {
      rawPrice = Number(rawPrice.replace(/[^0-9.-]+/g, ''));
    }
    return acc + (Number(rawPrice) || 0);
  }, 0);

  let totalInquiries = 0;
  let newInquiries = 0;
  try {
    const supabaseBookings = await getAllSupabaseBookings();
    totalInquiries = supabaseBookings.length;
    newInquiries = supabaseBookings.filter(b => (b.status || '').toLowerCase() === 'new').length;
  } catch (err: any) {
    console.warn('[Admin Stats] Supabase bookings count warning:', err.message);
  }

  let totalReviews = 0;
  let approvedReviews = 0;
  try {
    const { reviews } = await getReviewsFromSupabase(false);
    totalReviews = reviews.length;
    approvedReviews = reviews.filter(r => (r.status || '').toLowerCase() === 'approved' || (r.status || '').toLowerCase() === 'published').length;
  } catch (err: any) {
    console.warn('[Admin Stats] Supabase reviews count warning:', err.message);
  }

  const stats = {
    totalVehicles: vehicles.length,
    availableVehicles: availableVehiclesList.length,
    inventoryValue,
    inventoryValueFormatted: `₹${Number(inventoryValue).toLocaleString('en-IN')}`,
    totalInquiries,
    newInquiries,
    totalReviews,
    approvedReviews
  };

  return res.json({ success: true, stats });
});

// Admin: Get all cars directly from Supabase (Single Source of Truth)
app.get('/api/admin/cars', requireAdminAuth, async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { vehicles, error, code } = await getVehiclesFromSupabase();
    if (error) {
      console.error('[Admin Cars] Supabase error:', error, 'code:', code);
      return res.status(500).json({
        success: false,
        error: `Supabase database error: ${error}`,
        code,
        source: 'supabase-error'
      });
    }
    return res.json({
      success: true,
      count: vehicles.length,
      cars: vehicles,
      source: 'supabase'
    });
  } catch (err: any) {
    console.error('[Admin Cars] Unhandled error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal error fetching admin cars from Supabase',
      source: 'error'
    });
  }
});

// Admin: Check Supabase Storage bucket status
app.get('/api/admin/storage/status', requireAdminAuth, async (req, res) => {
  try {
    const status = await ensureVehicleImagesBucket();
    return res.json({ success: true, status });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Admin: Direct multi-photo upload to Supabase Storage
app.post(
  '/api/admin/vehicles/upload-images',
  requireAdminAuth,
  (req, res, next) => {
    upload.array('photos', 10)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: 'File size limit exceeded. Maximum image size is 10MB per file.' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ success: false, error: 'Too many files. Maximum 10 photos per upload batch.' });
        }
        return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
      } else if (err) {
        return res.status(400).json({ success: false, error: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ success: false, error: 'No photos provided for upload.' });
      }

      const vehicleId = (req.body.vehicleId || `v-${Date.now()}`).trim();

      const uploadResults = [];
      for (const file of files) {
        const uploaded = await uploadVehicleImageToSupabase(
          file.buffer,
          file.originalname,
          file.mimetype,
          vehicleId
        );
        uploadResults.push(uploaded);
      }

      return res.status(200).json({
        success: true,
        message: `Successfully uploaded ${uploadResults.length} photo(s) to Supabase Storage.`,
        uploaded: uploadResults,
        urls: uploadResults.map(u => u.publicUrl)
      });
    } catch (err: any) {
      console.error('[Admin Upload] Supabase Storage upload error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to upload photos to Supabase Storage.',
        details: err.toString()
      });
    }
  }
);

// Admin: Delete individual photo from Supabase Storage
app.delete('/api/admin/vehicles/storage-image', requireAdminAuth, async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { vehicleId, url, storagePath } = req.body || {};
    if (!url && !storagePath) {
      return res.status(400).json({ success: false, error: 'Photo URL or storage path is required for deletion.' });
    }

    const target = url || storagePath;
    const result = await deleteVehicleImagesFromSupabase(vehicleId, [target]);
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('[Admin Storage] Error deleting image from Supabase Storage:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to delete photo from storage.' });
  }
});

// Admin: Upload 360° Frame Sequence (Exterior or Interior)
app.post(
  '/api/admin/cars/:id/360/:type',
  requireAdminAuth,
  (req, res, next) => {
    upload360.array('frames', 72)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: 'File size limit exceeded. Maximum image size is 10MB per 360 frame.' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ success: false, error: 'Too many frames. Maximum 72 frames per sequence batch.' });
        }
        return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
      } else if (err) {
        return res.status(400).json({ success: false, error: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const { id, type } = req.params;
    const normalizedType = String(type || '').toLowerCase();
    if (normalizedType !== 'exterior' && normalizedType !== 'interior') {
      return res.status(400).json({ success: false, error: 'Invalid 360 type. Must be "exterior" or "interior".' });
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No 360 frame images provided for upload.' });
    }

    try {
      const existing = await getSingleVehicleFromSupabase(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Vehicle not found in inventory.' });
      }

      const frameUrls = await upload360FramesToSupabase(
        files.map(f => ({ buffer: f.buffer, originalname: f.originalname, mimetype: f.mimetype })),
        id,
        normalizedType as 'exterior' | 'interior'
      );

      const updates: any = {};
      if (normalizedType === 'exterior') {
        updates.exterior_360 = frameUrls;
      } else {
        updates.interior_360 = frameUrls;
      }

      const updateRes = await updateVehicleInSupabase(id, updates);
      if (!updateRes.success) {
        return res.status(500).json({ success: false, error: updateRes.error });
      }

      return res.status(200).json({
        success: true,
        message: `Successfully uploaded ${frameUrls.length} ${normalizedType} 360° frames.`,
        type: normalizedType,
        count: frameUrls.length,
        frames: frameUrls,
        vehicle: updateRes.vehicle
      });
    } catch (err: any) {
      console.error(`[Admin 360 Upload Error]:`, err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to upload 360 frames.' });
    }
  }
);

// Admin: Delete/Clear 360° Frame Sequence (Exterior or Interior)
app.delete('/api/admin/cars/:id/360/:type', requireAdminAuth, async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { id, type } = req.params;
  const normalizedType = String(type || '').toLowerCase();
  if (normalizedType !== 'exterior' && normalizedType !== 'interior') {
    return res.status(400).json({ success: false, error: 'Invalid 360 type. Must be "exterior" or "interior".' });
  }

  try {
    const existing = await getSingleVehicleFromSupabase(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Vehicle not found in inventory.' });
    }

    const currentFrames = normalizedType === 'exterior' ? (existing.exterior360 || []) : (existing.interior360 || []);
    if (currentFrames.length > 0) {
      await deleteVehicleImagesFromSupabase(id, currentFrames);
    }

    const updates: any = {};
    if (normalizedType === 'exterior') {
      updates.exterior_360 = [];
    } else {
      updates.interior_360 = [];
    }

    const updateRes = await updateVehicleInSupabase(id, updates);
    return res.json({
      success: true,
      message: `${normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1)} 360° frames cleared from storage and database.`,
      vehicle: updateRes.vehicle
    });
  } catch (err: any) {
    console.error(`[Admin 360 Delete Error]:`, err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to delete 360 frames.' });
  }
});

// Admin: Unified Vehicle Publish to Showroom with Direct Supabase Storage Upload
// Guarantees:
// 1. Admin Authentication verified
// 2. Real image files uploaded directly to Supabase Storage bucket 'vehicle-images'
// 3. Complete vehicle record created with permanent Supabase Storage public URLs
// 4. Record saved in local DB and synced to Supabase PostgreSQL table
// 5. Always returns clean JSON (201 on success, 400/500 JSON on error, never HTML)
// 6. Prevents duplicate vehicle records from double clicks
app.post(
  ['/api/admin/cars/publish', '/api/admin/vehicles/publish'],
  requireAdminAuth,
  (req, res, next) => {
    upload.array('photos', 10)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: 'File size limit exceeded. Maximum image size is 10MB per file.' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ success: false, error: 'Too many files. Maximum 10 photos per upload batch.' });
        }
        return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
      } else if (err) {
        return res.status(400).json({ success: false, error: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      const files = req.files as Express.Multer.File[];
      const body = req.body || {};

      const brand = (body.brand || '').trim();
      const model = (body.model || '').trim();
      const variant = (body.variant || '').trim();
      const price = Number(body.price) || 0;

      if (!brand || !model || !price) {
        return res.status(400).json({
          success: false,
          error: 'Vehicle Brand (Manufacturer), Model, and Price are mandatory fields.'
        });
      }

      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Please upload at least one vehicle photo before publishing.'
        });
      }

      // Generate clean vehicleId if not provided
      const vehicleSlug = `${brand.toLowerCase()}-${model.toLowerCase()}`.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vehicle';
      const vehicleId = (body.id || body.vehicleId || `${vehicleSlug}-${Date.now().toString(36)}`).trim();

      // Duplicate prevention: If a vehicle with this ID already exists in Supabase, return it cleanly
      const existingVehicle = await getSingleVehicleFromSupabase(vehicleId);
      if (existingVehicle) {
        return res.status(200).json({
          success: true,
          message: `Vehicle "${existingVehicle.name}" is already published in showroom.`,
          vehicle: existingVehicle,
          urls: existingVehicle.images || []
        });
      }

      // Upload all real photo buffers directly to Supabase Storage 'vehicle-images' bucket
      console.log(`[Admin Publish] Uploading ${files.length} real photo(s) to Supabase Storage for vehicle "${vehicleId}"...`);
      const uploadedUrls: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const result = await uploadVehicleImageToSupabase(
          file.buffer,
          file.originalname,
          file.mimetype,
          vehicleId
        );
        if (result && result.publicUrl) {
          uploadedUrls.push(result.publicUrl);
        }
      }

      if (uploadedUrls.length === 0) {
        return res.status(500).json({
          success: false,
          error: 'Failed to upload photos to Supabase Storage. No public URLs generated.'
        });
      }

      // Process highlights list
      let highlights: string[] = [];
      if (Array.isArray(body.highlights)) {
        highlights = body.highlights;
      } else if (typeof body.highlights === 'string') {
        try {
          const parsed = JSON.parse(body.highlights);
          if (Array.isArray(parsed)) highlights = parsed;
          else highlights = body.highlights.split('\n').map((s: string) => s.trim()).filter(Boolean);
        } catch {
          highlights = body.highlights.split('\n').map((s: string) => s.trim()).filter(Boolean);
        }
      }

      const year = Number(body.year) || new Date().getFullYear();
      const name = body.name?.trim() || `${year} ${brand} ${model}${variant ? ' ' + variant : ''}`;

      const vehicleData = {
        id: vehicleId,
        name,
        brand,
        model,
        variant,
        year,
        bodyType: body.bodyType || 'SUV',
        category: (body.category || 'suv').toLowerCase(),
        price,
        kilometersDriven: body.kmDriven || body.kilometersDriven || '0 km',
        mileage: body.mileage || '',
        color: body.color || '',
        registrationDetails: body.registration || body.registrationDetails || '',
        availability: (body.availability as any) || 'Available',
        fuelType: body.fuelType || 'Petrol',
        transmission: body.transmission || 'Automatic',
        engine: body.engine || '',
        power: body.power || '',
        drivetrain: body.drivetrain || '',
        seating: body.seating || '',
        description: body.description || '',
        highlights,
        images: uploadedUrls
      };

      // Write DIRECTLY and EXCLUSIVELY to Supabase 'vehicles' table
      const insertResult = await insertVehicleIntoSupabase(vehicleData);

      if (!insertResult.success) {
        console.error('[Admin Publish Error] Supabase INSERT failed:', insertResult.error);
        // Clean up uploaded images immediately to prevent orphaned files
        if (uploadedUrls.length > 0) {
          console.warn('[Admin Publish] Rolling back uploaded photos from Supabase Storage...');
          await deleteVehicleImagesFromSupabase(vehicleId, uploadedUrls).catch(delErr => {
            console.warn('[Admin Publish] Photo rollback note:', delErr.message);
          });
        }
        return res.status(500).json({
          success: false,
          error: `Supabase INSERT failed: ${insertResult.error}`,
          code: insertResult.code
        });
      }

      console.log(`[Admin Publish] Successfully published "${insertResult.vehicle?.name}" (ID: ${insertResult.vehicle?.id}) with ${uploadedUrls.length} Supabase Storage images.`);

      return res.status(201).json({
        success: true,
        message: `Vehicle "${insertResult.vehicle?.name}" published successfully to showroom!`,
        vehicle: insertResult.vehicle,
        urls: uploadedUrls,
        supabaseSynced: true
      });
    } catch (err: any) {
      console.error('[Admin Publish Error]:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to publish vehicle to showroom.'
      });
    }
  }
);

// Admin: Add new car (JSON endpoint - strictly Supabase)
app.post('/api/admin/cars', requireAdminAuth, async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const carData = req.body || {};
    if (!carData.brand || !carData.model || !carData.price) {
      return res.status(400).json({ success: false, error: 'Vehicle Brand, Model, and Price are mandatory.' });
    }

    // Prevent duplicate records if ID is specified and already exists in Supabase
    if (carData.id) {
      const existing = await getSingleVehicleFromSupabase(carData.id);
      if (existing) {
        return res.status(200).json({
          success: true,
          message: `Vehicle "${existing.name}" is already in inventory.`,
          vehicle: existing
        });
      }
    }

    const insertResult = await insertVehicleIntoSupabase(carData);
    if (!insertResult.success) {
      console.error('[Admin Add Car Error] Supabase INSERT failed:', insertResult.error);
      return res.status(500).json({
        success: false,
        error: `Supabase database error: ${insertResult.error}`,
        code: insertResult.code
      });
    }

    return res.status(201).json({
      success: true,
      message: `Vehicle "${insertResult.vehicle?.name}" added to inventory successfully.`,
      vehicle: insertResult.vehicle,
      supabaseSynced: true
    });
  } catch (err: any) {
    console.error('[Admin Add Car Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to add vehicle.' });
  }
});

// Admin: Edit / Update existing car - strictly Supabase
app.put('/api/admin/cars/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body || {};

    const existing = await getSingleVehicleFromSupabase(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: `Vehicle with ID "${id}" not found in Supabase.` });
    }

    const updateResult = await updateVehicleInSupabase(id, updates);
    if (!updateResult.success) {
      return res.status(500).json({
        success: false,
        error: `Supabase UPDATE failed: ${updateResult.error}`,
        code: updateResult.code
      });
    }

    return res.json({
      success: true,
      message: `Vehicle "${updateResult.vehicle?.name}" updated successfully.`,
      vehicle: updateResult.vehicle
    });
  } catch (err: any) {
    console.error('[Admin Update Car Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to update vehicle.' });
  }
});

// Admin: Delete car (strictly Supabase row + Supabase Storage photos)
app.delete('/api/admin/cars/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existingVehicle = await getSingleVehicleFromSupabase(id);
    if (!existingVehicle) {
      return res.status(404).json({ success: false, error: `Vehicle with ID "${id}" not found in Supabase.` });
    }

    const vehicleImages = existingVehicle.images || [];
    const vehicleName = existingVehicle.name;

    // Remove directly from Supabase 'vehicles' table
    const deleteResult = await deleteVehicleFromSupabase(id);
    if (!deleteResult.success) {
      return res.status(500).json({ success: false, error: `Supabase DELETE failed: ${deleteResult.error}` });
    }

    // Clean up photos from Supabase Storage
    let storageCleanup = { success: true, deletedCount: 0 };
    if (vehicleImages.length > 0) {
      try {
        storageCleanup = await deleteVehicleImagesFromSupabase(id, vehicleImages);
      } catch (storageErr: any) {
        console.warn('[Admin Storage] Photo cleanup warning:', storageErr.message);
        storageCleanup = { success: false, deletedCount: 0 };
      }
    }

    return res.json({
      success: true,
      message: `Vehicle "${vehicleName}" and associated photos deleted from inventory.`,
      id,
      storageCleanup
    });
  } catch (err: any) {
    console.error('[Admin Delete Car Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to delete vehicle.' });
  }
});

// Admin: Get all customer booking queries directly from Supabase
app.get('/api/admin/inquiries', requireAdminAuth, async (req, res) => {
  try {
    const inquiries = await getAllSupabaseBookings();
    return res.json({ success: true, count: inquiries.length, inquiries });
  } catch (err: any) {
    console.error('[Admin] Error fetching inquiries from Supabase:', err);
    return res.status(500).json({ error: `Supabase database error: ${err.message}` });
  }
});

// Admin: Update booking inquiry status in Supabase
app.patch('/api/admin/inquiries/:id', requireAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body || {};

  const statusMap: Record<string, string> = {
    'new': 'New',
    'contacted': 'Contacted',
    'in progress': 'In Progress',
    'in-progress': 'In Progress',
    'confirmed': 'Confirmed',
    'completed': 'Completed',
    'cancelled': 'Cancelled',
    'rejected': 'Rejected',
    'pending confirmation': 'Pending Confirmation',
    'pending': 'Pending Confirmation'
  };

  const normalizedStatus = status ? (statusMap[status.toLowerCase()] || status) : undefined;

  const allowedStatuses = [
    'New',
    'Contacted',
    'In Progress',
    'Confirmed',
    'Completed',
    'Cancelled',
    'Rejected',
    'Pending Confirmation'
  ];
  if (normalizedStatus && !allowedStatuses.includes(normalizedStatus)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${allowedStatuses.join(', ')}` });
  }

  try {
    const result = await updateSupabaseBookingStatus(id, normalizedStatus || status, notes);
    return res.json({
      success: true,
      message: `Booking status updated to "${normalizedStatus || status}".`,
      inquiry: result.updated
    });
  } catch (err: any) {
    console.error('[Admin] Error updating booking in Supabase:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Admin: Delete booking inquiry from Supabase
app.delete('/api/admin/inquiries/:id', requireAdminAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await deleteSupabaseBooking(id);
    return res.json({
      success: true,
      message: 'Booking record deleted from Supabase.',
      id
    });
  } catch (err: any) {
    console.error('[Admin] Error deleting booking from Supabase:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Admin: Get all reviews (Strictly Supabase)
app.get('/api/admin/reviews', requireAdminAuth, async (req, res) => {
  try {
    const sRes = await getReviewsFromSupabase(false);
    if (!sRes.tableExists || sRes.error) {
      return res.status(500).json({
        success: false,
        error: sRes.error || "Could not find the table 'public.reviews' in Supabase. Please ensure the 'reviews' table is created in Supabase SQL Editor.",
        reviews: [],
        count: 0
      });
    }

    return res.json({
      success: true,
      count: sRes.reviews.length,
      reviews: sRes.reviews
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch customer reviews from Supabase.',
      reviews: [],
      count: 0
    });
  }
});

// Admin: Update review status (Approved / Pending / Hidden) in Supabase
app.patch('/api/admin/reviews/:id', requireAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!status) {
    return res.status(400).json({ success: false, error: 'Status is required.' });
  }

  // Update in Supabase
  const { success, error } = await updateSupabaseReviewStatus(id, status);
  if (!success || error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to update review status in Supabase.'
    });
  }

  return res.json({
    success: true,
    message: `Review marked as ${status}.`,
    id,
    status
  });
});

// Admin: Delete review from Supabase
app.delete('/api/admin/reviews/:id', requireAdminAuth, async (req, res) => {
  const { id } = req.params;

  // Delete from Supabase
  const { success, error } = await deleteSupabaseReview(id);
  if (!success || error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to delete review from Supabase.'
    });
  }

  return res.json({
    success: true,
    message: 'Customer review deleted from Supabase.',
    id
  });
});

// ============================================================================
// 4. FRONTEND PAGE ROUTING & VITE INTEGRATION
// ============================================================================

async function startServer() {
  // Shortcut route for /admin -> redirect to login if unauthenticated, or dashboard if authenticated
  app.get('/admin', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const token = getRequestToken(req);
    if (token && verifyAdminSession(token)) {
      return res.redirect('/admin/dashboard');
    }
    return res.redirect('/admin/login');
  });

  // Dedicated routes for owner booking queries
  app.get(['/owner/queries', '/admin/queries', '/booking-queries'], (req, res) => {
    const token = getRequestToken(req);
    if (token && verifyAdminSession(token)) {
      return res.redirect('/admin/dashboard#bookings');
    }
    return res.redirect('/?openQueries=true#owner-booking-queries');
  });

  // Admin login page route - always renders the login form (never auto-redirects to dashboard)
  app.get(['/admin/login', '/admin-login.html'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    if (process.env.NODE_ENV !== 'production') {
      req.url = '/admin-login.html';
      return next();
    }
    return res.sendFile(path.join(process.cwd(), 'dist', 'admin-login.html'));
  });

  // Admin dashboard page route - requires a valid authenticated admin session
  app.get(['/admin/dashboard', '/admin-dashboard.html'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const token = getRequestToken(req);
    if (!token || !verifyAdminSession(token)) {
      return res.redirect('/admin/login');
    }
    if (process.env.NODE_ENV !== 'production') {
      req.url = '/admin-dashboard.html';
      return next();
    }
    return res.sendFile(path.join(process.cwd(), 'dist', 'admin-dashboard.html'));
  });

  // ============================================================================
  // SEO, ROBOTS.TXT, SITEMAP.XML & DYNAMIC VEHICLE PREVIEWS
  // ============================================================================

  function escapeHtmlServer(str: string): string {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getDynamicVehicleMetaHtml(baseHtml: string, car: any, origin: string): string {
    const brand = car.brand || '';
    const model = car.model || car.name || 'Vehicle';
    const variant = car.trim || car.variant || '';
    const year = car.year || 2024;
    const fuel = car.fuelType || 'Petrol';
    const transmission = car.transmission || 'Manual';
    const priceFormatted = car.priceFormatted || (car.price ? `₹${Number(car.price).toLocaleString('en-IN')}` : '');
    const image = (Array.isArray(car.images) && car.images[0]) || `${origin}/images/logo.png`;
    const canonicalUrl = `${origin}/cars/${encodeURIComponent(car.id)}`;

    const pageTitle = `Used ${year} ${brand} ${model} ${variant} ${fuel} ${transmission} in Jalna | Ekta Motors`.replace(/\s+/g, ' ').trim();
    const metaDesc = `Certified pre-owned ${year} ${brand} ${model} ${variant} (${fuel}, ${transmission}) for sale in Jalna, Maharashtra. Price: ${priceFormatted}. Inspected with verified documentation at Ekta Motors.`.replace(/\s+/g, ' ').trim();

    const carSchema = {
      "@context": "https://schema.org",
      "@type": "Car",
      "name": `${year} ${brand} ${model} ${variant}`.trim(),
      "image": Array.isArray(car.images) && car.images.length > 0 ? car.images : [image],
      "brand": {
        "@type": "Brand",
        "name": brand
      },
      "model": model,
      "modelDate": String(year),
      "fuelType": fuel,
      "vehicleTransmission": transmission,
      "vehicleEngine": car.engine || undefined,
      "mileageFromOdometer": car.kilometersDriven ? {
        "@type": "QuantitativeValue",
        "value": car.kilometersDriven,
        "unitText": "km"
      } : undefined,
      "color": car.color || undefined,
      "offers": {
        "@type": "Offer",
        "priceCurrency": "INR",
        "price": car.price || undefined,
        "itemCondition": "https://schema.org/UsedCondition",
        "availability": normalizeAvailability(car.availability) === 'Available' ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        "seller": {
          "@type": "AutoDealer",
          "name": "Ekta Motors",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "Aurangabad Road",
            "addressLocality": "Jalna",
            "addressRegion": "Maharashtra",
            "postalCode": "431203",
            "addressCountry": "IN"
          }
        }
      }
    };

    let modified = baseHtml;
    // Replace Title
    modified = modified.replace(/<title>.*?<\/title>/i, `<title>${escapeHtmlServer(pageTitle)}</title>`);
    // Replace Description
    modified = modified.replace(/<meta\s+name=["']description["']\s+content=["'][^"']*["']/i, `<meta name="description" content="${escapeHtmlServer(metaDesc)}"`);
    // Replace Canonical
    modified = modified.replace(/<link\s+rel=["']canonical["']\s+href=["'][^"']*["']\s*\/?>/i, `<link rel="canonical" href="${canonicalUrl}" />`);
    // Replace Open Graph Tags
    modified = modified.replace(/<meta\s+property=["']og:title["']\s+content=["'][^"']*["']/i, `<meta property="og:title" content="${escapeHtmlServer(pageTitle)}"`);
    modified = modified.replace(/<meta\s+property=["']og:description["']\s+content=["'][^"']*["']/i, `<meta property="og:description" content="${escapeHtmlServer(metaDesc)}"`);
    modified = modified.replace(/<meta\s+property=["']og:url["']\s+content=["'][^"']*["']/i, `<meta property="og:url" content="${canonicalUrl}"`);
    modified = modified.replace(/<meta\s+property=["']og:image["']\s+content=["'][^"']*["']/i, `<meta property="og:image" content="${image}"`);
    // Replace Twitter Card Tags
    modified = modified.replace(/<meta\s+name=["']twitter:title["']\s+content=["'][^"']*["']/i, `<meta name="twitter:title" content="${escapeHtmlServer(pageTitle)}"`);
    modified = modified.replace(/<meta\s+name=["']twitter:description["']\s+content=["'][^"']*["']/i, `<meta name="twitter:description" content="${escapeHtmlServer(metaDesc)}"`);
    modified = modified.replace(/<meta\s+name=["']twitter:image["']\s+content=["'][^"']*["']/i, `<meta name="twitter:image" content="${image}"`);

    // Inject Vehicle JSON-LD Structured Data & Preload ID script before </head>
    const injection = `
    <!-- Vehicle Structured Data (Schema.org/Car) -->
    <script type="application/ld+json">
    ${JSON.stringify(carSchema, null, 2)}
    </script>
    <script>
      window.__PRELOADED_VEHICLE_ID__ = ${JSON.stringify(car.id)};
    </script>
  </head>`;
    modified = modified.replace(/<\/head>/i, injection);

    return modified;
  }

  // Production robots.txt
  app.get('/robots.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const origin = process.env.PUBLIC_ORIGIN || 'https://ekta-motors.vercel.app';
    const robotsTxt = `User-agent: *
Allow: /
Allow: /cars/
Allow: /images/
Allow: /assets/
Allow: /styles.css
Allow: /script.js
Allow: /site.webmanifest
Disallow: /admin
Disallow: /admin/
Disallow: /admin-login.html
Disallow: /admin-dashboard.html
Disallow: /api/
Disallow: /data/
Disallow: /src/

Sitemap: ${origin}/sitemap.xml
`;
    return res.send(robotsTxt);
  });

  // Dynamic XML Sitemap
  app.get('/sitemap.xml', async (req, res) => {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    try {
      const origin = process.env.PUBLIC_ORIGIN || 'https://ekta-motors.vercel.app';
      const { vehicles } = await getVehiclesFromSupabase();
      const available = (vehicles || []).filter(v => normalizeAvailability(v.availability) === 'Available');
      const now = new Date().toISOString().split('T')[0];

      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
      xml += `  <url>\n`;
      xml += `    <loc>${origin}/</loc>\n`;
      xml += `    <lastmod>${now}</lastmod>\n`;
      xml += `    <changefreq>daily</changefreq>\n`;
      xml += `    <priority>1.0</priority>\n`;
      xml += `  </url>\n`;

      for (const car of available) {
        const lastModDate = car.updatedAt ? new Date(car.updatedAt).toISOString().split('T')[0] : now;
        xml += `  <url>\n`;
        xml += `    <loc>${origin}/cars/${encodeURIComponent(car.id)}</loc>\n`;
        xml += `    <lastmod>${lastModDate}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `    <priority>0.8</priority>\n`;
        xml += `  </url>\n`;
      }

      xml += `</urlset>`;
      return res.send(xml);
    } catch (err: any) {
      console.error('[Sitemap Error]:', err);
      return res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    }
  });

  // Web App Manifest
  app.get(['/site.webmanifest', '/manifest.json'], (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    const manifestPath = path.join(process.cwd(), 'public', 'site.webmanifest');
    if (fs.existsSync(manifestPath)) {
      return res.sendFile(manifestPath);
    }
    return res.json({
      name: "Ekta Motors | Quality Pre-Owned Cars Jalna",
      short_name: "Ekta Motors",
      start_url: "/",
      display: "standalone",
      background_color: "#050811",
      theme_color: "#0f172a"
    });
  });

  // Dynamic Vehicle Detail Pages with Full SEO Previews
  app.get(['/cars/:id', '/vehicle/:id'], async (req, res, next) => {
    const carId = req.params.id;
    try {
      const car = await getSingleVehicleFromSupabase(carId);
      if (!car || normalizeAvailability(car.availability) !== 'Available') {
        const notFoundPath = path.join(process.cwd(), 'dist', '404.html');
        const rootNotFound = path.join(process.cwd(), 'public', '404.html');
        const fileToServe = fs.existsSync(notFoundPath) ? notFoundPath : (fs.existsSync(rootNotFound) ? rootNotFound : path.join(process.cwd(), '404.html'));
        if (fs.existsSync(fileToServe)) {
          return res.status(404).sendFile(fileToServe);
        }
        return res.status(404).send('Vehicle not found');
      }

      const distIndex = path.join(process.cwd(), 'dist', 'index.html');
      const rootIndex = path.join(process.cwd(), 'index.html');
      const templatePath = fs.existsSync(distIndex) ? distIndex : rootIndex;
      const baseHtml = fs.readFileSync(templatePath, 'utf-8');

      const origin = process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
      const renderedHtml = getDynamicVehicleMetaHtml(baseHtml, car, origin);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(renderedHtml);
    } catch (err: any) {
      console.error('[Vehicle SEO Route Error]:', err);
      return next();
    }
  });

  // Dedicated 404 Route
  app.get(['/404', '/404.html'], (req, res) => {
    const notFoundPath = path.join(process.cwd(), 'dist', '404.html');
    const rootNotFound = path.join(process.cwd(), 'public', '404.html');
    const fileToServe = fs.existsSync(notFoundPath) ? notFoundPath : (fs.existsSync(rootNotFound) ? rootNotFound : path.join(process.cwd(), '404.html'));
    if (fs.existsSync(fileToServe)) {
      return res.status(404).sendFile(fileToServe);
    }
    return res.status(404).send('Page not found');
  });

  // Explicit catch-all for /api/* routes that do not match any endpoint
  // Guarantees clean JSON response and prevents falling through to Vite's SPA index.html
  app.all('/api/*', (req, res) => {
    return res.status(404).json({
      error: `API endpoint not found: ${req.method} ${req.path}`,
      success: false
    });
  });

  // Global Express JSON Error Handler for API routes
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('[Global Express Error Handler]:', err);
    if (res.headersSent) {
      return next(err);
    }
    if (req.path.startsWith('/api/')) {
      const statusCode = err.status || err.statusCode || (err.name === 'MulterError' ? 400 : 500);
      return res.status(statusCode).json({
        error: err.message || 'Internal server error',
        success: false
      });
    }
    next(err);
  });

  const httpServer = http.createServer(app);

  const isDevelopment = process.env.NODE_ENV === 'development';

  if (isDevelopment) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server: httpServer,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));

    // Ensure client JS and CSS files are served properly with correct MIME types
    app.get(['/script.js', '/admin.js', '/admin-dashboard.js', '/styles.css'], (req, res) => {
      const distFile = path.join(distPath, req.path);
      if (fs.existsSync(distFile)) {
        return res.sendFile(distFile);
      }
      const rootFile = path.join(process.cwd(), req.path);
      if (fs.existsSync(rootFile)) {
        res.setHeader('Content-Type', req.path.endsWith('.js') ? 'application/javascript' : 'text/css');
        return res.sendFile(rootFile);
      }
      res.status(404).send('File not found');
    });

    app.get('*', (req, res) => {
      if (req.path === '/' || req.path === '/index.html') {
        return res.sendFile(path.join(distPath, 'index.html'));
      }
      const notFoundPath = path.join(distPath, '404.html');
      const rootNotFound = path.join(process.cwd(), 'public', '404.html');
      const fileToServe = fs.existsSync(notFoundPath) ? notFoundPath : (fs.existsSync(rootNotFound) ? rootNotFound : path.join(process.cwd(), '404.html'));
      if (fs.existsSync(fileToServe)) {
        return res.status(404).sendFile(fileToServe);
      }
      return res.status(404).sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Ekta Motors Server running on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export { app, startServer };
export default app;
