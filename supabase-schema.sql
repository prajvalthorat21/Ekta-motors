-- ============================================================================
-- EKTA MOTORS DEALERSHIP - SUPABASE BACKEND SCHEMA (HARDENED RLS)
-- Project ID: tndaufwuogbojgdwhrxf
-- ============================================================================
-- How to apply this schema:
-- 1. Open your Supabase project dashboard (https://supabase.com/dashboard/project/tndaufwuogbojgdwhrxf)
-- 2. Click on "SQL Editor" in the left sidebar
-- 3. Click "New Query", paste this entire script, and click "Run"
-- ============================================================================

-- 1. TEST DRIVE BOOKINGS TABLE
CREATE TABLE IF NOT EXISTS public.test_drive_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_ref TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    vehicle_name TEXT,
    vehicle_id TEXT,
    drive_type TEXT DEFAULT 'Showroom Test Drive',
    preferred_date TEXT,
    preferred_time TEXT,
    city TEXT,
    message TEXT,
    status TEXT DEFAULT 'New',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. CAR BOOKINGS & ONLINE RESERVATIONS TABLE
CREATE TABLE IF NOT EXISTS public.car_bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_ref TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    city TEXT,
    vehicle_name TEXT NOT NULL,
    vehicle_id TEXT,
    variant TEXT,
    fuel_type TEXT,
    color_preference TEXT,
    payment_preference TEXT DEFAULT 'Financing / Loan',
    token_amount TEXT DEFAULT '₹25,000',
    trade_in_vehicle TEXT,
    preferred_delivery_date TEXT,
    special_requests TEXT,
    status TEXT DEFAULT 'Pending Confirmation',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. UNIFIED INQUIRIES & BOOKINGS TABLE
CREATE TABLE IF NOT EXISTS public.inquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_ref TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    service TEXT,
    vehicle_name TEXT,
    preferred_date TEXT,
    message TEXT,
    status TEXT DEFAULT 'New',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. ENABLE ROW LEVEL SECURITY (RLS) ON ALL BOOKINGS TABLES
ALTER TABLE public.test_drive_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.car_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiries ENABLE ROW LEVEL SECURITY;

-- Clean up any legacy overly-permissive policies
DROP POLICY IF EXISTS "Allow public insert for test drive bookings" ON public.test_drive_bookings;
DROP POLICY IF EXISTS "Allow public select for test drive bookings" ON public.test_drive_bookings;
DROP POLICY IF EXISTS "Allow public update for test drive bookings" ON public.test_drive_bookings;
DROP POLICY IF EXISTS "Allow public delete for test drive bookings" ON public.test_drive_bookings;
DROP POLICY IF EXISTS "Allow admin all for test drive bookings" ON public.test_drive_bookings;

DROP POLICY IF EXISTS "Allow public insert for car bookings" ON public.car_bookings;
DROP POLICY IF EXISTS "Allow public select for car bookings" ON public.car_bookings;
DROP POLICY IF EXISTS "Allow public update for car bookings" ON public.car_bookings;
DROP POLICY IF EXISTS "Allow public delete for car bookings" ON public.car_bookings;
DROP POLICY IF EXISTS "Allow admin all for car bookings" ON public.car_bookings;

DROP POLICY IF EXISTS "Allow public insert for inquiries" ON public.inquiries;
DROP POLICY IF EXISTS "Allow public select for inquiries" ON public.inquiries;
DROP POLICY IF EXISTS "Allow public update for inquiries" ON public.inquiries;
DROP POLICY IF EXISTS "Allow public delete for inquiries" ON public.inquiries;
DROP POLICY IF EXISTS "Allow admin all for inquiries" ON public.inquiries;

-- 5. SECURE ACCESS POLICIES: BOOKINGS & INQUIRIES
-- Rule: Public can only INSERT their booking. Public anon CANNOT SELECT, UPDATE, or DELETE customer PII.
-- Admin/Backend service_role has full management access.

-- Test Drive Bookings: Public INSERT only
CREATE POLICY "Public insert only for test drive bookings"
ON public.test_drive_bookings
FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

CREATE POLICY "Admin full access for test drive bookings"
ON public.test_drive_bookings
FOR ALL
TO authenticated, service_role
USING (true)
WITH CHECK (true);

-- Car Bookings: Public INSERT only
CREATE POLICY "Public insert only for car bookings"
ON public.car_bookings
FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

CREATE POLICY "Admin full access for car bookings"
ON public.car_bookings
FOR ALL
TO authenticated, service_role
USING (true)
WITH CHECK (true);

-- General Inquiries: Public INSERT only
CREATE POLICY "Public insert only for inquiries"
ON public.inquiries
FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

CREATE POLICY "Admin full access for inquiries"
ON public.inquiries
FOR ALL
TO authenticated, service_role
USING (true)
WITH CHECK (true);

-- ============================================================================
-- 6. SUPABASE STORAGE: VEHICLE-IMAGES BUCKET & ACCESS POLICIES
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vehicle-images',
  'vehicle-images',
  true,
  10485760, -- 10MB per image
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

DROP POLICY IF EXISTS "Public Read Access for vehicle-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow Upload to vehicle-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow Update to vehicle-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow Delete from vehicle-images" ON storage.objects;
DROP POLICY IF EXISTS "Admin upload vehicle images" ON storage.objects;
DROP POLICY IF EXISTS "Admin update vehicle images" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete vehicle images" ON storage.objects;

-- Policy 1: Public Read Access (Showroom visitors can read vehicle images)
CREATE POLICY "Public Read Access for vehicle-images"
ON storage.objects FOR SELECT
TO anon, authenticated, service_role
USING (bucket_id = 'vehicle-images');

-- Policy 2: Admin/Service Role Only for Storage Mutations (No anon writes/deletions)
CREATE POLICY "Admin upload vehicle images"
ON storage.objects FOR INSERT
TO authenticated, service_role
WITH CHECK (bucket_id = 'vehicle-images');

CREATE POLICY "Admin update vehicle images"
ON storage.objects FOR UPDATE
TO authenticated, service_role
USING (bucket_id = 'vehicle-images')
WITH CHECK (bucket_id = 'vehicle-images');

CREATE POLICY "Admin delete vehicle images"
ON storage.objects FOR DELETE
TO authenticated, service_role
USING (bucket_id = 'vehicle-images');

-- ============================================================================
-- 7. VEHICLES INVENTORY TABLE (PostgreSQL Database Record)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vehicles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    variant TEXT,
    year INTEGER DEFAULT 2024,
    category TEXT DEFAULT 'suv',
    fuel_type TEXT DEFAULT 'Petrol',
    body_type TEXT DEFAULT 'SUV',
    price BIGINT NOT NULL,
    price_formatted TEXT,
    monthly_est TEXT,
    trim TEXT,
    badge TEXT,
    badge_class TEXT,
    mileage TEXT,
    kilometers_driven TEXT,
    range TEXT,
    engine TEXT,
    power TEXT,
    transmission TEXT,
    drivetrain TEXT,
    seating TEXT,
    fuel_economy TEXT,
    acceleration TEXT,
    top_speed TEXT,
    safety_rating TEXT,
    warranty TEXT,
    color TEXT,
    registration_details TEXT,
    description TEXT,
    highlights JSONB DEFAULT '[]'::jsonb,
    images JSONB DEFAULT '[]'::jsonb,
    exterior_360 JSONB DEFAULT '[]'::jsonb,
    interior_360 JSONB DEFAULT '[]'::jsonb,
    availability TEXT DEFAULT 'Available',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Non-destructive column additions for existing deployments
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS exterior_360 JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS interior_360 JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public select for vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow public insert for vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow public update for vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Allow public delete for vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Public select vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Admin manage vehicles" ON public.vehicles;

-- Policy 1: Public SELECT allowed (Backend / API filters 'Available' for public showroom)
CREATE POLICY "Public select vehicles"
ON public.vehicles
FOR SELECT
TO anon, authenticated, service_role
USING (true);

-- Policy 2: Admin/Service Role Only for INSERT, UPDATE, DELETE (No direct anon mutations)
CREATE POLICY "Admin manage vehicles"
ON public.vehicles
FOR ALL
TO authenticated, service_role
USING (true)
WITH CHECK (true);

-- ============================================================================
-- 8. CUSTOMER REVIEWS TABLE (Real Dealership Reviews Only)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT NOT NULL,
    vehicle_id TEXT,
    vehicle_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    verified BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    author_name TEXT,
    quote TEXT,
    author_car TEXT,
    purchase_year TEXT,
    is_verified BOOLEAN DEFAULT false,
    avatar TEXT
);

-- Safe migration for existing reviews.vehicle_id from UUID to TEXT if needed
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'reviews' 
          AND column_name = 'vehicle_id' 
          AND data_type = 'uuid'
    ) THEN
        ALTER TABLE public.reviews ALTER COLUMN vehicle_id TYPE TEXT USING vehicle_id::text;
    END IF;
END $$;

-- Indexes for optimal query performance
CREATE INDEX IF NOT EXISTS idx_vehicles_availability ON public.vehicles(availability);
CREATE INDEX IF NOT EXISTS idx_test_drive_bookings_ref ON public.test_drive_bookings(booking_ref);
CREATE INDEX IF NOT EXISTS idx_test_drive_bookings_created ON public.test_drive_bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_car_bookings_ref ON public.car_bookings(booking_ref);
CREATE INDEX IF NOT EXISTS idx_car_bookings_created ON public.car_bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_ref ON public.inquiries(booking_ref);
CREATE INDEX IF NOT EXISTS idx_inquiries_created ON public.inquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON public.reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_created ON public.reviews(created_at DESC);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can insert customer reviews" ON public.reviews;
DROP POLICY IF EXISTS "Public can select approved reviews" ON public.reviews;
DROP POLICY IF EXISTS "Admin and authenticated full access" ON public.reviews;
DROP POLICY IF EXISTS "Allow public read approved reviews" ON public.reviews;
DROP POLICY IF EXISTS "Allow public insert reviews" ON public.reviews;
DROP POLICY IF EXISTS "Allow admin update reviews" ON public.reviews;
DROP POLICY IF EXISTS "Allow admin delete reviews" ON public.reviews;

-- 1. PUBLIC: Can INSERT a review (lands as pending for moderation)
CREATE POLICY "Public can insert customer reviews"
ON public.reviews
FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

-- 2. PUBLIC: Can SELECT ONLY approved/published reviews
CREATE POLICY "Public can select approved reviews"
ON public.reviews
FOR SELECT
TO anon, authenticated, service_role
USING (
    status = 'approved' 
    OR status = 'Approved' 
    OR auth.role() IN ('authenticated', 'service_role')
);

-- 3. ADMIN: Authenticated/service_role can view, update, delete all reviews
CREATE POLICY "Admin and authenticated full access"
ON public.reviews
FOR ALL
TO authenticated, service_role
USING (true)
WITH CHECK (true);

