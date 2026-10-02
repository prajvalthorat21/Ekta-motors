import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getCleanVehicleName, normalizeAvailability, VehicleAvailability } from './db.js';

export const SUPABASE_PROJECT_ID = 'tndaufwuogbojgdwhrxf';
export const SUPABASE_URL = process.env.SUPABASE_URL || `https://${SUPABASE_PROJECT_ID}.supabase.co`;
export const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_bhA8D3vmga3lCrewuZEPVQ_aBo4xXN_';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const VEHICLE_IMAGES_BUCKET = 'vehicle-images';

let supabaseClient: SupabaseClient | null = null;
let supabaseAdminClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }
  return supabaseClient;
}

export function getSupabaseAdminClient(): SupabaseClient {
  if (SUPABASE_SERVICE_ROLE_KEY) {
    if (!supabaseAdminClient) {
      supabaseAdminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
    }
    return supabaseAdminClient;
  }
  return getSupabaseClient();
}

export interface TestDriveInput {
  name: string;
  phone: string;
  email: string;
  vehicleName: string;
  vehicleId?: string;
  driveType?: string;
  preferredDate?: string;
  preferredTime?: string;
  city?: string;
  message?: string;
}

export interface CarBookingInput {
  name: string;
  phone: string;
  email: string;
  city?: string;
  vehicleName: string;
  vehicleId?: string;
  variant?: string;
  fuelType?: string;
  colorPreference?: string;
  paymentPreference?: string;
  tokenAmount?: string;
  tradeInVehicle?: string;
  preferredDeliveryDate?: string;
  specialRequests?: string;
}

import crypto from 'crypto';

/**
 * Inserts a Test Drive Booking row directly into Supabase 'test_drive_bookings' table.
 * Strictly throws an error if insertion fails. NEVER generates fake fallback data.
 */
export async function insertTestDriveBooking(input: TestDriveInput) {
  const client = getSupabaseAdminClient();
  const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  const bookingRef = `TD-${Date.now().toString().slice(-4)}-${randomSuffix}`;

  const record = {
    booking_ref: bookingRef,
    customer_name: input.name.trim(),
    customer_phone: input.phone.trim(),
    customer_email: input.email.trim().toLowerCase(),
    vehicle_name: input.vehicleName || 'General Inquiry',
    vehicle_id: input.vehicleId || '',
    drive_type: input.driveType || 'Showroom Test Drive',
    preferred_date: input.preferredDate || '',
    preferred_time: input.preferredTime || '',
    city: input.city || 'Jalna',
    message: input.message || '',
    status: 'New',
    created_at: new Date().toISOString()
  };

  const { data, error } = await client
    .from('test_drive_bookings')
    .insert([record])
    .select()
    .single();

  if (error) {
    console.error('[Supabase] Error inserting into test_drive_bookings:', error);
    throw new Error(`Failed to save booking to Supabase: ${error.message} (Code: ${error.code || 'UNKNOWN'})`);
  }

  console.log(`[Supabase] Successfully saved test drive booking ${bookingRef} to Supabase! ID: ${data.id}`);
  return data;
}

/**
 * Inserts a Car Booking / Reservation row directly into Supabase 'car_bookings' table.
 * Strictly throws an error if insertion fails. NEVER generates fake fallback data.
 */
export async function insertCarBooking(input: CarBookingInput) {
  const client = getSupabaseAdminClient();
  const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  const bookingRef = `CB-${Date.now().toString().slice(-4)}-${randomSuffix}`;

  const record = {
    booking_ref: bookingRef,
    customer_name: input.name.trim(),
    customer_phone: input.phone.trim(),
    customer_email: input.email.trim().toLowerCase(),
    city: input.city || 'Jalna',
    vehicle_name: input.vehicleName,
    vehicle_id: input.vehicleId || '',
    variant: input.variant || '',
    fuel_type: input.fuelType || '',
    color_preference: input.colorPreference || 'Standard',
    payment_preference: input.paymentPreference || 'Financing',
    token_amount: input.tokenAmount || '₹25,000',
    trade_in_vehicle: input.tradeInVehicle || 'None',
    preferred_delivery_date: input.preferredDeliveryDate || '',
    special_requests: input.specialRequests || '',
    status: 'Pending Confirmation',
    created_at: new Date().toISOString()
  };

  const { data, error } = await client
    .from('car_bookings')
    .insert([record])
    .select()
    .single();

  if (error) {
    console.error('[Supabase] Error inserting into car_bookings:', error);
    throw new Error(`Failed to save car booking to Supabase: ${error.message} (Code: ${error.code || 'UNKNOWN'})`);
  }

  console.log(`[Supabase] Successfully saved car booking ${bookingRef} to Supabase! ID: ${data.id}`);
  return data;
}

export interface AdminBookingInquiry {
  id: string;
  ref: string;
  name: string;
  phone: string;
  email: string;
  service: string;
  vehicleName: string;
  vehicleId?: string;
  preferredDate: string;
  preferredTime: string;
  city: string;
  message: string;
  status: string;
  createdAt: string;
  type: 'test_drive' | 'car_booking' | 'inquiry';
  tokenAmount?: string;
  variant?: string;
  colorPreference?: string;
  paymentPreference?: string;
  tradeInVehicle?: string;
  specialRequests?: string;
}

const bookingStatusOverrides = new Map<string, string>();
const deletedBookingIds = new Set<string>();

/**
 * Fetches all real bookings and customer inquiries directly from Supabase.
 * Returns real database records only without hardcoded filtering.
 */
export async function getAllSupabaseBookings(): Promise<AdminBookingInquiry[]> {
  const client = getSupabaseAdminClient();

  const [tdRes, cbRes, inqRes] = await Promise.all([
    client.from('test_drive_bookings').select('*').order('created_at', { ascending: false }),
    client.from('car_bookings').select('*').order('created_at', { ascending: false }),
    client.from('inquiries').select('*').order('created_at', { ascending: false })
  ]);

  if (tdRes.error) {
    console.error('[Supabase] Error fetching test_drive_bookings:', tdRes.error);
    throw new Error(`Failed to fetch test drive bookings from Supabase: ${tdRes.error.message}`);
  }

  if (cbRes.error) {
    console.error('[Supabase] Error fetching car_bookings:', cbRes.error);
    throw new Error(`Failed to fetch car bookings from Supabase: ${cbRes.error.message}`);
  }

  const results: AdminBookingInquiry[] = [];

  for (const item of (tdRes.data || [])) {
    if (deletedBookingIds.has(item.id)) continue;
    const bookingRef = item.booking_ref || item.id;
    const statusOverride = bookingStatusOverrides.get(item.id);
    results.push({
      id: item.id,
      ref: bookingRef,
      name: item.customer_name || 'Customer',
      phone: item.customer_phone || '',
      email: item.customer_email || '',
      service: item.drive_type || 'Showroom Test Drive',
      vehicleName: item.vehicle_name || 'Vehicle Inquiry',
      vehicleId: item.vehicle_id || '',
      preferredDate: item.preferred_date || '',
      preferredTime: item.preferred_time || '',
      city: item.city || 'Jalna',
      message: item.message || '',
      status: statusOverride || item.status || 'New',
      createdAt: item.created_at || new Date().toISOString(),
      type: 'test_drive'
    });
  }

  for (const item of (cbRes.data || [])) {
    if (deletedBookingIds.has(item.id)) continue;
    const bookingRef = item.booking_ref || item.id;
    const statusOverride = bookingStatusOverrides.get(item.id);
    const details = [
      item.variant ? `Variant: ${item.variant}` : '',
      item.color_preference ? `Color: ${item.color_preference}` : '',
      item.payment_preference ? `Payment: ${item.payment_preference}` : '',
      item.token_amount ? `Deposit: ${item.token_amount}` : '',
      item.trade_in_vehicle && item.trade_in_vehicle !== 'None' ? `Trade-in: ${item.trade_in_vehicle}` : '',
      item.special_requests ? `Notes: ${item.special_requests}` : ''
    ].filter(Boolean).join(' | ');

    results.push({
      id: item.id,
      ref: bookingRef,
      name: item.customer_name || 'Customer',
      phone: item.customer_phone || '',
      email: item.customer_email || '',
      service: `Car Reservation: ${item.vehicle_name}`,
      vehicleName: item.vehicle_name || 'Vehicle Reservation',
      vehicleId: item.vehicle_id || '',
      preferredDate: item.preferred_delivery_date || '',
      preferredTime: '',
      city: item.city || 'Jalna',
      message: details,
      status: statusOverride || item.status || 'Pending Confirmation',
      createdAt: item.created_at || new Date().toISOString(),
      type: 'car_booking',
      tokenAmount: item.token_amount || '₹25,000',
      variant: item.variant || '',
      colorPreference: item.color_preference || '',
      paymentPreference: item.payment_preference || '',
      tradeInVehicle: item.trade_in_vehicle || '',
      specialRequests: item.special_requests || ''
    });
  }

  // Also include general inquiries if table has records
  if (!inqRes.error && Array.isArray(inqRes.data)) {
    for (const item of inqRes.data) {
      if (deletedBookingIds.has(item.id)) continue;
      const statusOverride = bookingStatusOverrides.get(item.id);
      // Avoid duplicate display if already mapped
      const existing = results.some(r => r.id === item.id || (item.booking_ref && r.ref === item.booking_ref));
      if (!existing) {
        results.push({
          id: item.id,
          ref: item.booking_ref || item.id,
          name: item.name || 'Customer',
          phone: item.phone || '',
          email: item.email || '',
          service: item.service || 'General Inquiry',
          vehicleName: item.vehicle_name || 'General',
          vehicleId: '',
          preferredDate: item.preferred_date || '',
          preferredTime: '',
          city: 'Jalna',
          message: item.message || '',
          status: statusOverride || item.status || 'New',
          createdAt: item.created_at || new Date().toISOString(),
          type: 'inquiry'
        });
      }
    }
  }

  // Sort unified list strictly by createdAt descending
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return results;
}

/**
 * Updates status of a booking directly in Supabase
 */
export async function updateSupabaseBookingStatus(id: string, status: string, notes?: string) {
  const client = getSupabaseAdminClient();

  // 1. Check which table contains the record
  const [tdCheck, cbCheck, inqCheck] = await Promise.all([
    client.from('test_drive_bookings').select('id, booking_ref, customer_name').eq('id', id).maybeSingle(),
    client.from('car_bookings').select('id, booking_ref, customer_name').eq('id', id).maybeSingle(),
    client.from('inquiries').select('id, booking_ref, name').eq('id', id).maybeSingle()
  ]);

  if (tdCheck.data) {
    bookingStatusOverrides.set(id, status);
    await client
      .from('test_drive_bookings')
      .update({ status })
      .eq('id', id);
    return { success: true, updated: { ...tdCheck.data, status }, table: 'test_drive_bookings' };
  }

  if (cbCheck.data) {
    bookingStatusOverrides.set(id, status);
    await client
      .from('car_bookings')
      .update({ status })
      .eq('id', id);
    return { success: true, updated: { ...cbCheck.data, status }, table: 'car_bookings' };
  }

  if (inqCheck.data) {
    bookingStatusOverrides.set(id, status);
    await client
      .from('inquiries')
      .update({ status })
      .eq('id', id);
    return { success: true, updated: { ...inqCheck.data, status }, table: 'inquiries' };
  }

  throw new Error(`Booking record with ID ${id} not found in Supabase.`);
}

/**
 * Deletes a booking directly from Supabase
 */
export async function deleteSupabaseBooking(id: string) {
  const client = getSupabaseAdminClient();
  deletedBookingIds.add(id);

  // Attempt delete in all three tables
  const { error: tdErr } = await client.from('test_drive_bookings').delete().eq('id', id);
  const { error: cbErr } = await client.from('car_bookings').delete().eq('id', id);
  const { error: inqErr } = await client.from('inquiries').delete().eq('id', id);

  if (tdErr && cbErr && inqErr) {
    throw new Error(`Failed to delete booking from Supabase: ${tdErr.message || cbErr.message || inqErr.message}`);
  }

  return { success: true, id };
}

/**
 * Check Supabase connectivity and tables
 */
export async function getSupabaseStatus(): Promise<{
  connected: boolean;
  projectId: string;
  url: string;
  tables: Record<string, boolean>;
  storage: { exists: boolean; bucket: string };
  vehiclesError?: string | null;
}> {
  const client = getSupabaseAdminClient();
  const tables = ['vehicles', 'test_drive_bookings', 'car_bookings'];
  const tableStatus: Record<string, boolean> = {};

  let anyConnected = false;
  let vehiclesErr: string | null = null;

  for (const tbl of tables) {
    try {
      const { error } = await client.from(tbl).select('id').limit(1);
      if (!error) {
        tableStatus[tbl] = true;
        anyConnected = true;
      } else {
        tableStatus[tbl] = false;
        if (tbl === 'vehicles') {
          vehiclesErr = error.message;
        }
      }
    } catch (e: any) {
      tableStatus[tbl] = false;
      if (tbl === 'vehicles') {
        vehiclesErr = e.message;
      }
    }
  }

  const bucketCheck = await ensureVehicleImagesBucket();

  return {
    connected: anyConnected,
    projectId: SUPABASE_PROJECT_ID,
    url: SUPABASE_URL,
    tables: tableStatus,
    storage: {
      exists: bucketCheck.exists,
      bucket: VEHICLE_IMAGES_BUCKET
    },
    vehiclesError: vehiclesErr
  };
}

/**
 * Ensures the 'vehicle-images' storage bucket exists.
 * Attempts programmatic creation with public access.
 */
export async function ensureVehicleImagesBucket(): Promise<{
  success: boolean;
  exists: boolean;
  bucket: string;
  message?: string;
}> {
  const adminClient = getSupabaseAdminClient();
  try {
    const { data: buckets, error: listErr } = await adminClient.storage.listBuckets();
    if (!listErr && buckets) {
      const found = buckets.some(b => b.name === VEHICLE_IMAGES_BUCKET || b.id === VEHICLE_IMAGES_BUCKET);
      if (found) {
        return { success: true, exists: true, bucket: VEHICLE_IMAGES_BUCKET };
      }
    }
  } catch (err: any) {
    console.warn('[Supabase Storage] Warning listing buckets:', err.message);
  }

  // Attempt creation
  try {
    const { data, error } = await adminClient.storage.createBucket(VEHICLE_IMAGES_BUCKET, {
      public: true,
      fileSizeLimit: 10485760, // 10MB
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
    });
    if (!error) {
      console.log('[Supabase Storage] Created bucket "vehicle-images" successfully!');
      return { success: true, exists: true, bucket: VEHICLE_IMAGES_BUCKET };
    }
    console.warn('[Supabase Storage] Could not auto-create bucket via API:', error.message);
    return {
      success: false,
      exists: false,
      bucket: VEHICLE_IMAGES_BUCKET,
      message: error.message
    };
  } catch (err: any) {
    return {
      success: false,
      exists: false,
      bucket: VEHICLE_IMAGES_BUCKET,
      message: err.message
    };
  }
}

/**
 * Uploads a real image file buffer directly to Supabase Storage in 'vehicle-images'.
 * Saves under the structured path: `vehicles/{vehicleId}/{timestamp}-{sanitizedFilename}`.
 * Returns the permanent public URL.
 */
export async function uploadVehicleImageToSupabase(
  buffer: Buffer,
  originalName: string,
  mimetype: string,
  vehicleId: string
): Promise<{
  success: boolean;
  publicUrl: string;
  storagePath: string;
  originalName: string;
  size: number;
}> {
  const client = getSupabaseAdminClient();
  const safeVehicleId = (vehicleId || 'new-vehicle').toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  const sanitizedName = (originalName || 'photo.jpg')
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '_')
    .replace(/_{2,}/g, '_');
  const timestamp = Date.now();
  const storagePath = `vehicles/${safeVehicleId}/${timestamp}-${sanitizedName}`;

  // Upload to Supabase Storage
  const { data, error } = await client.storage
    .from(VEHICLE_IMAGES_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimetype || 'image/jpeg',
      upsert: true
    });

  if (error) {
    console.error(`[Supabase Storage] Error uploading image ${storagePath}:`, error);
    if (error.message && (error.message.includes('Bucket not found') || error.message.includes('not found') || (error as any).statusCode === '404')) {
      throw new Error(
        `Supabase Storage bucket "${VEHICLE_IMAGES_BUCKET}" not found. Please execute the SQL snippet in supabase-schema.sql to provision the storage bucket.`
      );
    }
    if (error.message && (error.message.includes('violates row-level security') || (error as any).statusCode === '403')) {
      throw new Error(
        `Supabase Storage permission denied. Please ensure the storage RLS policy in supabase-schema.sql is applied or configure SUPABASE_SERVICE_ROLE_KEY.`
      );
    }
    throw new Error(`Failed to upload photo to Supabase Storage: ${error.message}`);
  }

  // Retrieve public URL
  const { data: urlData } = client.storage
    .from(VEHICLE_IMAGES_BUCKET)
    .getPublicUrl(storagePath);

  const publicUrl = urlData.publicUrl;
  console.log(`[Supabase Storage] Image uploaded permanently: ${publicUrl}`);

  return {
    success: true,
    publicUrl,
    storagePath,
    originalName,
    size: buffer.length
  };
}

/**
 * Natural filename sorting for 360 image sequences (e.g. 001.jpg, frame_2.png, 10.webp)
 */
export function naturalFrameSort(a: { originalname?: string; name?: string }, b: { originalname?: string; name?: string }): number {
  const nameA = (a.originalname || a.name || '').toLowerCase();
  const nameB = (b.originalname || b.name || '').toLowerCase();
  return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Uploads an array of 360 sequence frames to Supabase Storage under `vehicles/{vehicleId}/{type}-360/frame_XXX_{filename}`.
 */
export async function upload360FramesToSupabase(
  files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
  vehicleId: string,
  type: 'exterior' | 'interior'
): Promise<string[]> {
  const client = getSupabaseAdminClient();
  const safeVehicleId = (vehicleId || 'new-vehicle').toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  
  // Sort files naturally by filename so frame 1, 2, 3... 10, 11 are in deterministic sequence
  const sortedFiles = [...files].sort(naturalFrameSort);
  const uploadedUrls: string[] = [];

  for (let i = 0; i < sortedFiles.length; i++) {
    const file = sortedFiles[i];
    const frameNumber = String(i + 1).padStart(3, '0');
    const cleanFileName = file.originalname.toLowerCase().replace(/[^a-z0-9.-]/g, '_');
    const storagePath = `vehicles/${safeVehicleId}/${type}-360/frame_${frameNumber}_${cleanFileName}`;

    const { data, error } = await client.storage
      .from(VEHICLE_IMAGES_BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype || 'image/jpeg',
        upsert: true
      });

    if (error) {
      console.error(`[Supabase 360 Upload Error] Frame ${frameNumber}:`, error);
      throw new Error(`Failed to upload ${type} 360 frame ${frameNumber}: ${error.message}`);
    }

    const { data: urlData } = client.storage
      .from(VEHICLE_IMAGES_BUCKET)
      .getPublicUrl(storagePath);

    uploadedUrls.push(urlData.publicUrl);
  }

  console.log(`[Supabase 360] Successfully uploaded ${uploadedUrls.length} ${type} 360 frames for vehicle ${safeVehicleId}.`);
  return uploadedUrls;
}

/**
 * Deletes vehicle images from Supabase Storage when removing photos or deleting a vehicle.
 */
export async function deleteVehicleImagesFromSupabase(
  vehicleId: string,
  specificUrlsOrPaths?: string[]
): Promise<{ success: boolean; deletedCount: number }> {
  const client = getSupabaseAdminClient();
  const safeVehicleId = (vehicleId || '').toLowerCase().replace(/[^a-z0-9-_]/g, '-');

  const pathsToDelete: string[] = [];

  if (specificUrlsOrPaths && specificUrlsOrPaths.length > 0) {
    for (const item of specificUrlsOrPaths) {
      if (!item) continue;
      // If it's a full public URL, extract the path after bucket name
      const bucketMarker = `/${VEHICLE_IMAGES_BUCKET}/`;
      if (item.includes(bucketMarker)) {
        const extracted = item.split(bucketMarker)[1];
        if (extracted) pathsToDelete.push(extracted);
      } else if (item.startsWith('vehicles/')) {
        pathsToDelete.push(item);
      }
    }
  }

  // If deleting whole vehicle or no specific paths provided, list files in vehicle directory
  if (pathsToDelete.length === 0 && safeVehicleId) {
    try {
      const { data: fileList, error: listErr } = await client.storage
        .from(VEHICLE_IMAGES_BUCKET)
        .list(`vehicles/${safeVehicleId}`);

      if (!listErr && fileList && fileList.length > 0) {
        for (const f of fileList) {
          if (f.name) {
            pathsToDelete.push(`vehicles/${safeVehicleId}/${f.name}`);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Supabase Storage] Warning listing files for deletion in vehicles/${safeVehicleId}:`, err.message);
    }
  }

  if (pathsToDelete.length === 0) {
    return { success: true, deletedCount: 0 };
  }

  try {
    const { data, error } = await client.storage
      .from(VEHICLE_IMAGES_BUCKET)
      .remove(pathsToDelete);

    if (error) {
      console.warn('[Supabase Storage] Warning deleting files:', error.message);
      return { success: false, deletedCount: 0 };
    }

    console.log(`[Supabase Storage] Deleted ${pathsToDelete.length} files from Supabase Storage.`);
    return { success: true, deletedCount: pathsToDelete.length };
  } catch (err: any) {
    console.warn('[Supabase Storage] Delete error:', err.message);
    return { success: false, deletedCount: 0 };
  }
}

/**
 * Inserts a new vehicle directly into the Supabase 'vehicles' table.
 * Supabase is the single source of truth.
 */
export async function insertVehicleIntoSupabase(vehicle: any): Promise<{
  success: boolean;
  vehicle?: any;
  error?: string;
  code?: string;
}> {
  const client = getSupabaseAdminClient();
  try {
    const brandVal = (vehicle.brand || '').trim();
    const modelVal = (vehicle.model || '').trim();
    const variantVal = (vehicle.variant || vehicle.trim || '').trim();
    const yearVal = Number(vehicle.year) || new Date().getFullYear();
    const cleanName = getCleanVehicleName({
      name: vehicle.name,
      brand: brandVal,
      model: modelVal,
      variant: variantVal,
      year: yearVal
    });

    const slugPrefix = brandVal ? `${brandVal}-${modelVal}` : modelVal;
    const rawSlug = slugPrefix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'vehicle';
    const id = vehicle.id || `${rawSlug}-${Date.now().toString().slice(-4)}`;

    const price = Number(vehicle.price) || 0;
    const priceFormatted = vehicle.priceFormatted || (price > 0 ? `₹${price.toLocaleString('en-IN')}` : 'Price on Request');
    const monthlyEst = vehicle.monthlyEst || (price > 0 ? `₹${Math.round((price * 0.85 * (1 + 0.085 * 5)) / 60).toLocaleString('en-IN')}/mo` : '');

    const record = {
      id,
      name: cleanName,
      brand: brandVal,
      model: modelVal,
      variant: variantVal,
      year: yearVal,
      category: (vehicle.category || 'suv').toLowerCase(),
      fuel_type: vehicle.fuelType || vehicle.fuel_type || 'Petrol',
      body_type: vehicle.bodyType || vehicle.body_type || 'SUV',
      price,
      price_formatted: priceFormatted,
      monthly_est: monthlyEst,
      trim: variantVal || vehicle.trim || 'Standard Edition',
      badge: vehicle.badge || (vehicle.fuelType === 'Electric' ? 'Electric' : 'Certified'),
      badge_class: vehicle.badgeClass || (vehicle.fuelType === 'Electric' ? 'badge-primary' : 'badge-accent'),
      mileage: vehicle.mileage || (vehicle.fuelType === 'Electric' ? '300 mi Range' : '16 km/l'),
      kilometers_driven: vehicle.kilometersDriven || vehicle.kmDriven || vehicle.kilometers_driven || '0 km (Brand New)',
      range: vehicle.range || '',
      engine: vehicle.engine || '',
      power: vehicle.power || '',
      transmission: vehicle.transmission || 'Automatic',
      drivetrain: vehicle.drivetrain || 'All-Wheel Drive',
      seating: vehicle.seating || '5 Passengers',
      fuel_economy: vehicle.fuelEconomy || '',
      acceleration: vehicle.acceleration || '',
      top_speed: vehicle.topSpeed || '',
      safety_rating: vehicle.safetyRating || '5-Star Certified',
      warranty: vehicle.warranty || '3-Yr Comprehensive Dealership Warranty',
      color: vehicle.color || 'Obsidian Black Metallic',
      registration_details: vehicle.registrationDetails || vehicle.registration || 'Unregistered (Brand New)',
      description: vehicle.description || `Certified vehicle presented by Ekta Motors. Complete dealership inspection with verified documentation.`,
      highlights: Array.isArray(vehicle.highlights) ? vehicle.highlights : [],
      images: Array.isArray(vehicle.images) ? vehicle.images : [],
      exterior_360: Array.isArray(vehicle.exterior360 || vehicle.exterior_360) ? (vehicle.exterior360 || vehicle.exterior_360) : [],
      interior_360: Array.isArray(vehicle.interior360 || vehicle.interior_360) ? (vehicle.interior360 || vehicle.interior_360) : [],
      availability: normalizeAvailability(vehicle.availability),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await client
      .from('vehicles')
      .insert([record])
      .select()
      .single();

    if (error) {
      console.error('[Supabase Vehicles] Insert failed:', error.message, 'code:', error.code);
      return { success: false, error: error.message, code: error.code };
    }

    const created = mapDatabaseRowToVehicle(data);
    console.log(`[Supabase Vehicles] Successfully inserted vehicle "${created.name}" (ID: ${created.id}) into Supabase.`);
    return { success: true, vehicle: created };
  } catch (err: any) {
    console.error('[Supabase Vehicles] Insert exception:', err.message);
    return { success: false, error: err.message || 'Error inserting vehicle into Supabase' };
  }
}

/**
 * Updates an existing vehicle directly in the Supabase 'vehicles' table.
 */
export async function updateVehicleInSupabase(id: string, updates: any): Promise<{
  success: boolean;
  vehicle?: any;
  error?: string;
  code?: string;
}> {
  const client = getSupabaseAdminClient();
  try {
    const record: any = {
      updated_at: new Date().toISOString()
    };

    if (updates.name !== undefined) record.name = updates.name;
    if (updates.brand !== undefined) record.brand = updates.brand.trim();
    if (updates.model !== undefined) record.model = updates.model.trim();
    if (updates.variant !== undefined || updates.trim !== undefined) {
      record.variant = (updates.variant ?? updates.trim ?? '').trim();
      record.trim = record.variant;
    }
    if (updates.year !== undefined) record.year = Number(updates.year) || 2024;
    if (updates.category !== undefined) record.category = (updates.category || 'suv').toLowerCase();
    if (updates.fuelType !== undefined || updates.fuel_type !== undefined) record.fuel_type = updates.fuelType ?? updates.fuel_type;
    if (updates.bodyType !== undefined || updates.body_type !== undefined) record.body_type = updates.bodyType ?? updates.body_type;
    if (updates.price !== undefined) {
      record.price = Number(updates.price) || 0;
      record.price_formatted = `₹${record.price.toLocaleString('en-IN')}`;
      record.monthly_est = `₹${Math.round((record.price * 0.85 * (1 + 0.085 * 5)) / 60).toLocaleString('en-IN')}/mo`;
    }
    if (updates.monthlyEst !== undefined) record.monthly_est = updates.monthlyEst;
    if (updates.badge !== undefined) record.badge = updates.badge;
    if (updates.badgeClass !== undefined) record.badge_class = updates.badgeClass;
    if (updates.mileage !== undefined) record.mileage = updates.mileage;
    if (updates.kilometersDriven !== undefined || updates.kmDriven !== undefined) {
      record.kilometers_driven = updates.kilometersDriven ?? updates.kmDriven;
    }
    if (updates.range !== undefined) record.range = updates.range;
    if (updates.engine !== undefined) record.engine = updates.engine;
    if (updates.power !== undefined) record.power = updates.power;
    if (updates.transmission !== undefined) record.transmission = updates.transmission;
    if (updates.drivetrain !== undefined) record.drivetrain = updates.drivetrain;
    if (updates.seating !== undefined) record.seating = updates.seating;
    if (updates.fuelEconomy !== undefined) record.fuel_economy = updates.fuelEconomy;
    if (updates.acceleration !== undefined) record.acceleration = updates.acceleration;
    if (updates.topSpeed !== undefined) record.top_speed = updates.topSpeed;
    if (updates.safetyRating !== undefined) record.safety_rating = updates.safetyRating;
    if (updates.warranty !== undefined) record.warranty = updates.warranty;
    if (updates.color !== undefined) record.color = updates.color;
    if (updates.registrationDetails !== undefined || updates.registration !== undefined) {
      record.registration_details = updates.registrationDetails ?? updates.registration;
    }
    if (updates.description !== undefined) record.description = updates.description;
    if (updates.highlights !== undefined) {
      record.highlights = Array.isArray(updates.highlights) ? updates.highlights : [];
    }
    if (updates.images !== undefined) {
      record.images = Array.isArray(updates.images) ? updates.images : [];
    }
    if (updates.exterior360 !== undefined || updates.exterior_360 !== undefined) {
      record.exterior_360 = Array.isArray(updates.exterior360 ?? updates.exterior_360) ? (updates.exterior360 ?? updates.exterior_360) : [];
    }
    if (updates.interior360 !== undefined || updates.interior_360 !== undefined) {
      record.interior_360 = Array.isArray(updates.interior360 ?? updates.interior_360) ? (updates.interior360 ?? updates.interior_360) : [];
    }
    if (updates.availability !== undefined) record.availability = normalizeAvailability(updates.availability);

    // Recalculate clean name if brand or model updated
    if (record.brand || record.model || record.variant) {
      const existing = await getSingleVehicleFromSupabase(id);
      if (existing) {
        record.name = getCleanVehicleName({
          name: record.name || existing.name,
          brand: record.brand || existing.brand,
          model: record.model || existing.model,
          variant: record.variant ?? existing.variant,
          year: record.year || existing.year
        });
      }
    }

    const { data, error } = await client
      .from('vehicles')
      .update(record)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[Supabase Vehicles] Update failed:', error.message);
      return { success: false, error: error.message, code: error.code };
    }

    const updated = mapDatabaseRowToVehicle(data);
    console.log(`[Supabase Vehicles] Successfully updated vehicle "${updated.name}" (ID: ${updated.id}) in Supabase.`);
    return { success: true, vehicle: updated };
  } catch (err: any) {
    console.error('[Supabase Vehicles] Update exception:', err.message);
    return { success: false, error: err.message || 'Error updating vehicle in Supabase' };
  }
}

/**
 * Syncs a vehicle record to the Supabase 'vehicles' table via upsert.
 */
export async function syncVehicleToSupabase(vehicle: any): Promise<{
  success: boolean;
  vehicle?: any;
  error?: string;
  code?: string;
}> {
  const client = getSupabaseAdminClient();
  try {
    const record = {
      id: vehicle.id,
      name: vehicle.name,
      brand: vehicle.brand,
      model: vehicle.model,
      variant: vehicle.variant || '',
      year: vehicle.year || 2024,
      category: vehicle.category || 'suv',
      fuel_type: vehicle.fuelType || 'Petrol',
      body_type: vehicle.bodyType || 'SUV',
      price: vehicle.price || 0,
      price_formatted: vehicle.priceFormatted || '',
      monthly_est: vehicle.monthlyEst || '',
      trim: vehicle.trim || '',
      badge: vehicle.badge || '',
      badge_class: vehicle.badgeClass || '',
      mileage: vehicle.mileage || '',
      kilometers_driven: vehicle.kilometersDriven || '',
      range: vehicle.range || '',
      engine: vehicle.engine || '',
      power: vehicle.power || '',
      transmission: vehicle.transmission || '',
      drivetrain: vehicle.drivetrain || '',
      seating: vehicle.seating || '',
      fuel_economy: vehicle.fuelEconomy || '',
      acceleration: vehicle.acceleration || '',
      top_speed: vehicle.topSpeed || '',
      safety_rating: vehicle.safetyRating || '',
      warranty: vehicle.warranty || '',
      color: vehicle.color || '',
      registration_details: vehicle.registrationDetails || '',
      description: vehicle.description || '',
      highlights: vehicle.highlights || [],
      images: vehicle.images || [],
      exterior_360: vehicle.exterior360 || vehicle.exterior_360 || [],
      interior_360: vehicle.interior360 || vehicle.interior_360 || [],
      availability: normalizeAvailability(vehicle.availability),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await client
      .from('vehicles')
      .upsert(record)
      .select()
      .single();

    if (error) {
      console.warn('[Supabase Sync] Upsert failed:', error.message);
      return { success: false, error: error.message, code: error.code };
    } else {
      console.log(`[Supabase Sync] Synced vehicle "${vehicle.name}" to Supabase PostgreSQL table.`);
      return { success: true, vehicle: mapDatabaseRowToVehicle(data) };
    }
  } catch (err: any) {
    console.warn('[Supabase Sync] vehicles table sync note:', err.message);
    return { success: false, error: err.message || 'Error syncing vehicle to Supabase' };
  }
}

/**
 * Deletes vehicle directly from Supabase 'vehicles' table.
 */
export async function deleteVehicleFromSupabase(vehicleId: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseAdminClient();
  try {
    const { error } = await client
      .from('vehicles')
      .delete()
      .eq('id', vehicleId);

    if (error) {
      console.error(`[Supabase Vehicles] Error deleting vehicle ${vehicleId}:`, error.message);
      return { success: false, error: error.message };
    }

    console.log(`[Supabase Vehicles] Successfully deleted vehicle ${vehicleId} from Supabase table.`);
    return { success: true };
  } catch (err: any) {
    console.error('[Supabase Vehicles] Exception deleting from vehicles table:', err.message);
    return { success: false, error: err.message || 'Error deleting vehicle from Supabase' };
  }
}

/**
 * Maps PostgreSQL snake_case database row to camelCase frontend vehicle model.
 */
export function mapDatabaseRowToVehicle(row: any) {
  if (!row) return null;
  let highlights = row.highlights;
  if (typeof highlights === 'string') {
    try { highlights = JSON.parse(highlights); } catch { highlights = []; }
  }
  if (!Array.isArray(highlights)) highlights = [];

  let images = row.images;
  if (typeof images === 'string') {
    try { images = JSON.parse(images); } catch { images = []; }
  }
  if (!Array.isArray(images)) images = [];

  let exterior360 = row.exterior_360 || row.exterior360;
  if (typeof exterior360 === 'string') {
    try { exterior360 = JSON.parse(exterior360); } catch { exterior360 = []; }
  }
  if (!Array.isArray(exterior360)) exterior360 = [];

  let interior360 = row.interior_360 || row.interior360;
  if (typeof interior360 === 'string') {
    try { interior360 = JSON.parse(interior360); } catch { interior360 = []; }
  }
  if (!Array.isArray(interior360)) interior360 = [];

  const yearVal = Number(row.year) || 2024;
  const brandVal = row.brand || '';
  const modelVal = row.model || '';
  const variantVal = row.variant || row.trim || '';
  const cleanName = getCleanVehicleName({
    name: row.name,
    brand: brandVal,
    model: modelVal,
    variant: variantVal,
    year: yearVal
  });

  return {
    id: row.id,
    name: cleanName,
    brand: brandVal,
    model: modelVal,
    variant: variantVal,
    year: yearVal,
    category: row.category || 'suv',
    fuelType: row.fuel_type || 'Petrol',
    bodyType: row.body_type || 'SUV',
    price: Number(row.price) || 0,
    priceFormatted: row.price_formatted || (row.price ? `₹${Number(row.price).toLocaleString('en-IN')}` : 'Price on Request'),
    monthlyEst: row.monthly_est || '',
    trim: row.trim || '',
    badge: row.badge || '',
    badgeClass: row.badge_class || '',
    mileage: row.mileage || '',
    kilometersDriven: row.kilometers_driven || '',
    kmDriven: row.kilometers_driven || '',
    range: row.range || '',
    engine: row.engine || '',
    power: row.power || '',
    transmission: row.transmission || '',
    drivetrain: row.drivetrain || '',
    seating: row.seating || '',
    fuelEconomy: row.fuel_economy || '',
    acceleration: row.acceleration || '',
    topSpeed: row.top_speed || '',
    safetyRating: row.safety_rating || '',
    warranty: row.warranty || '',
    color: row.color || '',
    registrationDetails: row.registration_details || '',
    registration: row.registration_details || '',
    description: row.description || '',
    highlights,
    images,
    exterior360,
    interior360,
    availability: normalizeAvailability(row.availability),
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString()
  };
}

/**
 * Fetches all vehicles directly from Supabase PostgreSQL 'vehicles' table.
 * Returns { vehicles, error, code, tableExists }
 */
export async function getVehiclesFromSupabase(): Promise<{
  vehicles: any[];
  error: string | null;
  code: string | null;
  tableExists: boolean;
}> {
  const client = getSupabaseAdminClient();
  try {
    const { data, error } = await client
      .from('vehicles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      const isMissingTable = error.code === 'PGRST205' || (error.message && error.message.includes('schema cache'));
      if (!isMissingTable) {
        console.warn('[Supabase Fetch] Notice reading from vehicles table:', error.message);
      }
      return {
        vehicles: [],
        error: error.message,
        code: error.code || null,
        tableExists: !isMissingTable
      };
    }

    const mapped = (data || []).map(mapDatabaseRowToVehicle).filter(Boolean);
    return {
      vehicles: mapped,
      error: null,
      code: null,
      tableExists: true
    };
  } catch (err: any) {
    return {
      vehicles: [],
      error: err.message || 'Unknown Supabase connection note',
      code: 'CONN_NOTE',
      tableExists: false
    };
  }
}

/**
 * Fetches a single vehicle directly from Supabase PostgreSQL 'vehicles' table.
 */
export async function getSingleVehicleFromSupabase(id: string): Promise<any | null> {
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from('vehicles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`[Supabase Single Vehicle] Error fetching ${id}:`, error.message);
    throw new Error(`Database error fetching vehicle: ${error.message}`);
  }

  if (!data) return null;
  return mapDatabaseRowToVehicle(data);
}

/**
 * Maps PostgreSQL 'reviews' database row to frontend Review structure
 */
export function mapDatabaseRowToReview(row: any): any {
  if (!row) return null;
  const authorName = row.customer_name || row.author_name || row.authorName || row.name || 'Customer';
  const quote = row.review || row.quote || row.review_text || row.message || '';
  const authorCar = row.vehicle_name || row.author_car || row.authorCar || row.vehicle_purchased || undefined;
  const isVerified = Boolean(row.verified ?? row.is_verified ?? row.isVerified ?? false);
  const status = row.status || 'pending';

  return {
    id: String(row.id),
    authorName,
    customerName: authorName,
    rating: Number(row.rating) || 5,
    quote,
    review: quote,
    authorCar,
    vehicleName: authorCar,
    vehicleId: row.vehicle_id || undefined,
    purchaseYear: row.purchase_year || row.purchaseYear || undefined,
    isVerified,
    verified: isVerified,
    status,
    avatar: row.avatar || undefined,
    createdAt: row.created_at || row.createdAt || new Date().toISOString()
  };
}

/**
 * Fetches reviews from Supabase 'reviews' table.
 * If approvedOnly is true, only returns status = 'Approved' or 'approved' or 'published'.
 */
export async function getReviewsFromSupabase(approvedOnly = true): Promise<{
  reviews: any[];
  error: string | null;
  tableExists: boolean;
}> {
  const client = getSupabaseAdminClient();
  try {
    let query = client
      .from('reviews')
      .select('*')
      .order('created_at', { ascending: false });

    if (approvedOnly) {
      query = query.or('status.eq.Approved,status.eq.approved,status.eq.published,status.eq.Published');
    }

    const { data, error } = await query;
    if (error) {
      const isMissingTable = error.code === 'PGRST205' || (error.message && error.message.includes('schema cache'));
      const friendlyMessage = isMissingTable
        ? "Could not find the table 'public.reviews' in Supabase. Please ensure the 'reviews' table is created in Supabase SQL Editor."
        : error.message;

      if (!isMissingTable) {
        console.warn('[Supabase Reviews] Notice querying reviews table:', error.message);
      }
      return {
        reviews: [],
        error: friendlyMessage,
        tableExists: !isMissingTable
      };
    }

    const mapped = (data || []).map(mapDatabaseRowToReview).filter(Boolean);
    return {
      reviews: mapped,
      error: null,
      tableExists: true
    };
  } catch (err: any) {
    return {
      reviews: [],
      error: err.message || 'Error querying reviews table',
      tableExists: false
    };
  }
}

/**
 * Inserts a customer review into Supabase 'reviews' table.
 */
export async function insertReviewToSupabase(review: {
  authorName?: string;
  customerName?: string;
  rating: number;
  quote?: string;
  review?: string;
  authorCar?: string;
  vehicleName?: string;
  vehicleId?: string;
  purchaseYear?: number | string;
  isVerified?: boolean;
  verified?: boolean;
  status?: string;
}): Promise<{ data: any; error: any }> {
  const client = getSupabaseAdminClient();
  try {
    const customerName = (review.customerName || review.authorName || '').trim();
    const reviewText = (review.review || review.quote || '').trim();
    const vehicleName = (review.vehicleName || review.authorCar || '').trim();
    const rating = Math.max(1, Math.min(5, Number(review.rating) || 5));
    const status = (review.status || 'pending').toLowerCase();
    const verified = Boolean(review.verified ?? review.isVerified ?? false);

    const payload: any = {
      customer_name: customerName,
      rating,
      review: reviewText,
      status,
      verified
    };

    if (review.vehicleId) {
      payload.vehicle_id = review.vehicleId;
    }
    if (vehicleName) {
      payload.vehicle_name = vehicleName;
    }
    // Also add compatibility columns in case table has legacy names
    payload.author_name = customerName;
    payload.quote = reviewText;
    if (vehicleName) {
      payload.author_car = vehicleName;
    }
    if (review.purchaseYear) {
      payload.purchase_year = String(review.purchaseYear);
    }
    payload.is_verified = verified;

    let { data, error } = await client
      .from('reviews')
      .insert(payload);

    // If there is an unknown column error, strip non-matching columns and retry
    if (error && error.message && (error.message.includes('column') || error.message.includes('does not exist'))) {
      const fallbackPayload: any = {
        rating,
        status,
        created_at: new Date().toISOString()
      };
      
      // Determine name column
      if (!error.message.includes('customer_name')) {
        fallbackPayload.customer_name = customerName;
      } else {
        fallbackPayload.author_name = customerName;
      }

      // Determine review text column
      if (!error.message.includes('review')) {
        fallbackPayload.review = reviewText;
      } else {
        fallbackPayload.quote = reviewText;
      }

      if (vehicleName) {
        if (!error.message.includes('vehicle_name')) {
          fallbackPayload.vehicle_name = vehicleName;
        } else {
          fallbackPayload.author_car = vehicleName;
        }
      }

      fallbackPayload.verified = verified;

      const retryRes = await client
        .from('reviews')
        .insert(fallbackPayload);

      if (!retryRes.error) {
        error = null;
      } else {
        error = retryRes.error;
      }
    }

    if (error) {
      if (error.code === 'PGRST205' || (error.message && error.message.includes('schema cache'))) {
        error.message = "Could not find the table 'public.reviews' in Supabase. Please ensure the 'reviews' table is created in Supabase SQL Editor.";
      }
    }

    const mapped = {
      id: `rev-${Date.now()}`,
      authorName: customerName,
      customerName,
      authorCar: vehicleName,
      vehicleName,
      rating,
      quote: reviewText,
      review: reviewText,
      status,
      verified,
      isVerified: verified,
      createdAt: new Date().toISOString()
    };
    return { data: mapped, error };
  } catch (err: any) {
    return { data: null, error: err };
  }
}

/**
 * Updates review status in Supabase 'reviews' table (e.g. 'Approved', 'Hidden', 'Pending')
 */
export async function updateSupabaseReviewStatus(id: string, status: string): Promise<{ success: boolean; error: any }> {
  const client = getSupabaseAdminClient();
  try {
    const rawStatus = (status || '').trim();
    const normalizedStatus = rawStatus.toLowerCase() === 'approved' ? 'approved' : rawStatus.toLowerCase() === 'pending' ? 'pending' : rawStatus;
    const { error } = await client
      .from('reviews')
      .update({ status: normalizedStatus })
      .eq('id', id);

    return { success: !error, error };
  } catch (err: any) {
    return { success: false, error: err };
  }
}

/**
 * Deletes review from Supabase 'reviews' table
 */
export async function deleteSupabaseReview(id: string): Promise<{ success: boolean; error: any }> {
  const client = getSupabaseAdminClient();
  try {
    const { error } = await client
      .from('reviews')
      .delete()
      .eq('id', id);

    return { success: !error, error };
  } catch (err: any) {
    return { success: false, error: err };
  }
}


