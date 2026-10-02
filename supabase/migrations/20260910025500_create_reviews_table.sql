-- ============================================================================
-- EKTA MOTORS DEALERSHIP - SUPABASE MIGRATION
-- Migration: 20260910025500_create_reviews_table.sql
-- Description: Create public.reviews table with Row Level Security (RLS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT NOT NULL,
    vehicle_id UUID,
    vehicle_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    verified BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    -- Compatibility columns for existing components
    author_name TEXT,
    quote TEXT,
    author_car TEXT,
    purchase_year TEXT,
    is_verified BOOLEAN DEFAULT false,
    avatar TEXT
);

-- Ensure defaults and backward compatibility
COMMENT ON TABLE public.reviews IS 'Real customer testimonials for Ekta Motors';

-- Enable Row Level Security
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Clean existing policies if re-running
DROP POLICY IF EXISTS "Public can insert customer reviews" ON public.reviews;
DROP POLICY IF EXISTS "Public can select approved reviews" ON public.reviews;
DROP POLICY IF EXISTS "Admin and authenticated full access" ON public.reviews;
DROP POLICY IF EXISTS "Allow public read approved reviews" ON public.reviews;
DROP POLICY IF EXISTS "Allow public insert reviews" ON public.reviews;
DROP POLICY IF EXISTS "Allow admin update reviews" ON public.reviews;
DROP POLICY IF EXISTS "Allow admin delete reviews" ON public.reviews;

-- 1. PUBLIC: Can INSERT a review (lands as pending)
CREATE POLICY "Public can insert customer reviews"
ON public.reviews
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- 2. PUBLIC: Can SELECT ONLY approved/published reviews
CREATE POLICY "Public can select approved reviews"
ON public.reviews
FOR SELECT
TO anon, authenticated
USING (
    status = 'approved' 
    OR status = 'Approved' 
    OR auth.role() = 'authenticated'
    OR auth.role() = 'service_role'
);

-- 3. ADMIN: Authenticated/service_role can view, update, delete all reviews
CREATE POLICY "Admin and authenticated full access"
ON public.reviews
FOR ALL
TO authenticated, service_role
USING (true)
WITH CHECK (true);

-- Grants to ensure Data API exposure
GRANT ALL ON public.reviews TO anon, authenticated, service_role;
