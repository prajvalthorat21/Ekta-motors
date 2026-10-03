/**
 * EKTA MOTORS - OFFICIAL SCRIPT
 * Vanilla JavaScript (ES6+) for Automobile Dealership Website
 * Handles: Inventory Rendering, Dynamic Filtering, Side-by-Side Comparison,
 * Vehicle Details Modal, Testimonials Carousel, Finance Calculator, and Form Validation.
 */

document.addEventListener("DOMContentLoaded", () => {
  // Proactively ensure AI Studio / Cloud Run proxy security cookies are set
  try {
    const hostname = window.location.hostname || "";
    const domainPart = hostname ? `; Domain=${hostname}` : "";
    document.cookie = `__SECURE-aistudio_auth_flow_may_set_cookies=true; Path=/; Secure; SameSite=None${domainPart}; Partitioned; Max-Age=86400;`;
    document.cookie = `__SECURE-aistudio_auth_flow_may_set_cookies=true; Path=/; Secure; SameSite=None; Partitioned; Max-Age=86400;`;
  } catch (_) {}

  // Single Source of Truth: Supabase PostgreSQL

  // =========================================================================
  // SUPABASE DATABASE INITIALIZATION & SINGLE SOURCE OF TRUTH
  // =========================================================================
  const SUPABASE_URL = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || "https://tndaufwuogbojgdwhrxf.supabase.co";
  const SUPABASE_ANON_KEY = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || "sb_publishable_bhA8D3vmga3lCrewuZEPVQ_aBo4xXN_";
  let supabase = null;
  let supabaseClient = null;

  if (window.supabase && typeof window.supabase.from === "function") {
    supabase = window.supabase;
  } else if (window.supabase && typeof window.supabase.createClient === "function") {
    try {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      console.log("[Supabase Client] Initialized in browser:", SUPABASE_URL);
    } catch (e) {
      console.warn("[Supabase Client] Browser init note:", e);
    }
  }
  supabaseClient = supabase;
  window.supabaseClient = supabase;
  window.supabaseInstance = supabase;

  // Purge any legacy stale localStorage vehicle cache - Supabase is the single source of truth
  try {
    localStorage.removeItem("ekta_vehicles_v2");
    localStorage.removeItem("ekta_vehicles");
  } catch (_) {}

  // Vehicles state: starts strictly empty until verified from Supabase
  let VEHICLES = [];
  let isFetchingVehicles = true;
  let vehicleFetchError = null;

  const PHOTO_UNAVAILABLE_DATA_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='500' viewBox='0 0 800 500' fill='none'%3E%3Crect width='800' height='500' fill='%231e293b'/%3E%3Cpath d='M360 210C360 198.954 368.954 190 380 190H420C431.046 190 440 198.954 440 210V230H360V210Z' fill='%23475569'/%3E%3Crect x='340' y='230' width='120' height='80' rx='10' fill='%23334155' stroke='%23475569' stroke-width='4'/%3E%3Ccircle cx='400' cy='270' r='20' stroke='%2364748b' stroke-width='4' fill='%231e293b'/%3E%3Ctext x='400' y='350' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='16' font-weight='500'%3EPhoto Unavailable%3C/text%3E%3C/svg%3E";

  function normalizeAvailability(raw) {
    if (!raw) return "Available";
    const val = String(raw).trim().toLowerCase();
    if (val === "available" || val === "in stock" || val === "active" || val === "ready") {
      return "Available";
    }
    if (val === "reserved" || val === "booked" || val === "pending") {
      return "Reserved";
    }
    if (val === "sold" || val === "delivered") {
      return "Sold";
    }
    if (val === "archived" || val === "hidden" || val === "draft" || val === "unavailable") {
      return "Archived";
    }
    return "Available";
  }
  window.normalizeAvailability = normalizeAvailability;
  window.PHOTO_UNAVAILABLE_DATA_URI = PHOTO_UNAVAILABLE_DATA_URI;

  // Universal Vehicle Name Normalization:
  // - Year is NEVER part of the vehicle name (displayed separately)
  // - Manufacturer is never duplicated or prepended twice
  // - Ensures consistent, clean naming for every current and future vehicle
  function getCleanVehicleName(car) {
    if (!car) return "Certified Vehicle";
    const brand = String(car.brand || "").trim();
    const year = car.year ? String(car.year).trim() : "";
    const model = String(car.model || "").trim();
    const variant = String(car.variant || car.trim || "").trim();
    let rawName = String(car.name || "").trim();

    // If no name provided, synthesize from brand, model, variant
    if (!rawName) {
      const parts = [];
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
  window.getCleanVehicleName = getCleanVehicleName;

  function mapSupabaseRowToVehicle(row) {
    if (!row) return null;
    let highlights = row.highlights;
    if (typeof highlights === "string") {
      try { highlights = JSON.parse(highlights); } catch { highlights = []; }
    }
    if (!Array.isArray(highlights)) highlights = [];

    let images = row.images;
    if (typeof images === "string") {
      try { images = JSON.parse(images); } catch { images = []; }
    }
    if (!Array.isArray(images)) images = [];

    const yearVal = Number(row.year) || 2024;
    const brandVal = row.brand || "";
    const modelVal = row.model || "";
    const variantVal = row.variant || row.trim || "";
    const cleanName = getCleanVehicleName({
      name: row.name,
      brand: brandVal,
      model: modelVal,
      variant: variantVal,
      year: yearVal
    });

    let exterior360 = row.exterior_360 || row.exterior360;
    if (typeof exterior360 === "string") {
      try { exterior360 = JSON.parse(exterior360); } catch { exterior360 = []; }
    }
    if (!Array.isArray(exterior360)) exterior360 = [];

    let interior360 = row.interior_360 || row.interior360;
    if (typeof interior360 === "string") {
      try { interior360 = JSON.parse(interior360); } catch { interior360 = []; }
    }
    if (!Array.isArray(interior360)) interior360 = [];

    return {
      id: row.id,
      name: cleanName,
      brand: brandVal,
      model: modelVal,
      variant: variantVal,
      year: yearVal,
      category: row.category || "suv",
      fuelType: row.fuel_type || "Petrol",
      bodyType: row.body_type || "SUV",
      price: Number(row.price) || 0,
      priceFormatted: row.price_formatted || (row.price ? `₹${Number(row.price).toLocaleString('en-IN')}` : "Price on Request"),
      monthlyEst: row.monthly_est || "",
      trim: row.trim || "",
      badge: row.badge || "",
      badgeClass: row.badge_class || "",
      mileage: row.mileage || "",
      kilometersDriven: row.kilometers_driven || "",
      kmDriven: row.kilometers_driven || "",
      range: row.range || "",
      engine: row.engine || "",
      power: row.power || "",
      transmission: row.transmission || "",
      drivetrain: row.drivetrain || "",
      seating: row.seating || "",
      fuelEconomy: row.fuel_economy || "",
      acceleration: row.acceleration || "",
      topSpeed: row.top_speed || "",
      safetyRating: row.safety_rating || "",
      warranty: row.warranty || "",
      color: row.color || "",
      registrationDetails: row.registration_details || "",
      registration: row.registration_details || "",
      description: row.description || "",
      highlights: highlights,
      images: images,
      exterior360: exterior360,
      interior360: interior360,
      availability: normalizeAvailability(row.availability),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // Global State for Filter, Sort, and Compare
  let state = {
    selectedCategory: "all",
    searchQuery: "",
    bodyTypeFilter: "all",
    priceRangeFilter: "all",
    fuelTypeFilter: "all",
    sortBy: "featured",
    comparedIds: [] // Maximum 3 IDs
  };

  // DOM Elements Cache
  const inventoryGrid = document.getElementById("inventory-grid");
  const resultsCountEl = document.getElementById("results-count");
  const activeChipsContainer = document.getElementById("active-filters-chips");
  const clearFiltersBtn = document.getElementById("clear-filters-btn");
  const sortSelect = document.getElementById("sort-select");
  const categoryTabs = document.querySelectorAll(".tab-btn");
  const viewHorizontalBtn = document.getElementById("view-horizontal-btn");
  const viewGridBtn = document.getElementById("view-grid-btn");

  // Hero Search Elements
  const heroForm = document.getElementById("hero-filter-form");
  const heroSearchInput = document.getElementById("hero-search-input");
  const heroBodySelect = document.getElementById("hero-body-type");
  const heroPriceSelect = document.getElementById("hero-price-range");
  const heroFuelSelect = document.getElementById("hero-fuel-type");

  // Compare Elements
  const compareDock = document.getElementById("compare-dock");
  const dockCountEl = document.getElementById("dock-count");
  const dockItemsContainer = document.getElementById("dock-items-preview");
  const dockCompareBtn = document.getElementById("dock-compare-btn");
  const dockClearBtn = document.getElementById("dock-clear-btn");
  const navCompareBtn = document.getElementById("nav-compare-btn");
  const navCompareCount = document.getElementById("nav-compare-count");
  const compareModal = document.getElementById("compare-modal");
  const compareModalClose = document.getElementById("compare-modal-close");
  const compareTableContainer = document.getElementById("compare-table-container");
  const diffToggle = document.getElementById("diff-toggle");

  // Vehicle Details Modal Elements
  const detailsModal = document.getElementById("details-modal");
  const detailsModalClose = document.getElementById("details-modal-close");
  const detailsModalBody = document.getElementById("details-modal-body");

  // Navigation & Mobile Menu
  const siteHeader = document.getElementById("navbar");
  const menuToggle = document.getElementById("menu-toggle");
  const navMenu = document.getElementById("nav-menu");
  const navLinks = document.querySelectorAll(".nav-link");

  // Customer Reviews Elements & State
  let customerReviews = [];
  let reviewsCurrentPage = 0;
  let allAdminReviews = [];
  let adminPendingReviews = [];
  let adminReviewsFilter = "all"; // 'all' | 'pending' | 'approved'
  let isAdminReviewsActive = false;

  // Admin Authentication Helpers
  function getEktaAdminToken() {
    return localStorage.getItem("ekta_admin_token") || sessionStorage.getItem("ekta_admin_token") || "";
  }
  function setEktaAdminToken(token) {
    if (token) {
      localStorage.setItem("ekta_admin_token", token);
      sessionStorage.setItem("ekta_admin_token", token);
    } else {
      localStorage.removeItem("ekta_admin_token");
      sessionStorage.removeItem("ekta_admin_token");
    }
  }
  function isEktaAdminAuthenticated() {
    const token = getEktaAdminToken();
    const session = localStorage.getItem("ekta_admin_session") === "true" || sessionStorage.getItem("ekta_admin_session") === "true";
    return Boolean(token || session);
  }

  // Contact Form Elements
  const contactForm = document.getElementById("contact-form");
  const vehicleSelect = document.getElementById("vehicle-interest");
  const formSuccessBanner = document.getElementById("form-success-banner");
  const resetFormBtn = document.getElementById("reset-form-btn");

  // Loan Calculator Elements
  const calcVehicleSelect = document.getElementById("calc-vehicle-select");
  const calcPriceSlider = document.getElementById("calc-price-range");
  const calcPriceInput = document.getElementById("calc-price");
  const calcDownSlider = document.getElementById("calc-down-range");
  const calcDownInput = document.getElementById("calc-down");
  const calcTradeSlider = document.getElementById("calc-tradein-range");
  const calcTradeInput = document.getElementById("calc-tradein");
  const calcTermSelect = document.getElementById("calc-term");
  const calcRateSlider = document.getElementById("calc-rate-range");
  const calcRateInput = document.getElementById("calc-rate");
  const calcTaxToggle = document.getElementById("calc-include-tax");

  const calcResultAmount = document.getElementById("calc-monthly-payment");
  const calcPaymentFreqLabel = document.getElementById("calc-payment-period");
  const calcConditionSummary = document.getElementById("calc-result-condition");
  const calcInterestRatio = document.getElementById("calc-interest-ratio");

  const resVehiclePrice = document.getElementById("res-vehicle-price");
  const resTotalDown = document.getElementById("res-total-down");
  const resNetPrincipal = document.getElementById("res-net-principal");
  const resTaxFees = document.getElementById("res-tax-fees");
  const resTotalInterest = document.getElementById("res-total-interest");
  const resTotalCost = document.getElementById("res-total-cost");

  const calcBarPrincipal = document.getElementById("bar-principal");
  const calcBarInterest = document.getElementById("bar-interest");
  const calcBarTax = document.getElementById("bar-tax");

  const amortizationDrawer = document.getElementById("amortization-drawer");
  const amortizationTbody = document.getElementById("amortization-tbody");
  const btnToggleAmortization = document.getElementById("calc-toggle-amortization");
  const btnCloseAmortization = document.getElementById("close-amort-btn");
  const calcApplyBtn = document.getElementById("calc-apply-preapproval");

  // Toast Container
  const toastContainer = document.getElementById("toast-container");

  // =========================================================================
  // 2. HELPER UTILITIES (Toast, Formatting, Scroll, Safe HTML Escaping)
  // =========================================================================
  /**
   * Safe HTML escaping utility to prevent XSS and safely render strings in innerHTML
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  const escapeHTML = escapeHtml;
  if (typeof window !== "undefined") {
    window.escapeHtml = escapeHtml;
    window.escapeHTML = escapeHtml;
  }

  // Format numeric values to Indian Rupee currency string (e.g. ₹38,50,000)
  function formatINR(val) {
    const num = Math.round(Number(val) || 0);
    return `₹${num.toLocaleString("en-IN")}`;
  }

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
      </svg>
      <span>${message}</span>
    `;
    toastContainer.appendChild(toast);
    
    // Trigger entrance animation
    requestAnimationFrame(() => toast.classList.add("show"));

    // Auto remove
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // =========================================================================
  // SINGLE SOURCE OF TRUTH: DYNAMIC INVENTORY CLASSIFICATION & ACTIVE STATE
  // =========================================================================
  function isVehicleActive(car) {
    if (!car) return false;
    return normalizeAvailability(car.availability) === "Available";
  }

  function getActiveVehicles() {
    return VEHICLES.filter(isVehicleActive);
  }

  function isSuvVehicle(car) {
    if (!car) return false;
    const cat = String(car.category || "").toLowerCase().trim();
    const body = String(car.bodyType || "").toLowerCase().trim();
    return cat === "suv" || body === "suv" || body.includes("suv") || cat.includes("suv");
  }

  function isSedanVehicle(car) {
    if (!car) return false;
    const cat = String(car.category || "").toLowerCase().trim();
    const body = String(car.bodyType || "").toLowerCase().trim();
    return cat === "sedan" || body === "sedan" || body.includes("sedan") || cat.includes("sedan");
  }

  function isElectricOrHybridVehicle(car) {
    if (!car) return false;
    const fuel = String(car.fuelType || "").toLowerCase().trim();
    const cat = String(car.category || "").toLowerCase().trim();
    const power = String(car.power || car.powertrain || "").toLowerCase().trim();
    return (
      fuel === "electric" ||
      fuel === "hybrid" ||
      fuel.includes("electric") ||
      fuel.includes("hybrid") ||
      cat === "electric" ||
      cat === "hybrid" ||
      power.includes("electric") ||
      power.includes("hybrid")
    );
  }

  function isLuxuryVehicle(car) {
    if (!car) return false;
    const cat = String(car.category || "").toLowerCase().trim();
    const body = String(car.bodyType || "").toLowerCase().trim();
    const price = Number(car.price) || 0;
    return cat === "luxury" || body.includes("luxury") || price >= 5000000;
  }

  function updateCategoryCounts() {
    const activeVehicles = getActiveVehicles();
    const counts = {
      all: activeVehicles.length,
      suv: activeVehicles.filter(isSuvVehicle).length,
      sedan: activeVehicles.filter(isSedanVehicle).length,
      electric: activeVehicles.filter(isElectricOrHybridVehicle).length,
      luxury: activeVehicles.filter(isLuxuryVehicle).length
    };

    const tabs = document.querySelectorAll(".category-tabs .tab-btn");
    tabs.forEach(tab => {
      const cat = tab.dataset.category;
      if (cat === "all") {
        tab.textContent = `ALL CARS (${counts.all})`;
      } else if (cat === "suv") {
        tab.textContent = `SUVS (${counts.suv})`;
      } else if (cat === "sedan") {
        tab.textContent = `SEDANS (${counts.sedan})`;
      } else if (cat === "electric") {
        tab.textContent = `EV & HYBRID (${counts.electric})`;
      } else if (cat === "luxury") {
        tab.textContent = `LUXURY (${counts.luxury})`;
      }
    });

    return counts;
  }

  // Populate Contact Form & Calculator Vehicle Dropdowns
  function populateVehicleSelect() {
    const activeVehicles = getActiveVehicles();

    if (vehicleSelect) {
      vehicleSelect.innerHTML = `<option value="">-- Select Vehicle for Test Drive --</option>`;
      activeVehicles.forEach(car => {
        const opt = document.createElement("option");
        opt.value = car.name;
        opt.textContent = `${car.year} ${car.name} (${car.priceFormatted})`;
        vehicleSelect.appendChild(opt);
      });
    }

    const carBookVehicleSelect = document.getElementById("car-book-vehicle");
    if (carBookVehicleSelect) {
      carBookVehicleSelect.innerHTML = `<option value="">-- Choose Vehicle to Book --</option>`;
      activeVehicles.forEach(car => {
        const opt = document.createElement("option");
        opt.value = car.name;
        opt.textContent = `${car.year} ${car.name} - ${car.priceFormatted} (${car.trim})`;
        carBookVehicleSelect.appendChild(opt);
      });
    }

    if (calcVehicleSelect) {
      calcVehicleSelect.innerHTML = `<option value="custom">-- Custom Price / No Vehicle Selected --</option>`;
      activeVehicles.forEach(car => {
        const opt = document.createElement("option");
        opt.value = car.id;
        opt.textContent = `${car.year} ${car.name} - ${car.priceFormatted} (${car.trim})`;
        calcVehicleSelect.appendChild(opt);
      });
    }
  }

  // =========================================================================
  // 3. INVENTORY RENDERING & FILTERING
  // =========================================================================
  function getFilteredVehicles() {
    const activeVehicles = getActiveVehicles();

    return activeVehicles.filter(car => {
      // 1. Category Tab Filter (Unified with dynamic category count predicates)
      if (state.selectedCategory !== "all") {
        if (state.selectedCategory === "suv" && !isSuvVehicle(car)) return false;
        if (state.selectedCategory === "sedan" && !isSedanVehicle(car)) return false;
        if (state.selectedCategory === "electric" && !isElectricOrHybridVehicle(car)) return false;
        if (state.selectedCategory === "luxury" && !isLuxuryVehicle(car)) return false;
      }

      // 2. Search Query (matches name, brand, model, trim, bodyType, fuelType, engine)
      if (state.searchQuery && state.searchQuery.trim()) {
        const query = state.searchQuery.toLowerCase().trim();
        const matchesName = String(car.name || "").toLowerCase().includes(query);
        const matchesBrand = String(car.brand || "").toLowerCase().includes(query);
        const matchesModel = String(car.model || "").toLowerCase().includes(query);
        const matchesTrim = String(car.trim || "").toLowerCase().includes(query);
        const matchesBody = String(car.bodyType || "").toLowerCase().includes(query);
        const matchesFuel = String(car.fuelType || "").toLowerCase().includes(query);
        const matchesEngine = String(car.engine || "").toLowerCase().includes(query);
        if (!matchesName && !matchesBrand && !matchesModel && !matchesTrim && !matchesBody && !matchesFuel && !matchesEngine) {
          return false;
        }
      }

      // 3. Body Type Filter
      if (state.bodyTypeFilter !== "all" && String(car.bodyType || "").toLowerCase() !== state.bodyTypeFilter.toLowerCase()) {
        return false;
      }

      // 4. Fuel Type Filter
      if (state.fuelTypeFilter !== "all" && String(car.fuelType || "").toLowerCase() !== state.fuelTypeFilter.toLowerCase()) {
        return false;
      }

      // 5. Price Range Filter (in INR / Lakhs)
      if (state.priceRangeFilter !== "all") {
        const p = Number(car.price) || 0;
        if (state.priceRangeFilter === "under-25l" && p >= 2500000) return false;
        if (state.priceRangeFilter === "25l-40l" && (p < 2500000 || p > 4000000)) return false;
        if (state.priceRangeFilter === "40l-60l" && (p < 4000000 || p > 6000000)) return false;
        if (state.priceRangeFilter === "above-60l" && p <= 6000000) return false;
      }

      return true;
    }).sort((a, b) => {
      // Sorting
      if (state.sortBy === "price-low") return (Number(a.price) || 0) - (Number(b.price) || 0);
      if (state.sortBy === "price-high") return (Number(b.price) || 0) - (Number(a.price) || 0);
      if (state.sortBy === "mileage") {
        const getMiles = s => parseInt(String(s.mileage || "").replace(/\D/g, "") || "0", 10);
        return getMiles(a) - getMiles(b);
      }
      if (state.sortBy === "year-new") return (Number(b.year) || 0) - (Number(a.year) || 0);
      return 0; // Default featured
    });
  }

  function renderInventoryLoading() {
    updateCategoryCounts();
    if (!inventoryGrid) return;
    if (resultsCountEl) resultsCountEl.textContent = `Connecting to database...`;
    inventoryGrid.innerHTML = `
      <div class="inventory-loading-state" style="grid-column: 1 / -1; width: 100%; padding: 4.5rem 2rem; text-align: center;">
        <div class="spinner" style="margin: 0 auto 1.25rem; width: 44px; height: 44px; border: 3px solid rgba(13,148,136,0.15); border-top-color: var(--teal-600); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <h3 style="font-size: 1.2rem; font-weight: 700; color: var(--navy-900); margin-bottom: 0.5rem;">Connecting to Supabase Database</h3>
        <p style="color: var(--navy-600); font-size: 0.95rem; max-width: 480px; margin: 0 auto; line-height: 1.6;">
          Fetching live verified fleet inventory directly from Supabase PostgreSQL (project: <code>tndaufwuogbojgdwhrxf</code>)...
        </p>
      </div>
    `;
  }

  function renderInventoryError(errMessage) {
    updateCategoryCounts();
    if (!inventoryGrid) return;
    if (resultsCountEl) resultsCountEl.textContent = `Showroom temporarily unavailable`;

    inventoryGrid.innerHTML = `
      <div class="inventory-error-banner" style="grid-column: 1 / -1; width: 100%; padding: 3.5rem 2rem; background: var(--surface-light); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 16px; text-align: center;">
        <div style="width: 56px; height: 56px; border-radius: 50%; background: #fee2e2; color: #dc2626; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <h3 style="font-size: 1.25rem; font-weight: 700; color: var(--navy-950); margin-bottom: 0.5rem;">Showroom Service Unavailable</h3>
        <p style="color: var(--navy-700); font-size: 0.95rem; max-width: 580px; margin: 0 auto 1.25rem; line-height: 1.6;">
          We're unable to load the showroom inventory right now. Please try again shortly.
        </p>
        ${errMessage ? `
          <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); padding: 0.75rem 1rem; border-radius: 8px; max-width: 520px; margin: 0 auto 1.5rem; font-size: 0.85rem; color: #b91c1c;">
            ${escapeHtml(errMessage)}
          </div>
        ` : ''}
        <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
          <button type="button" class="btn btn-primary btn-sm" id="btn-retry-supabase-fetch" style="cursor: pointer;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Retry Loading Showroom
          </button>
          <a href="/admin-login.html" class="btn btn-outline btn-sm">
            Admin Portal
          </a>
        </div>
      </div>
    `;

    const retryBtn = document.getElementById("btn-retry-supabase-fetch");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => {
        syncLiveFleetFromBackend();
      });
    }
  }

  function renderInventoryEmptySupabase() {
    updateCategoryCounts();
    if (!inventoryGrid) return;
    if (resultsCountEl) resultsCountEl.textContent = `0 vehicles in showroom`;
    inventoryGrid.innerHTML = `
      <div class="inventory-empty" style="grid-column: 1 / -1; width: 100%; padding: 4rem 2rem; text-align: center;">
        <div style="width: 60px; height: 60px; border-radius: 50%; background: var(--surface-light); border: 1px solid var(--border-color); color: var(--navy-600); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
          </svg>
        </div>
        <h3 style="font-size: 1.25rem; font-weight: 700; color: var(--navy-900); margin-bottom: 0.5rem;">No vehicles are currently available</h3>
        <p style="color: var(--navy-600); max-width: 540px; margin: 0 auto 1.5rem; line-height: 1.6; font-size: 0.95rem;">
          All our certified vehicles are currently reserved or sold out. Please check back soon or contact our showroom advisors for upcoming allocations.
        </p>
        <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline btn-sm" id="btn-recheck-supabase-empty">
            Refresh Showroom
          </button>
          <a href="/admin-login.html" class="btn btn-primary btn-sm">
            Admin Inventory Portal
          </a>
        </div>
      </div>
    `;
    const recheckBtn = document.getElementById("btn-recheck-supabase-empty");
    if (recheckBtn) recheckBtn.addEventListener("click", () => syncLiveFleetFromBackend());
  }

  function renderInventory() {
    updateCategoryCounts();

    if (isFetchingVehicles) {
      renderInventoryLoading();
      return;
    }

    if (vehicleFetchError) {
      renderInventoryError(vehicleFetchError);
      return;
    }

    const activeVehicles = getActiveVehicles();

    if (activeVehicles.length === 0) {
      renderInventoryEmptySupabase();
      return;
    }

    const filtered = getFilteredVehicles();

    // Results count
    if (resultsCountEl) {
      const total = activeVehicles.length;
      resultsCountEl.textContent = `Showing ${filtered.length} of ${total} vehicle${total === 1 ? '' : 's'}`;
    }

    // Update filter chips
    updateFilterChips();

  /**
   * UNIVERSAL INVENTORY CAR CARD COMPONENT / TEMPLATE
   * Renders the simplified, premium car card for EVERY vehicle in the inventory:
   * 1. Car image
   * 2. Year
   * 3. Car name/model
   * 4. Powertrain / fuel type (e.g. ⚡ Diesel, ⛽ Petrol, ⚡ Electric, 🔋 Hybrid, 💨 CNG)
   * 5. Power figure (e.g. 170 PS, 220 HP, 129 PS, 116 PS)
   * 6. Price (e.g. ₹15,50,000)
   * 7. ONE "VIEW DETAILS →" button
   *
   * Reusable for all current vehicles, admin-added cars, database rows, and future vehicles.
   */
  function getPowertrainBadge(fuelType) {
    const raw = String(fuelType || "").trim();
    const lower = raw.toLowerCase();
    let icon = "⛽";
    let label = raw ? (raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()) : "Petrol";

    if (lower.includes("diesel")) {
      icon = "⚡";
      label = "Diesel";
    } else if (lower.includes("electric") || lower.includes("ev")) {
      icon = "⚡";
      label = "Electric";
    } else if (lower.includes("hybrid")) {
      icon = "🔋";
      label = "Hybrid";
    } else if (lower.includes("cng")) {
      icon = "💨";
      label = "CNG";
    } else if (lower.includes("petrol") || lower.includes("gasoline") || lower.includes("gas")) {
      icon = "⛽";
      label = "Petrol";
    }
    return { icon, label };
  }

  function getVehiclePowerDisplay(car) {
    const raw = String(car.power || car.powerFigure || car.horsepower || car.engineOutput || "").trim();
    if (raw) {
      let first = raw.split("/")[0].trim();
      if (/^\d+\s+(?:Total System|Combined)\s+HP$/i.test(first)) {
        first = first.replace(/(?:Total System|Combined)\s+/i, "");
      }
      return first;
    }
    if (car.engine && (car.engine.includes("PS") || car.engine.includes("HP") || car.engine.includes("kW"))) {
      const match = car.engine.match(/(\d+\s*(?:PS|HP|kW|bhp))/i);
      if (match) return match[1];
    }
    return "170 PS";
  }

  function formatCarCardPrice(car) {
    if (!car) return "₹15.00 Lakh";
    const num = Number(car.price);
    if (!isNaN(num) && num > 0) {
      if (num >= 10000000) {
        const cr = num / 10000000;
        return `₹${cr.toFixed(2)} Cr`;
      }
      if (num >= 100000) {
        const lakhs = num / 100000;
        return `₹${lakhs.toFixed(2)} Lakh`;
      }
      return formatINR(num);
    }
    if (car.priceFormatted && typeof car.priceFormatted === "string") {
      const rawDigits = car.priceFormatted.replace(/\D/g, "");
      const parsed = parseInt(rawDigits, 10);
      if (!isNaN(parsed) && parsed >= 100000) {
        const lakhs = parsed / 100000;
        return `₹${lakhs.toFixed(2)} Lakh`;
      }
      return car.priceFormatted;
    }
    return "Price on Request";
  }

  function formatCarCardPowertrain(car) {
    if (!car) return "Petrol";
    const fuel = String(car.fuelType || car.powertrain || "Petrol").trim();
    const lower = fuel.toLowerCase();
    if (lower === "ev" || lower === "electric") return "Electric";
    if (lower === "hybrid") return "Hybrid";
    if (lower === "diesel") return "Diesel";
    if (lower === "petrol") return "Petrol";
    if (lower === "cng") return "CNG";
    return fuel.charAt(0).toUpperCase() + fuel.slice(1);
  }

  function getCarCardDisplayName(car, year) {
    return getCleanVehicleName(car);
  }

  function renderUniversalCarCard(car) {
    if (!car) return "";
    const carImg = (Array.isArray(car.images) && car.images[0]) || car.image || (typeof car.images === "string" ? car.images : "") || PHOTO_UNAVAILABLE_DATA_URI;
    const year = car.year || new Date().getFullYear();
    const name = getCarCardDisplayName(car, year);
    const powertrain = formatCarCardPowertrain(car);
    const transmission = car.transmission || "Manual";
    let kmRaw = car.kilometersDriven || car.mileage || car.km;
    let kmText = "Verified KM";
    if (kmRaw) {
      let num = typeof kmRaw === "string" ? parseInt(kmRaw.replace(/[^0-9]/g, ""), 10) : Number(kmRaw);
      kmText = !isNaN(num) && num > 0 ? `${num.toLocaleString("en-IN")} km` : String(kmRaw);
    }
    const priceText = formatCarCardPrice(car);
    const isReserved = (car.availability && car.availability.toLowerCase() === "reserved") || (car.status && car.status.toLowerCase() === "reserved");
    const has360 = (Array.isArray(car.exterior360) && car.exterior360.length > 0) || (Array.isArray(car.interior360) && car.interior360.length > 0);

    return `
      <article class="vehicle-card universal-car-card" data-id="${escapeHtml(String(car.id))}">
        <div class="card-media" role="button" tabindex="0" aria-label="View details for ${escapeHtml(name)}">
          <img src="${escapeHtml(carImg)}" alt="${escapeHtml(String(year))} ${escapeHtml(name)}" class="card-img" loading="lazy" onerror="this.onerror=null; this.src='${PHOTO_UNAVAILABLE_DATA_URI}';">
          ${isReserved ? `<span class="card-status-badge is-reserved">Reserved</span>` : ``}
          ${has360 ? `<span class="card-360-badge" title="360° Interactive View Available"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> 360°</span>` : ``}
        </div>
        <div class="card-body">
          <h3 class="card-title" title="${escapeHtml(name)}">${escapeHtml(name)}</h3>
          <div class="card-specs-row">
            <span>${escapeHtml(String(year))}</span>
            <span class="spec-dot">&bull;</span>
            <span>${escapeHtml(powertrain)}</span>
            <span class="spec-dot">&bull;</span>
            <span>${escapeHtml(transmission)}</span>
          </div>
          <div class="card-km-row">${escapeHtml(kmText)}</div>
          <div class="card-price-row">
            <span class="card-price-val">${escapeHtml(priceText)}</span>
          </div>
          <div class="card-action-row">
            <button type="button" class="btn btn-primary btn-card-details car-view-details-btn btn-details" data-id="${escapeHtml(String(car.id))}" aria-label="View details for ${escapeHtml(name)}">
              View Details
            </button>
          </div>
        </div>
      </article>
    `;
  }
  window.renderUniversalCarCard = renderUniversalCarCard;

  // Render Grid
  if (filtered.length === 0) {
    inventoryGrid.innerHTML = `
      <div class="inventory-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 1rem; color: #94a3b8;">
          <circle cx="12" cy="12" r="10"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        <h3>No matching vehicles found</h3>
        <p>Try clearing some filters or search for another vehicle model.</p>
        <button class="btn btn-primary btn-sm" id="empty-reset-btn">Reset All Filters</button>
      </div>
    `;
    const emptyResetBtn = document.getElementById("empty-reset-btn");
    if (emptyResetBtn) emptyResetBtn.addEventListener("click", resetAllFilters);
    return;
  }

  inventoryGrid.innerHTML = filtered.map(car => renderUniversalCarCard(car)).join("");

    // Attach Event Listeners to cards
    attachCardListeners();

    // Refresh horizontal scroll indicator & bounds
    if (typeof updateScrollControls === "function") {
      setTimeout(updateScrollControls, 50);
    }
  }

  function updateFilterChips() {
    if (!activeChipsContainer) return;
    const chips = [];

    if (state.selectedCategory !== "all") {
      chips.push({ label: `Category: ${state.selectedCategory.toUpperCase()}`, key: "category" });
    }
    if (state.searchQuery) {
      chips.push({ label: `Search: "${state.searchQuery}"`, key: "search" });
    }
    if (state.bodyTypeFilter !== "all") {
      chips.push({ label: `Body: ${state.bodyTypeFilter}`, key: "body" });
    }
    if (state.fuelTypeFilter !== "all") {
      chips.push({ label: `Fuel: ${state.fuelTypeFilter}`, key: "fuel" });
    }
    if (state.priceRangeFilter !== "all") {
      const budgetLabels = {
        "under-25l": "Under ₹25L",
        "25l-40l": "₹25L – ₹40L",
        "40l-60l": "₹40L – ₹60L",
        "above-60l": "Above ₹60L"
      };
      chips.push({ label: `Budget: ${budgetLabels[state.priceRangeFilter] || state.priceRangeFilter}`, key: "price" });
    }

    if (chips.length > 0) {
      activeChipsContainer.innerHTML = chips.map(c => `
        <span class="filter-chip">
          ${c.label}
          <button class="filter-chip-remove" data-chip="${c.key}" aria-label="Remove filter">×</button>
        </span>
      `).join("");
      if (clearFiltersBtn) clearFiltersBtn.style.display = "inline-block";
    } else {
      activeChipsContainer.innerHTML = "";
      if (clearFiltersBtn) clearFiltersBtn.style.display = "none";
    }

    // Chip click removals
    activeChipsContainer.querySelectorAll(".filter-chip-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.chip;
        if (key === "category") {
          state.selectedCategory = "all";
          categoryTabs.forEach(t => t.classList.toggle("active", t.dataset.category === "all"));
        } else if (key === "search") {
          state.searchQuery = "";
          if (heroSearchInput) heroSearchInput.value = "";
        } else if (key === "body") {
          state.bodyTypeFilter = "all";
          if (heroBodySelect) heroBodySelect.value = "all";
        } else if (key === "fuel") {
          state.fuelTypeFilter = "all";
          if (heroFuelSelect) heroFuelSelect.value = "all";
        } else if (key === "price") {
          state.priceRangeFilter = "all";
          if (heroPriceSelect) heroPriceSelect.value = "all";
        }
        renderInventory();
      });
    });
  }

  function resetAllFilters() {
    state.selectedCategory = "all";
    state.searchQuery = "";
    state.bodyTypeFilter = "all";
    state.priceRangeFilter = "all";
    state.fuelTypeFilter = "all";
    state.sortBy = "featured";

    if (heroSearchInput) heroSearchInput.value = "";
    if (heroBodySelect) heroBodySelect.value = "all";
    if (heroPriceSelect) heroPriceSelect.value = "all";
    if (heroFuelSelect) heroFuelSelect.value = "all";
    if (sortSelect) sortSelect.value = "featured";

    categoryTabs.forEach(t => t.classList.toggle("active", t.dataset.category === "all"));
    renderInventory();
    showToast("All filters have been reset", "info");
  }

  function attachCardListeners() {
    // View Details Buttons
    document.querySelectorAll(".btn-details").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        openVehicleDetails(id);
      });
    });

    // Card media click to view details
    document.querySelectorAll(".vehicle-card .card-media").forEach(media => {
      media.addEventListener("click", (e) => {
        const card = e.currentTarget.closest(".vehicle-card");
        if (card && card.dataset.id) {
          openVehicleDetails(card.dataset.id);
        }
      });
      media.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const card = e.currentTarget.closest(".vehicle-card");
          if (card && card.dataset.id) {
            openVehicleDetails(card.dataset.id);
          }
        }
      });
    });

    // Test Drive Buttons
    document.querySelectorAll(".btn-test-drive").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const id = e.currentTarget.dataset.id;
        const car = VEHICLES.find(v => v.id === id);
        if (car) bookTestDriveForCar(car);
      });
    });

    // Book Car Buttons
    document.querySelectorAll(".btn-book-car").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const id = e.currentTarget.dataset.id;
        const car = VEHICLES.find(v => v.id === id);
        if (car) bookCarOnline(car);
      });
    });

    // Compare Checkboxes
    document.querySelectorAll(".compare-card-checkbox").forEach(box => {
      box.addEventListener("change", (e) => {
        const id = e.target.dataset.id;
        toggleCompareVehicle(id, e.target.checked);
      });
    });

    // Quick Calculator Launch from Cards: opens vehicle details with loan calculator active
    document.querySelectorAll(".price-monthly-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const id = e.currentTarget.dataset.id;
        openVehicleDetails(id, "calc");
      });
    });
  }

  // =========================================================================
  // 4. SIDE-BY-SIDE COMPARE SYSTEM (Max 3, Min 2)
  // =========================================================================
  function toggleCompareVehicle(id, isAdding) {
    if (isAdding) {
      if (state.comparedIds.length >= 3) {
        showToast("You can compare a maximum of 3 vehicles at once", "warning");
        // Revert checkbox in DOM
        renderInventory();
        return;
      }
      if (!state.comparedIds.includes(id)) {
        state.comparedIds.push(id);
        const car = VEHICLES.find(v => v.id === id);
        showToast(`Added ${car.name} to comparison (${state.comparedIds.length}/3)`, "success");
      }
    } else {
      state.comparedIds = state.comparedIds.filter(item => item !== id);
      const car = VEHICLES.find(v => v.id === id);
      showToast(`Removed ${car ? car.name : 'vehicle'} from comparison`, "info");
    }

    updateCompareDock();
    renderInventory();
  }

  function updateCompareDock() {
    const count = state.comparedIds.length;

    // Update Nav Badge
    if (navCompareCount) navCompareCount.textContent = count;

    // Update Bottom Dock
    if (dockCountEl) dockCountEl.textContent = count;

    if (count > 0) {
      compareDock.classList.add("visible");
      const selectedCars = VEHICLES.filter(v => state.comparedIds.includes(v.id));
      dockItemsContainer.innerHTML = selectedCars.map(car => {
        const thumb = (Array.isArray(car.images) && car.images[0]) || car.image || PHOTO_UNAVAILABLE_DATA_URI;
        return `
        <div class="dock-item-pill">
          <img src="${escapeHtml(thumb)}" alt="${escapeHtml(car.name)}" onerror="this.onerror=null; this.src='${PHOTO_UNAVAILABLE_DATA_URI}';">
          <span>${escapeHtml(car.name)}</span>
          <button class="dock-remove-item" data-id="${escapeHtml(car.id)}" aria-label="Remove ${escapeHtml(car.name)}">×</button>
        </div>
      `;
      }).join("");

      // Remove from dock buttons
      dockItemsContainer.querySelectorAll(".dock-remove-item").forEach(btn => {
        btn.addEventListener("click", () => {
          toggleCompareVehicle(btn.dataset.id, false);
        });
      });
    } else {
      compareDock.classList.remove("visible");
      dockItemsContainer.innerHTML = "";
    }
  }

  function openCompareModal() {
    if (state.comparedIds.length < 2) {
      showToast("Please select at least 2 vehicles to view comparison", "warning");
      // Smooth scroll to inventory so user selects vehicles
      const invSection = document.getElementById("inventory");
      if (invSection) invSection.scrollIntoView({ behavior: "smooth" });
      return;
    }

    renderCompareTable();
    compareModal.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeCompareModal() {
    compareModal.classList.remove("active");
    document.body.style.overflow = "";
  }

  function renderCompareTable() {
    const cars = VEHICLES.filter(v => state.comparedIds.includes(v.id));
    const showDiffOnly = diffToggle ? diffToggle.checked : false;

    // Define specs to compare
    const specFields = [
      { label: "Price (MSRP)", key: "priceFormatted" },
      { label: "Est. Financing", key: "monthlyEst" },
      { label: "Body Style", key: "bodyType" },
      { label: "Fuel / Powertrain", key: "fuelType", transform: v => v.toUpperCase() },
      { label: "Engine / Motor", key: "engine" },
      { label: "Horsepower & Torque", key: "power" },
      { label: "Transmission", key: "transmission" },
      { label: "Drivetrain", key: "drivetrain" },
      { label: "Seating Capacity", key: "seating" },
      { label: "Fuel Economy / Range", key: "fuelEconomy", transform: (v, car) => car.fuelType === 'electric' ? car.range : v },
      { label: "Acceleration (0-60)", key: "acceleration" },
      { label: "Top Speed", key: "topSpeed" },
      { label: "Safety Rating", key: "safetyRating" },
      { label: "Factory Warranty", key: "warranty" }
    ];

    let theadHtml = `
      <tr>
        <th>Specification</th>
        ${cars.map(c => {
          const thumb = (Array.isArray(c.images) && c.images[0]) || c.image || PHOTO_UNAVAILABLE_DATA_URI;
          return `
          <td class="compare-card-head">
            <img src="${escapeHtml(thumb)}" alt="${escapeHtml(c.name)}" onerror="this.onerror=null; this.src='${PHOTO_UNAVAILABLE_DATA_URI}';">
            <div class="compare-car-name">${escapeHtml(c.name)}</div>
            <div class="compare-car-price">${escapeHtml(c.priceFormatted || formatINR(c.price))}</div>
            <div style="display: flex; gap: 0.5rem; justify-content: center; margin-top: 0.5rem;">
              <button class="btn btn-primary btn-sm book-from-compare" data-id="${escapeHtml(c.id)}">Test Drive</button>
              <button class="btn btn-secondary btn-sm remove-from-compare" data-id="${escapeHtml(c.id)}" title="Remove">Remove</button>
            </div>
          </td>
        `;
        }).join("")}
        ${cars.length < 3 ? `
          <td class="compare-slot-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom: 0.5rem; color: #94a3b8;">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="16"/>
              <line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
            <p style="font-weight: 600; font-size: 0.85rem;">Add 3rd Vehicle</p>
            <p style="font-size: 0.75rem;">Select another vehicle from inventory to compare</p>
          </td>
        ` : ''}
      </tr>
    `;

    let tbodyHtml = specFields.map(field => {
      // Check if values differ
      const values = cars.map(c => {
        let val = c[field.key];
        if (field.transform) val = field.transform(val, c);
        return String(val);
      });
      const allSame = values.every(v => v === values[0]);

      if (showDiffOnly && allSame) {
        return ""; // Skip identical rows if diff only
      }

      return `
        <tr class="${!allSame ? 'row-highlight' : ''}">
          <th>${field.label}</th>
          ${cars.map(c => {
            let val = c[field.key];
            if (field.transform) val = field.transform(val, c);
            return `<td><strong>${val}</strong></td>`;
          }).join("")}
          ${cars.length < 3 ? `<td>-</td>` : ''}
        </tr>
      `;
    }).join("");

    compareTableContainer.innerHTML = `
      <table class="compare-table">
        <thead>${theadHtml}</thead>
        <tbody>${tbodyHtml}</tbody>
      </table>
    `;

    // Attach Compare Modal Action Listeners
    compareTableContainer.querySelectorAll(".remove-from-compare").forEach(btn => {
      btn.addEventListener("click", () => {
        toggleCompareVehicle(btn.dataset.id, false);
        if (state.comparedIds.length < 2) {
          closeCompareModal();
        } else {
          renderCompareTable();
        }
      });
    });

    compareTableContainer.querySelectorAll(".book-from-compare").forEach(btn => {
      btn.addEventListener("click", () => {
        const car = VEHICLES.find(v => v.id === btn.dataset.id);
        closeCompareModal();
        bookTestDriveForCar(car);
      });
    });
  }

  // =========================================================================
  // 5. VEHICLE DETAILS MODAL WITH INTEGRATED IN-CAR LOAN CALCULATOR
  // =========================================================================
  function openVehicleDetails(carId, defaultTab = "specs") {
    const car = VEHICLES.find(v => v.id === carId);
    if (!car) return;

    const isCompared = state.comparedIds.includes(car.id);
    const carImages = (Array.isArray(car.images) && car.images.length > 0) ? car.images : (car.image ? [car.image] : [PHOTO_UNAVAILABLE_DATA_URI]);

    // Update modal header subtitle
    const modalSubtitle = document.getElementById("details-modal-subtitle");
    if (modalSubtitle) {
      modalSubtitle.innerHTML = `${escapeHtml(String(car.year || ''))} ${escapeHtml(car.name)} &bull; ${escapeHtml(car.trim || car.variant || 'Edition')} &bull; ${escapeHtml(car.priceFormatted || formatINR(car.price))}`;
    }

    const extFrames = Array.isArray(car.exterior360) ? car.exterior360 : [];
    const intFrames = Array.isArray(car.interior360) ? car.interior360 : [];

    detailsModalBody.innerHTML = `
      <div class="details-layout">
        <!-- Left: Image Gallery / 360 Viewer & Highlights -->
        <div class="details-gallery">
          <!-- Media View Switcher Bar -->
          <div class="media-view-switcher" role="tablist" aria-label="Vehicle Media Modes">
            <button type="button" class="media-view-btn active" data-media-mode="photos" id="btn-media-photos" role="tab" aria-selected="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span>Photos (${carImages.length})</span>
            </button>
            <button type="button" class="media-view-btn ${extFrames.length === 0 ? 'is-empty' : ''}" data-media-mode="exterior360" id="btn-media-ext360" role="tab" aria-selected="false">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
              <span>Exterior 360° ${extFrames.length ? `(${extFrames.length})` : ''}</span>
            </button>
            <button type="button" class="media-view-btn ${intFrames.length === 0 ? 'is-empty' : ''}" data-media-mode="interior360" id="btn-media-int360" role="tab" aria-selected="false">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
              <span>Interior 360° ${intFrames.length ? `(${intFrames.length})` : ''}</span>
            </button>
          </div>

          <!-- Media Stage: Photos Pane -->
          <div class="media-stage-pane active" id="media-pane-photos" role="tabpanel">
            <div class="gallery-main">
              <img src="${escapeHtml(carImages[0])}" alt="${escapeHtml(car.name)} primary view" id="modal-main-img" onerror="this.onerror=null; this.src='${PHOTO_UNAVAILABLE_DATA_URI}';">
            </div>
            <div class="gallery-thumbs">
              ${carImages.map((imgUrl, index) => `
                <button class="gallery-thumb ${index === 0 ? 'active' : ''}" data-index="${index}" aria-label="View photo ${index + 1}">
                  <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(car.name)} angle ${index + 1}" onerror="this.onerror=null; this.src='${PHOTO_UNAVAILABLE_DATA_URI}';">
                </button>
              `).join("")}
            </div>
          </div>

          <!-- Media Stage: Exterior 360 Pane -->
          <div class="media-stage-pane" id="media-pane-exterior360" role="tabpanel">
            <div id="exterior-360-container" class="viewer-360-wrapper"></div>
          </div>

          <!-- Media Stage: Interior 360 Pane -->
          <div class="media-stage-pane" id="media-pane-interior360" role="tabpanel">
            <div id="interior-360-container" class="viewer-360-wrapper"></div>
          </div>

          <div class="details-highlights" style="margin-top: 1.25rem;">
            <div class="highlights-title">Key Vehicle Highlights</div>
            <div class="highlights-list">
              ${(Array.isArray(car.highlights) && car.highlights.length > 0 ? car.highlights : ["Verified Dealership Fleet", "Multipoint Inspected", "Clean History"]).map(h => `<span class="highlight-tag">${escapeHtml(h)}</span>`).join("")}
            </div>
          </div>
        </div>

        <!-- Right: Details, Tabs, Specs, & In-Car Loan Calculator -->
        <div class="details-info">
          <div class="details-header">
            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <span class="badge ${car.badgeClass}">${car.badge}</span>
              <span class="badge badge-dark">${car.bodyType}</span>
              <span class="badge" style="background: rgba(197, 168, 128, 0.12); color: #C5A880; font-weight: 700; border: 1px solid rgba(197, 168, 128, 0.35);">${car.fuelType.toUpperCase()}</span>
            </div>
            <h2 class="details-title" style="margin-top: 0.5rem;">${car.year} ${car.name}</h2>
            <div style="font-size: 0.9rem; color: var(--color-text-muted, #64748b);">${car.trim}</div>
            
            <div class="details-pricing">
              <div class="details-price-main">${car.priceFormatted}</div>
              <div class="details-price-note">${car.monthlyEst ? `${car.monthlyEst} estimated EMI` : 'Pre-owned vehicle in showroom'}</div>
            </div>
          </div>

          <!-- In-Modal View Switcher Tabs -->
          <div class="details-tabs" role="tablist">
            <button type="button" class="details-tab-btn ${defaultTab === 'specs' ? 'active' : ''}" id="tab-btn-specs" role="tab" aria-selected="${defaultTab === 'specs'}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              <span>Specifications</span>
            </button>
            <button type="button" class="details-tab-btn ${defaultTab === 'calc' ? 'active' : ''}" id="tab-btn-calc" role="tab" aria-selected="${defaultTab === 'calc'}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <line x1="12" y1="8" x2="12" y2="16"/>
                <line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
              <span>EMI Calculator</span>
            </button>
          </div>

          <!-- TAB PANE 1: SPECIFICATIONS -->
          <div class="details-tab-pane ${defaultTab === 'specs' ? 'active' : ''}" id="details-pane-specs">
            <table class="specs-table">
              <tbody>
                <tr>
                  <th>Engine / Powertrain</th>
                  <td>${car.engine || "Standard"}</td>
                </tr>
                <tr>
                  <th>Power Output</th>
                  <td>${car.power || "Standard"}</td>
                </tr>
                <tr>
                  <th>Transmission</th>
                  <td>${car.transmission || "Manual"}</td>
                </tr>
                <tr>
                  <th>Drivetrain</th>
                  <td>${car.drivetrain || "FWD"}</td>
                </tr>
                <tr>
                  <th>Fuel Type</th>
                  <td>${car.fuelType || "Petrol"}</td>
                </tr>
                <tr>
                  <th>Seating</th>
                  <td>${car.seating || "5 Seater"}</td>
                </tr>
                <tr>
                  <th>Kilometers / Mileage</th>
                  <td>${car.kilometersDriven || car.mileage || "Verified"}</td>
                </tr>
                <tr>
                  <th>Registration</th>
                  <td>${car.registrationDetails || "Maharashtra (MH)"}</td>
                </tr>
              </tbody>
            </table>

            <div class="details-actions" style="margin-top: 1.25rem; display: flex; flex-wrap: wrap; gap: 0.5rem;">
              <button class="btn btn-primary" id="modal-book-drive" style="flex: 1.2;">
                Request Test Drive
              </button>
              <button class="btn btn-secondary" id="modal-book-car" style="flex: 1.2;">
                Inquire About Car
              </button>
              <button class="btn btn-secondary" id="modal-calc-loan" style="flex: 1;">
                EMI Calculator
              </button>
              <button class="btn ${isCompared ? 'btn-dark' : 'btn-secondary'}" id="modal-toggle-compare" style="flex: 0.9;">
                ${isCompared ? 'In Comparison' : '+ Compare'}
              </button>
            </div>
          </div>

          <!-- TAB PANE 2: LOAN & EMI CALCULATOR (INSIDE CAR DETAILS) -->
          <div class="details-tab-pane ${defaultTab === 'calc' ? 'active' : ''}" id="details-pane-calc">
            <div class="modal-calc-container">
              <div class="modal-calc-grid">
                <!-- Inputs Column -->
                <div class="modal-calc-inputs">
                  <div class="calc-field-group">
                    <label class="calc-label" style="font-weight: 700;">
                      <span>Car Price (₹ INR)</span>
                      <span style="font-size: 0.8125rem; color: #C5A880; font-weight: 700;">${car.priceFormatted}</span>
                    </label>
                    <input type="hidden" id="inmodal-price" value="${car.price}">
                  </div>

                  <!-- Down Payment -->
                  <div class="calc-field-group">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                      <label class="calc-label" style="margin: 0; font-size: 0.8125rem; font-weight: 600;">Down Payment (₹)</label>
                      <span id="inmodal-down-pct-label" style="font-size: 0.75rem; color: var(--color-text-muted, #94a3b8); font-weight: 600;">15%</span>
                    </div>
                    <div class="calc-input-with-symbol">
                      <span class="currency-symbol">₹</span>
                      <input type="number" id="inmodal-down" class="calc-number-input" value="${Math.round(car.price * 0.15)}" min="0" max="${car.price}" step="10000" style="padding-left: 2rem;">
                    </div>
                    <input type="range" id="inmodal-down-slider" class="calc-range-slider" min="0" max="${Math.round(car.price * 0.5)}" step="5000" value="${Math.round(car.price * 0.15)}" style="margin-top: 0.5rem;">
                    
                    <div class="quick-chips-row" style="display: flex; gap: 0.35rem; margin-top: 0.4rem; flex-wrap: wrap;">
                      <button type="button" class="quick-chip" data-pct="0">0%</button>
                      <button type="button" class="quick-chip" data-pct="10">10%</button>
                      <button type="button" class="quick-chip active" data-pct="15">15%</button>
                      <button type="button" class="quick-chip" data-pct="20">20%</button>
                      <button type="button" class="quick-chip" data-pct="30">30%</button>
                    </div>
                  </div>

                  <!-- Trade-in -->
                  <div class="calc-field-group">
                    <label class="calc-label" style="font-size: 0.8125rem; font-weight: 600;">Trade-in Allowance (Optional)</label>
                    <div class="calc-input-with-symbol">
                      <span class="currency-symbol">₹</span>
                      <input type="number" id="inmodal-trade" class="calc-number-input" value="0" min="0" max="2500000" step="10000" style="padding-left: 2rem;">
                    </div>
                  </div>

                  <!-- Loan Term -->
                  <div class="calc-field-group">
                    <label class="calc-label" style="font-size: 0.8125rem; font-weight: 600;">Financing Term (Months)</label>
                    <select id="inmodal-term" class="calc-select-input" style="width: 100%; padding: 0.5rem; border-radius: 6px; font-weight: 600;">
                      <option value="24">24 Months (2 Years)</option>
                      <option value="36">36 Months (3 Years)</option>
                      <option value="48">48 Months (4 Years)</option>
                      <option value="60" selected>60 Months (5 Years)</option>
                      <option value="72">72 Months (6 Years)</option>
                      <option value="84">84 Months (7 Years)</option>
                    </select>
                  </div>

                  <!-- Interest APR -->
                  <div class="calc-field-group">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                      <label class="calc-label" style="margin: 0; font-size: 0.8125rem; font-weight: 600;">Annual Interest Rate (APR)</label>
                      <span id="inmodal-rate-display" style="font-size: 0.75rem; font-weight: 700; color: #C5A880;">8.5%</span>
                    </div>
                    <input type="range" id="inmodal-rate-slider" class="calc-range-slider" min="5" max="18" step="0.1" value="8.5">
                    <div class="rate-presets-row" style="display: flex; gap: 0.35rem; margin-top: 0.4rem; flex-wrap: wrap;">
                      <button type="button" class="quick-chip" data-apr="7.95">7.95% (Prime)</button>
                      <button type="button" class="quick-chip active" data-apr="8.5">8.5% (Certified)</button>
                      <button type="button" class="quick-chip" data-apr="9.75">9.75% (Standard)</button>
                      <button type="button" class="quick-chip" data-apr="11.5">11.5% (Flex)</button>
                    </div>
                  </div>

                  <!-- Tax Toggle -->
                  <label class="checkbox-label" style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; cursor: pointer;">
                    <input type="checkbox" id="inmodal-tax-toggle" checked>
                    <span>Include Estimated RTO Taxes (8.5%) & Registration (₹25,000)</span>
                  </label>
                </div>

                <!-- Results Column -->
                <div class="modal-calc-results">
                  <div class="calc-main-result">
                    <div class="calc-result-period" id="inmodal-payment-period">Estimated Monthly Installment</div>
                    <div class="calc-result-amount" id="inmodal-payment-amount">₹0</div>
                    <div class="calc-result-condition" id="inmodal-payment-condition">Calculating...</div>
                  </div>

                  <!-- Frequency Selector -->
                  <div class="payment-frequency-toggle" style="display: flex; gap: 0.5rem; justify-content: center;">
                    <button type="button" class="btn btn-sm btn-light freq-btn active" data-freq="monthly" id="inmodal-freq-monthly" style="font-weight: 600; padding: 0.35rem 0.85rem;">Monthly</button>
                    <button type="button" class="btn btn-sm btn-secondary freq-btn" data-freq="biweekly" id="inmodal-freq-biweekly" style="font-weight: 600; padding: 0.35rem 0.85rem;">Bi-Weekly</button>
                  </div>

                  <!-- Composition Bar -->
                  <div class="calc-composition-bar" style="height: 8px; border-radius: 4px; overflow: hidden; display: flex; background: rgba(255,255,255,0.15); margin: 0.5rem 0;">
                    <div id="inmodal-bar-principal" style="width: 70%; background: #C5A880;" title="Principal"></div>
                    <div id="inmodal-bar-interest" style="width: 20%; background: #f59e0b;" title="Interest"></div>
                    <div id="inmodal-bar-tax" style="width: 10%; background: #10b981;" title="Taxes"></div>
                  </div>

                  <!-- Breakdown List -->
                  <div style="font-size: 0.8125rem; display: flex; flex-direction: column; gap: 0.35rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 0.75rem;">
                    <div style="display: flex; justify-content: space-between;">
                      <span style="color: #94a3b8;">Vehicle Price:</span>
                      <strong id="inmodal-res-price">${car.priceFormatted}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                      <span style="color: #94a3b8;">Net Down & Trade:</span>
                      <span id="inmodal-res-down" style="color: #4ade80;">-₹0</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                      <span style="color: #94a3b8;">Financed Principal:</span>
                      <strong id="inmodal-res-principal">₹0</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                      <span style="color: #94a3b8;">RTO & Registration:</span>
                      <span id="inmodal-res-tax">₹0</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                      <span style="color: #94a3b8;">Total Interest (APR):</span>
                      <span id="inmodal-res-interest" style="color: #fbbf24;">₹0</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 0.4rem; font-weight: 700;">
                      <span>Total Overall Cost:</span>
                      <span id="inmodal-res-total" style="color: #C5A880;">₹0</span>
                    </div>
                  </div>

                  <!-- Action Buttons -->
                  <button type="button" class="btn btn-primary btn-block" id="inmodal-apply-btn" style="margin-top: 0.5rem; background: #C5A880; color: #0A0D14;;">
                    Apply for Pre-Approval with this Quote
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm btn-block" id="inmodal-back-to-specs">
                    &larr; Back to Specifications
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Interactive gallery thumbnails
    const mainImg = document.getElementById("modal-main-img");
    const thumbs = detailsModalBody.querySelectorAll(".gallery-thumb");
    thumbs.forEach(thumb => {
      thumb.addEventListener("click", () => {
        thumbs.forEach(t => t.classList.remove("active"));
        thumb.classList.add("active");
        const idx = parseInt(thumb.dataset.index, 10);
        if (carImages[idx]) {
          mainImg.src = carImages[idx];
        }
      });
    });

    // Media Switcher Tabs (Photos vs Exterior 360 vs Interior 360)
    const mediaBtns = detailsModalBody.querySelectorAll(".media-view-btn");
    const mediaPanes = detailsModalBody.querySelectorAll(".media-stage-pane");
    let ext360Initialized = false;
    let int360Initialized = false;

    function switchMediaMode(mode) {
      mediaBtns.forEach(btn => {
        const isActive = btn.dataset.mediaMode === mode;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-selected", isActive ? "true" : "false");
      });
      mediaPanes.forEach(pane => {
        const paneMode = pane.id.replace("media-pane-", "");
        pane.classList.toggle("active", paneMode === mode);
      });

      if (mode === "exterior360" && !ext360Initialized) {
        ext360Initialized = true;
        const container = document.getElementById("exterior-360-container");
        create360Viewer(container, car.exterior360 || [], car.name, "Exterior");
      } else if (mode === "interior360" && !int360Initialized) {
        int360Initialized = true;
        const container = document.getElementById("interior-360-container");
        create360Viewer(container, car.interior360 || [], car.name, "Interior");
      }
    }

    mediaBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        switchMediaMode(btn.dataset.mediaMode);
      });
    });

    // Helper: Initialize interactive frame-based 360 viewer or fallback
    function create360Viewer(containerEl, frames, vehicleName, viewTitle) {
      if (!containerEl) return;
      if (!frames || !Array.isArray(frames) || frames.length === 0) {
        containerEl.innerHTML = `
          <div class="viewer-360-unavailable">
            <div class="unavailable-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
                <path d="M2 12h20"/>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
              </svg>
            </div>
            <h4>${escapeHtml(viewTitle)} 360° View Unavailable</h4>
            <p>${escapeHtml(viewTitle)} 360° view isn't available for this vehicle yet. You can inspect high-resolution studio photos in the gallery.</p>
            <button type="button" class="btn btn-secondary btn-sm btn-fallback-photos" style="margin-top: 0.75rem;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span>View Photos</span>
            </button>
          </div>
        `;
        const backBtn = containerEl.querySelector(".btn-fallback-photos");
        backBtn?.addEventListener("click", () => {
          switchMediaMode("photos");
        });
        return;
      }

      // Render 360 Interactive Viewer Component
      const totalFrames = frames.length;
      let currentFrameIndex = 0;
      let isDragging = false;
      let startX = 0;
      const dragSensitivity = 12; // px per frame advance
      let accumulatedDelta = 0;
      let isAutoSpinning = false;
      let autoSpinTimer = null;
      const imageCache = [];

      containerEl.innerHTML = `
        <div class="viewer-360-stage" tabindex="0" role="region" aria-label="${escapeHtml(vehicleName)} ${escapeHtml(viewTitle)} 360 Viewer. Use left and right arrow keys or drag horizontally to rotate.">
          <!-- Main Display Frame -->
          <img src="${escapeHtml(frames[0])}" alt="${escapeHtml(vehicleName)} ${escapeHtml(viewTitle)} 360 degree frame 1 of ${totalFrames}" class="viewer-360-image" id="viewer-current-img-${viewTitle.toLowerCase()}" draggable="false" />

          <!-- First-time Drag Hint Overlay -->
          <div class="viewer-360-hint" id="viewer-drag-hint-${viewTitle.toLowerCase()}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            <span>Drag or swipe horizontally to explore 360°</span>
          </div>

          <!-- Controls Toolbar -->
          <div class="viewer-360-toolbar">
            <button type="button" class="v360-btn" id="v360-prev-${viewTitle.toLowerCase()}" title="Rotate Left (Left Arrow)" aria-label="Rotate left">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button type="button" class="v360-btn" id="v360-reset-${viewTitle.toLowerCase()}" title="Reset to Initial Angle" aria-label="Reset angle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/></svg>
              <span style="font-size: 0.75rem; font-weight: 600; margin-left: 4px;">Reset</span>
            </button>
            <div class="v360-counter" id="v360-counter-${viewTitle.toLowerCase()}">
              <span id="v360-num-${viewTitle.toLowerCase()}">1</span> / ${totalFrames}
            </div>
            <button type="button" class="v360-btn" id="v360-spin-${viewTitle.toLowerCase()}" title="Auto-Spin Preview" aria-label="Toggle auto spin">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span style="font-size: 0.75rem; font-weight: 600; margin-left: 4px;" class="v360-spin-text">Spin</span>
            </button>
            <button type="button" class="v360-btn" id="v360-next-${viewTitle.toLowerCase()}" title="Rotate Right (Right Arrow)" aria-label="Rotate right">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      `;

      const stage = containerEl.querySelector(".viewer-360-stage");
      const imgEl = containerEl.querySelector(`#viewer-current-img-${viewTitle.toLowerCase()}`);
      const hintEl = containerEl.querySelector(`#viewer-drag-hint-${viewTitle.toLowerCase()}`);
      const frameNumEl = containerEl.querySelector(`#v360-num-${viewTitle.toLowerCase()}`);
      const prevBtn = containerEl.querySelector(`#v360-prev-${viewTitle.toLowerCase()}`);
      const nextBtn = containerEl.querySelector(`#v360-next-${viewTitle.toLowerCase()}`);
      const resetBtn = containerEl.querySelector(`#v360-reset-${viewTitle.toLowerCase()}`);
      const spinBtn = containerEl.querySelector(`#v360-spin-${viewTitle.toLowerCase()}`);
      const spinText = spinBtn?.querySelector(".v360-spin-text");

      function renderFrame(index) {
        currentFrameIndex = (index % totalFrames + totalFrames) % totalFrames;
        if (imgEl && frames[currentFrameIndex]) {
          imgEl.src = frames[currentFrameIndex];
          imgEl.alt = `${vehicleName} ${viewTitle} frame ${currentFrameIndex + 1} of ${totalFrames}`;
        }
        if (frameNumEl) {
          frameNumEl.textContent = String(currentFrameIndex + 1);
        }
      }

      function hideHint() {
        if (hintEl && hintEl.parentElement) {
          hintEl.style.opacity = "0";
          hintEl.style.pointerEvents = "none";
          setTimeout(() => {
            if (hintEl && hintEl.parentElement) hintEl.remove();
          }, 300);
        }
      }

      function stopAutoSpin() {
        if (isAutoSpinning) {
          isAutoSpinning = false;
          if (autoSpinTimer) clearInterval(autoSpinTimer);
          if (spinBtn) {
            spinBtn.classList.remove("active");
            if (spinText) spinText.textContent = "Spin";
          }
        }
      }

      function toggleAutoSpin() {
        if (isAutoSpinning) {
          stopAutoSpin();
        } else {
          hideHint();
          isAutoSpinning = true;
          if (spinBtn) {
            spinBtn.classList.add("active");
            if (spinText) spinText.textContent = "Stop";
          }
          autoSpinTimer = setInterval(() => {
            renderFrame(currentFrameIndex + 1);
          }, 100);
        }
      }

      // Pointer events for desktop drag and mobile swipe
      stage.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".viewer-360-toolbar")) return;
        hideHint();
        stopAutoSpin();
        isDragging = true;
        startX = e.clientX;
        accumulatedDelta = 0;
        stage.classList.add("is-dragging");
        try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      });

      stage.addEventListener("pointermove", (e) => {
        if (!isDragging) return;
        const deltaX = e.clientX - startX;
        startX = e.clientX;
        accumulatedDelta += deltaX;

        if (Math.abs(accumulatedDelta) >= dragSensitivity) {
          const steps = Math.trunc(accumulatedDelta / dragSensitivity);
          renderFrame(currentFrameIndex - steps);
          accumulatedDelta -= steps * dragSensitivity;
        }
      });

      const handlePointerUp = (e) => {
        if (isDragging) {
          isDragging = false;
          stage.classList.remove("is-dragging");
          try { stage.releasePointerCapture(e.pointerId); } catch (_) {}
        }
      };

      stage.addEventListener("pointerup", handlePointerUp);
      stage.addEventListener("pointercancel", handlePointerUp);

      // Keyboard navigation support
      stage.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          hideHint();
          stopAutoSpin();
          renderFrame(currentFrameIndex - 1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          hideHint();
          stopAutoSpin();
          renderFrame(currentFrameIndex + 1);
        } else if (e.key === "Home") {
          e.preventDefault();
          hideHint();
          stopAutoSpin();
          renderFrame(0);
        } else if (e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          toggleAutoSpin();
        }
      });

      // Controls buttons
      prevBtn?.addEventListener("click", () => {
        hideHint();
        stopAutoSpin();
        renderFrame(currentFrameIndex - 1);
      });

      nextBtn?.addEventListener("click", () => {
        hideHint();
        stopAutoSpin();
        renderFrame(currentFrameIndex + 1);
      });

      resetBtn?.addEventListener("click", () => {
        hideHint();
        stopAutoSpin();
        renderFrame(0);
      });

      spinBtn?.addEventListener("click", () => {
        toggleAutoSpin();
      });

      // Progressive preload of remaining frames in background
      frames.forEach((src, idx) => {
        const img = new Image();
        img.src = src;
        img.onload = () => { imageCache[idx] = img; };
      });
    }

    // Book test drive from modal
    const modalBookBtn = document.getElementById("modal-book-drive");
    if (modalBookBtn) {
      modalBookBtn.addEventListener("click", () => {
        closeDetailsModal();
        bookTestDriveForCar(car);
      });
    }

    // Book car online from modal
    const modalBookCarBtn = document.getElementById("modal-book-car");
    if (modalBookCarBtn) {
      modalBookCarBtn.addEventListener("click", () => {
        closeDetailsModal();
        bookCarOnline(car);
      });
    }

    // Toggle compare from modal
    const modalCompareBtn = document.getElementById("modal-toggle-compare");
    if (modalCompareBtn) {
      modalCompareBtn.addEventListener("click", () => {
        const alreadyCompared = state.comparedIds.includes(car.id);
        toggleCompareVehicle(car.id, !alreadyCompared);
        modalCompareBtn.textContent = !alreadyCompared ? "In Comparison" : "+ Compare";
        modalCompareBtn.className = !alreadyCompared ? "btn btn-dark" : "btn btn-secondary";
      });
    }

    // Tab Switching Logic
    const tabSpecsBtn = document.getElementById("tab-btn-specs");
    const tabCalcBtn = document.getElementById("tab-btn-calc");
    const paneSpecs = document.getElementById("details-pane-specs");
    const paneCalc = document.getElementById("details-pane-calc");

    function setDetailsTab(tabName) {
      if (tabName === "calc") {
        tabSpecsBtn.classList.remove("active");
        tabCalcBtn.classList.add("active");
        tabSpecsBtn.setAttribute("aria-selected", "false");
        tabCalcBtn.setAttribute("aria-selected", "true");
        paneSpecs.classList.remove("active");
        paneCalc.classList.add("active");
      } else {
        tabCalcBtn.classList.remove("active");
        tabSpecsBtn.classList.add("active");
        tabCalcBtn.setAttribute("aria-selected", "false");
        tabSpecsBtn.setAttribute("aria-selected", "true");
        paneCalc.classList.remove("active");
        paneSpecs.classList.add("active");
      }
    }

    if (tabSpecsBtn && tabCalcBtn) {
      tabSpecsBtn.addEventListener("click", () => setDetailsTab("specs"));
      tabCalcBtn.addEventListener("click", () => setDetailsTab("calc"));
    }

    const modalCalcLoan = document.getElementById("modal-calc-loan");
    if (modalCalcLoan) {
      modalCalcLoan.addEventListener("click", () => setDetailsTab("calc"));
    }

    const backToSpecsBtn = document.getElementById("inmodal-back-to-specs");
    if (backToSpecsBtn) {
      backToSpecsBtn.addEventListener("click", () => setDetailsTab("specs"));
    }

    // =======================================================================
    // IN-MODAL LOAN CALCULATOR ENGINE FOR THIS CAR
    // =======================================================================
    const inPrice = car.price;
    const inDown = document.getElementById("inmodal-down");
    const inDownSlider = document.getElementById("inmodal-down-slider");
    const inDownPctLabel = document.getElementById("inmodal-down-pct-label");
    const inTrade = document.getElementById("inmodal-trade");
    const inTerm = document.getElementById("inmodal-term");
    const inRateSlider = document.getElementById("inmodal-rate-slider");
    const inRateDisplay = document.getElementById("inmodal-rate-display");
    const inTaxToggle = document.getElementById("inmodal-tax-toggle");
    const inPayAmount = document.getElementById("inmodal-payment-amount");
    const inPayPeriod = document.getElementById("inmodal-payment-period");
    const inPayCondition = document.getElementById("inmodal-payment-condition");

    const inResDown = document.getElementById("inmodal-res-down");
    const inResPrincipal = document.getElementById("inmodal-res-principal");
    const inResTax = document.getElementById("inmodal-res-tax");
    const inResInterest = document.getElementById("inmodal-res-interest");
    const inResTotal = document.getElementById("inmodal-res-total");

    const inBarPrincipal = document.getElementById("inmodal-bar-principal");
    const inBarInterest = document.getElementById("inmodal-bar-interest");
    const inBarTax = document.getElementById("inmodal-bar-tax");

    const btnMonthly = document.getElementById("inmodal-freq-monthly");
    const btnBiweekly = document.getElementById("inmodal-freq-biweekly");
    let inFreq = "monthly";

    function runInModalCalculation() {
      if (!inDown || !inTerm || !inRateSlider || !inPayAmount) return;

      const downVal = Math.max(0, parseFloat(inDown.value) || 0);
      const tradeVal = Math.max(0, parseFloat(inTrade ? inTrade.value : "0") || 0);
      const months = parseInt(inTerm.value, 10) || 60;
      const annualRate = parseFloat(inRateSlider.value) || 8.5;
      const includeTax = inTaxToggle ? inTaxToggle.checked : true;

      if (inRateDisplay) inRateDisplay.textContent = `${annualRate.toFixed(1)}%`;
      if (inDownPctLabel) {
        const pct = inPrice > 0 ? Math.round((downVal / inPrice) * 100) : 0;
        inDownPctLabel.textContent = `${pct}% of price`;
      }

      const taxableBase = Math.max(0, inPrice - tradeVal);
      const salesTax = includeTax ? (taxableBase * 0.085) + 25000 : 0;
      const principal = Math.max(0, inPrice - tradeVal - downVal + salesTax);

      const monthlyRate = (annualRate / 100) / 12;
      let monthlyPayment = 0;
      if (principal > 0) {
        if (monthlyRate === 0) {
          monthlyPayment = principal / months;
        } else {
          const growth = Math.pow(1 + monthlyRate, months);
          monthlyPayment = (principal * monthlyRate * growth) / (growth - 1);
        }
      }

      const installment = inFreq === "biweekly" ? (monthlyPayment * 12) / 26 : monthlyPayment;
      const totalPayments = monthlyPayment * months;
      const totalInterest = Math.max(0, totalPayments - principal);
      const totalCost = downVal + tradeVal + totalPayments;

      inPayAmount.textContent = formatINR(installment);
      if (inPayPeriod) {
        inPayPeriod.textContent = inFreq === "biweekly" ? "Estimated Bi-Weekly EMI" : "Estimated Monthly EMI";
      }
      if (inPayCondition) {
        inPayCondition.textContent = `${months} mos @ ${annualRate.toFixed(1)}% APR • ${formatINR(downVal)} down`;
      }

      if (inResDown) inResDown.textContent = `-${formatINR(downVal + tradeVal)}`;
      if (inResPrincipal) inResPrincipal.textContent = formatINR(principal);
      if (inResTax) inResTax.textContent = includeTax ? formatINR(salesTax) : "₹0 (Excluded)";
      if (inResInterest) inResInterest.textContent = formatINR(totalInterest);
      if (inResTotal) inResTotal.textContent = formatINR(totalCost);

      const compTotal = principal + totalInterest + salesTax;
      if (compTotal > 0 && inBarPrincipal && inBarInterest && inBarTax) {
        inBarPrincipal.style.width = `${((principal / compTotal) * 100).toFixed(1)}%`;
        inBarInterest.style.width = `${((totalInterest / compTotal) * 100).toFixed(1)}%`;
        inBarTax.style.width = `${((salesTax / compTotal) * 100).toFixed(1)}%`;
      }
    }

    // Down payment sync
    if (inDown && inDownSlider) {
      inDownSlider.addEventListener("input", (e) => {
        inDown.value = e.target.value;
        runInModalCalculation();
      });
      inDown.addEventListener("input", (e) => {
        inDownSlider.value = e.target.value;
        runInModalCalculation();
      });
    }

    // Down payment quick chips
    paneCalc.querySelectorAll(".quick-chips-row .quick-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        paneCalc.querySelectorAll(".quick-chips-row .quick-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        const pct = parseInt(chip.dataset.pct, 10);
        const calcVal = Math.round(inPrice * (pct / 100));
        if (inDown) inDown.value = calcVal;
        if (inDownSlider) inDownSlider.value = calcVal;
        runInModalCalculation();
      });
    });

    // Trade-in
    if (inTrade) {
      inTrade.addEventListener("input", runInModalCalculation);
    }

    // Term
    if (inTerm) {
      inTerm.addEventListener("change", runInModalCalculation);
    }

    // Rate slider and presets
    if (inRateSlider) {
      inRateSlider.addEventListener("input", () => {
        paneCalc.querySelectorAll(".rate-presets-row .quick-chip").forEach(c => c.classList.remove("active"));
        runInModalCalculation();
      });
    }

    paneCalc.querySelectorAll(".rate-presets-row .quick-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        paneCalc.querySelectorAll(".rate-presets-row .quick-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        const apr = parseFloat(chip.dataset.apr);
        if (inRateSlider) inRateSlider.value = apr;
        runInModalCalculation();
      });
    });

    // Tax toggle
    if (inTaxToggle) {
      inTaxToggle.addEventListener("change", runInModalCalculation);
    }

    // Frequency buttons
    if (btnMonthly && btnBiweekly) {
      btnMonthly.addEventListener("click", () => {
        btnMonthly.classList.add("active");
        btnBiweekly.classList.remove("active");
        inFreq = "monthly";
        runInModalCalculation();
      });
      btnBiweekly.addEventListener("click", () => {
        btnBiweekly.classList.add("active");
        btnMonthly.classList.remove("active");
        inFreq = "biweekly";
        runInModalCalculation();
      });
    }

    // Apply for Pre-Approval CTA
    const applyPreapprovalBtn = document.getElementById("inmodal-apply-btn");
    if (applyPreapprovalBtn) {
      applyPreapprovalBtn.addEventListener("click", () => {
        const downVal = inDown ? parseFloat(inDown.value) || 0 : 0;
        const termVal = inTerm ? inTerm.value : "60";
        const rateVal = inRateSlider ? inRateSlider.value : "8.5";
        const installmentStr = inPayAmount ? inPayAmount.textContent : "";

        closeDetailsModal();

        // Prefill contact form
        if (vehicleSelect) {
          vehicleSelect.value = car.name;
        }

        const serviceInput = document.getElementById("contact-service");
        if (serviceInput) serviceInput.value = "Price & Financing Quote";

        const msgInput = document.getElementById("contact-message");
        if (msgInput) {
          msgInput.value = `Hello Ekta Motors Financial Team,\n\nI would like to apply for loan pre-approval for the following vehicle:\n- Vehicle: ${car.year} ${car.name} (${car.trim})\n- MSRP: ${car.priceFormatted}\n- Down Payment: ${formatINR(downVal)}\n- Term: ${termVal} Months\n- APR Target: ${rateVal}%\n- Estimated EMI: ${installmentStr} (${inFreq})\n\nPlease contact me regarding approved lender rates and financing terms.`;
        }

        const contactSec = document.getElementById("contact");
        if (contactSec) contactSec.scrollIntoView({ behavior: "smooth" });

        const nameInput = document.getElementById("contact-name");
        if (nameInput) setTimeout(() => nameInput.focus(), 600);

        showToast(`Financing quote for ${car.name} loaded into application`, "info");
      });
    }

    // Run calculation initially
    runInModalCalculation();

    detailsModal.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeDetailsModal() {
    detailsModal.classList.remove("active");
    document.body.style.overflow = "";
  }

  function setBookingTab(tabType) {
    const tabBtnTestDrive = document.getElementById("tab-btn-test-drive");
    const tabBtnCarBooking = document.getElementById("tab-btn-car-booking");
    const paneTestDrive = document.getElementById("pane-test-drive-form");
    const paneCarBooking = document.getElementById("pane-car-booking-form");

    if (tabType === "car-booking") {
      if (tabBtnTestDrive) {
        tabBtnTestDrive.classList.remove("active", "btn-primary");
        tabBtnTestDrive.classList.add("btn-secondary");
      }
      if (tabBtnCarBooking) {
        tabBtnCarBooking.classList.add("active", "btn-primary");
        tabBtnCarBooking.classList.remove("btn-secondary");
      }
      if (paneTestDrive) paneTestDrive.style.display = "none";
      if (paneCarBooking) paneCarBooking.style.display = "block";
    } else {
      if (tabBtnTestDrive) {
        tabBtnTestDrive.classList.add("active", "btn-primary");
        tabBtnTestDrive.classList.remove("btn-secondary");
      }
      if (tabBtnCarBooking) {
        tabBtnCarBooking.classList.remove("active", "btn-primary");
        tabBtnCarBooking.classList.add("btn-secondary");
      }
      if (paneTestDrive) paneTestDrive.style.display = "block";
      if (paneCarBooking) paneCarBooking.style.display = "none";
    }
  }

  function bookTestDriveForCar(car) {
    setBookingTab("test-drive");
    if (vehicleSelect && car) {
      vehicleSelect.value = car.name;
    }
    const contactSection = document.getElementById("contact");
    if (contactSection) {
      contactSection.scrollIntoView({ behavior: "smooth" });
    }
    const nameInput = document.getElementById("contact-name");
    if (nameInput) setTimeout(() => nameInput.focus(), 500);
    showToast(`Selected "${car.name}" for your test drive booking`, "info");
  }

  function bookCarOnline(car) {
    setBookingTab("car-booking");
    const carBookSelect = document.getElementById("car-book-vehicle");
    if (carBookSelect && car) {
      carBookSelect.value = car.name;
    }
    const contactSection = document.getElementById("contact");
    if (contactSection) {
      contactSection.scrollIntoView({ behavior: "smooth" });
    }
    const nameInput = document.getElementById("car-book-name");
    if (nameInput) setTimeout(() => nameInput.focus(), 500);
    showToast(`Selected "${car.name}" for online car booking reservation`, "info");
  }

  // =========================================================================
  // 6. CUSTOMER REVIEWS (REAL DEALERSHIP REDESIGN & SUPABASE INTEGRATION)
  // =========================================================================
  function getInitials(name) {
    if (!name || typeof name !== "string") return "EM";
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "EM";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function renderStarRating(rating) {
    const num = Math.min(5, Math.max(0, Math.round(Number(rating) || 5)));
    let stars = "";
    for (let i = 1; i <= 5; i++) {
      if (i <= num) {
        stars += '<span style="color: #f59e0b; margin-right: 1px;">★</span>';
      } else {
        stars += '<span style="color: #334155; margin-right: 1px;">★</span>';
      }
    }
    return stars;
  }

  function getReviewsPerPage() {
    if (window.innerWidth <= 640) return 1;
    if (window.innerWidth < 1024) return 2;
    return 3;
  }

  function updateReviewsStatsBar(stats) {
    const compactSummary = document.getElementById("reviews-compact-summary");
    const compactRating = document.getElementById("reviews-compact-rating");
    const compactStars = document.getElementById("reviews-compact-stars");
    const compactCount = document.getElementById("reviews-compact-count");

    const total = stats && typeof stats.totalReviews === "number" ? stats.totalReviews : 0;
    const avg = stats && stats.averageRating !== null && stats.averageRating !== undefined && stats.averageRating > 0 ? stats.averageRating : null;

    if (!compactSummary) return;

    if (total === 0 || avg === null) {
      compactSummary.style.display = "none";
      return;
    }

    compactSummary.style.display = "flex";
    if (compactRating) {
      compactRating.textContent = Number(avg).toFixed(1);
    }
    if (compactStars) {
      compactStars.innerHTML = renderStarRating(avg);
    }
    if (compactCount) {
      compactCount.textContent = String(total);
    }
  }

  // =========================================================================
  // ADMIN REVIEW MANAGEMENT: FETCH PENDING REVIEWS & STATUS TOGGLE
  // =========================================================================

  /**
   * Fetch all reviews (including pending) from Supabase / Backend for Admin review management.
   */
  async function fetchPendingReviews(forceRefresh = false) {
    const token = getEktaAdminToken();
    let fetchedReviews = [];

    // 1. Attempt admin endpoint with auth token
    try {
      const res = await fetch("/api/admin/reviews", {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.reviews)) {
          fetchedReviews = data.reviews;
        }
      }
    } catch (err) {
      console.warn("[Reviews Admin] Admin API fetch failed:", err.message);
    }

    // 2. Secondary endpoint fallback with ?status=pending or status=all
    if (fetchedReviews.length === 0) {
      try {
        const res = await fetch("/api/reviews?status=pending", {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.reviews)) {
            // Combine with public customer reviews
            const existingIds = new Set(data.reviews.map(r => String(r.id)));
            const combined = [...data.reviews];
            (customerReviews || []).forEach(r => {
              if (!existingIds.has(String(r.id))) {
                combined.push(r);
              }
            });
            fetchedReviews = combined;
          }
        }
      } catch (_) {}
    }

    // 3. Direct Supabase client query fallback if available
    if (fetchedReviews.length === 0 && window.supabaseClient) {
      try {
        const { data, error } = await window.supabaseClient
          .from("reviews")
          .select("*")
          .order("created_at", { ascending: false });
        if (!error && Array.isArray(data)) {
          fetchedReviews = data.map(r => ({
            id: r.id,
            authorName: r.customer_name || r.author_name || "Customer",
            authorCar: r.vehicle_name || r.author_car || "",
            purchaseYear: r.purchase_year || "",
            rating: Number(r.rating) || 5,
            quote: r.review || r.quote || "",
            status: String(r.status || "pending").toLowerCase(),
            isVerified: Boolean(r.verified ?? r.is_verified ?? false),
            createdAt: r.created_at
          }));
        }
      } catch (sbErr) {
        console.warn("[Reviews Admin] Direct Supabase fetch error:", sbErr.message);
      }
    }

    // If still empty but we have customerReviews, seed from customerReviews
    if (fetchedReviews.length === 0 && customerReviews.length > 0) {
      fetchedReviews = customerReviews.map(r => ({ ...r, status: r.status || "approved" }));
    }

    if (fetchedReviews.length > 0) {
      allAdminReviews = fetchedReviews.map(r => {
        const rawStatus = String(r.status || "pending").toLowerCase();
        return {
          ...r,
          status: rawStatus === "approved" || rawStatus === "published" ? "approved" : "pending"
        };
      });
      adminPendingReviews = allAdminReviews.filter(r => r.status === "pending");
    }

    // Update notification badges
    const pendingCount = adminPendingReviews.length;
    const pendingTabBadge = document.getElementById("owner-tab-pending-count");
    if (pendingTabBadge) {
      pendingTabBadge.textContent = `${pendingCount} Pending`;
      if (pendingCount > 0) {
        pendingTabBadge.classList.add("amber");
      } else {
        pendingTabBadge.classList.remove("amber");
      }
    }

    updateAdminReviewsBarUI();
    return adminPendingReviews;
  }

  /**
   * Admin-only toggle: switches review status between 'pending' and 'approved' in Supabase,
   * dynamically updating the public testimonials view immediately.
   * @param {string|number} reviewId
   * @param {'pending'|'approved'} [targetStatus]
   */
  async function toggleReviewStatus(reviewId, targetStatus) {
    if (!reviewId) return { success: false, error: "Review ID required" };

    // Locate review in memory
    const existing = allAdminReviews.find(r => String(r.id) === String(reviewId)) ||
                     customerReviews.find(r => String(r.id) === String(reviewId));
    
    const curStatus = existing ? String(existing.status || "pending").toLowerCase() : "pending";
    const nextStatus = targetStatus 
      ? String(targetStatus).toLowerCase()
      : (curStatus === "approved" || curStatus === "published" ? "pending" : "approved");

    const token = getEktaAdminToken();
    let dbUpdated = false;

    // 1. Update in database via PATCH /api/admin/reviews/:id
    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ status: nextStatus })
      });
      if (res.ok) {
        dbUpdated = true;
      }
    } catch (err) {
      console.warn("[Reviews Admin] PATCH /api/admin/reviews failed:", err.message);
    }

    // 2. Direct Supabase update fallback if available
    if (!dbUpdated && window.supabaseClient) {
      try {
        const { error } = await window.supabaseClient
          .from("reviews")
          .update({ status: nextStatus })
          .eq("id", reviewId);
        if (!error) dbUpdated = true;
      } catch (sbErr) {
        console.warn("[Reviews Admin] Supabase direct update failed:", sbErr.message);
      }
    }

    // 3. Update memory state for allAdminReviews
    const allIdx = allAdminReviews.findIndex(r => String(r.id) === String(reviewId));
    if (allIdx >= 0) {
      allAdminReviews[allIdx].status = nextStatus;
    } else if (existing) {
      allAdminReviews.push({ ...existing, status: nextStatus });
    }
    adminPendingReviews = allAdminReviews.filter(r => r.status === "pending");

    // 4. Update memory state for customerReviews (public testimonials view)
    const isNowApproved = nextStatus === "approved";
    const custIdx = customerReviews.findIndex(r => String(r.id) === String(reviewId));

    if (isNowApproved) {
      if (custIdx >= 0) {
        customerReviews[custIdx].status = "approved";
      } else if (existing) {
        customerReviews.unshift({ ...existing, status: "approved" });
      }
    } else {
      // If changed to pending, remove from public display
      if (custIdx >= 0) {
        customerReviews.splice(custIdx, 1);
      }
    }

    // 5. Recalculate public testimonials stats dynamically
    const approvedList = customerReviews.filter(r => {
      const s = String(r.status || "approved").toLowerCase();
      return s === "approved" || s === "published";
    });

    const totalReviews = approvedList.length;
    const verifiedCount = approvedList.filter(r => r.isVerified || r.is_verified || r.verified).length;
    const averageRating = totalReviews > 0
      ? approvedList.reduce((sum, r) => sum + (Number(r.rating) || 5), 0) / totalReviews
      : null;

    updateReviewsStatsBar({ totalReviews, verifiedCount, averageRating });

    // 6. Refresh UI components dynamically
    renderReviewsPage();
    updateAdminReviewsBarUI();

    const pendingTabBadge = document.getElementById("owner-tab-pending-count");
    if (pendingTabBadge) {
      pendingTabBadge.textContent = `${adminPendingReviews.length} Pending`;
    }

    if (typeof renderOwnerReviewsTable === "function") {
      renderOwnerReviewsTable();
    }

    const toastMsg = isNowApproved
      ? "Review approved! Published live to public showroom testimonials."
      : "Review status updated to pending moderation.";
    showToast(toastMsg, "success");

    // Dispatch dynamic update event for any listeners
    window.dispatchEvent(new CustomEvent("ekta:testimonials-updated", {
      detail: { reviewId, status: nextStatus, totalReviews }
    }));

    return { success: true, status: nextStatus, totalReviews };
  }

  /**
   * Delete a review permanently from Supabase & memory
   */
  async function deleteReviewFromAdmin(reviewId) {
    if (!confirm("Are you sure you want to permanently delete this customer review?")) return;
    const token = getEktaAdminToken();
    try {
      await fetch(`/api/admin/reviews/${reviewId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
    } catch (_) {}

    if (window.supabaseClient) {
      try {
        await window.supabaseClient.from("reviews").delete().eq("id", reviewId);
      } catch (_) {}
    }

    allAdminReviews = allAdminReviews.filter(r => String(r.id) !== String(reviewId));
    customerReviews = customerReviews.filter(r => String(r.id) !== String(reviewId));
    adminPendingReviews = allAdminReviews.filter(r => r.status === "pending");

    const approvedList = customerReviews.filter(r => {
      const s = String(r.status || "approved").toLowerCase();
      return s === "approved" || s === "published";
    });
    updateReviewsStatsBar({
      totalReviews: approvedList.length,
      verifiedCount: approvedList.filter(r => r.isVerified || r.is_verified || r.verified).length,
      averageRating: approvedList.length > 0 ? approvedList.reduce((sum, r) => sum + (Number(r.rating) || 5), 0) / approvedList.length : null
    });

    renderReviewsPage();
    updateAdminReviewsBarUI();
    if (typeof renderOwnerReviewsTable === "function") renderOwnerReviewsTable();
    showToast("Customer review deleted.", "info");
  }

  /**
   * Update or inject the Admin Reviews Moderation Toolbar
   */
  function updateAdminReviewsBarUI() {
    const container = document.getElementById("admin-reviews-bar-container");
    if (!container) return;

    const adminActive = isAdminReviewsActive || isEktaAdminAuthenticated();
    if (!adminActive) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    const totalCount = allAdminReviews.length || customerReviews.length;
    const pendingCount = adminPendingReviews.length;
    const approvedCount = allAdminReviews.filter(r => r.status === "approved").length || customerReviews.length;

    container.innerHTML = `
      <div class="admin-reviews-bar" id="admin-reviews-bar">
        <div class="admin-bar-left">
          <span class="admin-badge-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            Admin Moderation
          </span>
          <span class="admin-bar-title">Supabase Reviews</span>
          <span class="admin-pending-pill ${pendingCount === 0 ? 'zero' : ''}" id="admin-pending-counter">
            ${pendingCount > 0 ? `⚡ ${pendingCount} Pending` : '✓ All Approved'}
          </span>
        </div>

        <div class="admin-bar-filters">
          <button type="button" class="admin-filter-btn ${adminReviewsFilter === 'all' ? 'active' : ''}" data-filter="all">
            All (${totalCount})
          </button>
          <button type="button" class="admin-filter-btn ${adminReviewsFilter === 'pending' ? 'active' : ''}" data-filter="pending">
            Pending (${pendingCount})
          </button>
          <button type="button" class="admin-filter-btn ${adminReviewsFilter === 'approved' ? 'active' : ''}" data-filter="approved">
            Approved (${approvedCount})
          </button>
        </div>

        <div class="admin-bar-right">
          <button type="button" class="btn-admin-refresh-rev" id="btn-admin-sync-supabase" title="Refresh Live from Supabase">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            <span>Sync</span>
          </button>
          <button type="button" class="btn-admin-refresh-rev" id="btn-open-owner-queries-from-bar" title="Open Owner Dashboard">
            <span>Owner Modal</span>
          </button>
        </div>
      </div>
    `;

    // Bind Filter buttons
    container.querySelectorAll(".admin-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        adminReviewsFilter = btn.dataset.filter || "all";
        renderReviewsPage();
        updateAdminReviewsBarUI();
      });
    });

    // Bind Sync button
    const syncBtn = container.querySelector("#btn-admin-sync-supabase");
    if (syncBtn) {
      syncBtn.addEventListener("click", async () => {
        syncBtn.disabled = true;
        await fetchPendingReviews(true);
        await fetchAndRenderCustomerReviews();
        syncBtn.disabled = false;
        showToast("Reviews synchronized with Supabase database.", "info");
      });
    }

    // Bind Owner modal button
    const modalBtn = container.querySelector("#btn-open-owner-queries-from-bar");
    if (modalBtn) {
      modalBtn.addEventListener("click", () => {
        const ownerModal = document.getElementById("owner-booking-queries-modal");
        if (ownerModal) {
          ownerModal.classList.add("active");
          document.body.classList.add("modal-open");
          const tabReviews = document.getElementById("tab-btn-owner-reviews");
          if (tabReviews) tabReviews.click();
        }
      });
    }
  }

  function renderReviewsPage() {
    const loadingState = document.getElementById("reviews-loading-state");
    const emptyState = document.getElementById("reviews-empty-state");
    const carouselContainer = document.getElementById("reviews-carousel-container");
    const reviewsGrid = document.getElementById("reviews-grid");
    const pagination = document.getElementById("reviews-pagination");
    const indicators = document.getElementById("reviews-page-indicators");

    if (loadingState) loadingState.style.display = "none";

    // Strictly read approved reviews from database for public showroom
    const activeReviews = (customerReviews || []).filter(r => {
      const s = String(r.status || "approved").toLowerCase();
      return s === "approved" || s === "published";
    });

    // Zero Reviews Empty State: Strictly show clean message without generating fake data
    if (!activeReviews || activeReviews.length === 0) {
      if (carouselContainer) carouselContainer.style.display = "none";
      if (pagination) pagination.style.display = "none";
      if (emptyState) {
        emptyState.style.display = "block";
      }
      return;
    }

    if (emptyState) emptyState.style.display = "none";
    if (carouselContainer) {
      carouselContainer.style.display = "block";
      carouselContainer.classList.toggle("has-two-reviews", activeReviews.length === 2);
      carouselContainer.classList.toggle("has-one-review", activeReviews.length === 1);
    }

    const pageSize = getReviewsPerPage();
    const totalPages = Math.ceil(activeReviews.length / pageSize);

    if (reviewsCurrentPage >= totalPages) reviewsCurrentPage = Math.max(0, totalPages - 1);
    if (reviewsCurrentPage < 0) reviewsCurrentPage = 0;

    if (reviewsGrid) {
      reviewsGrid.innerHTML = activeReviews.map((review, idx) => {
        const rating = Math.min(5, Math.max(1, Math.round(Number(review.rating) || 5)));
        const starsHtml = renderStarRating(rating);
        const authorName = review.authorName || review.customerName || review.author_name || review.customer_name || "Customer";
        const rawQuote = review.quote || review.review || review.reviewText || "";
        const carName = review.authorCar || review.vehicleName || review.vehicle_name || review.author_car || "";

        // City & Purchase / Date formatting
        const city = review.city || "Jalna";
        let dateStr = "";
        const rawDate = review.createdAt || review.created_at;
        if (rawDate) {
          const d = new Date(rawDate);
          if (!isNaN(d.getTime())) {
            dateStr = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
          }
        }
        if (!dateStr && review.purchaseYear) {
          dateStr = String(review.purchaseYear);
        }
        const cityAndDate = dateStr ? `${city} • ${dateStr}` : city;

        // Customer Avatar: Photo or Circular Initials
        let avatarHtml = "";
        if (review.avatar && typeof review.avatar === "string" && review.avatar.startsWith("http")) {
          avatarHtml = `<img src="${escapeHtml(review.avatar)}" alt="${escapeHtml(authorName)}" class="review-avatar-img" loading="lazy" />`;
        } else {
          const initials = getInitials(authorName);
          avatarHtml = `<div class="review-avatar-circle" aria-hidden="true">${escapeHtml(initials)}</div>`;
        }

        // Purchased car detail
        const purchasedHtml = carName 
          ? `<div class="review-purchased-car">Purchased: <span class="car-name">${escapeHtml(carName)}</span></div>` 
          : '';

        return `
          <div class="review-slide-item" data-slide-index="${idx}">
            <article class="review-card" id="review-card-${escapeHtml(String(review.id || idx))}">
              <div class="review-card-stars" aria-label="${rating} out of 5 stars">
                ${starsHtml}
              </div>

              <div class="review-card-body">
                <p class="review-quote">“${escapeHtml(rawQuote)}”</p>
              </div>

              <div class="review-card-divider" aria-hidden="true"></div>

              <div class="review-card-footer">
                <div class="review-avatar-wrap">
                  ${avatarHtml}
                </div>
                <div class="review-author-meta">
                  <h4 class="review-author-name">${escapeHtml(authorName)}</h4>
                  ${purchasedHtml}
                  <div class="review-city-date">${escapeHtml(cityAndDate)}</div>
                </div>
              </div>
            </article>
          </div>
        `;
      }).join("");

      // Apply dynamic carousel sliding or centered layout
      if (window.innerWidth <= 640) {
        // Mobile: 1 card per slide, smooth horizontal offset
        reviewsGrid.style.justifyContent = "flex-start";
        reviewsGrid.style.transform = `translateX(-${reviewsCurrentPage * 100}%)`;
      } else if (window.innerWidth < 1024) {
        // Tablet: 2 cards per view
        if (activeReviews.length <= 2) {
          reviewsGrid.style.justifyContent = "center";
          reviewsGrid.style.transform = "none";
        } else {
          reviewsGrid.style.justifyContent = "flex-start";
          reviewsGrid.style.transform = `translateX(-${reviewsCurrentPage * 100}%)`;
        }
      } else {
        // Desktop: 3 cards per view
        if (activeReviews.length <= 2) {
          // Center 1 or 2 reviews elegantly
          reviewsGrid.style.justifyContent = "center";
          reviewsGrid.style.transform = "none";
        } else {
          reviewsGrid.style.justifyContent = "flex-start";
          reviewsGrid.style.transform = `translateX(-${reviewsCurrentPage * 100}%)`;
        }
      }
    }

    // Update carousel arrows & pagination dots
    const allPrevBtns = document.querySelectorAll("#reviews-page-prev, #reviews-arrow-prev");
    const allNextBtns = document.querySelectorAll("#reviews-page-next, #reviews-arrow-next");

    if (totalPages <= 1) {
      if (pagination) pagination.style.display = "none";
      allPrevBtns.forEach(btn => btn.style.display = "none");
      allNextBtns.forEach(btn => btn.style.display = "none");
    } else {
      if (pagination) pagination.style.display = "flex";

      // On desktop/tablet, flank arrows are visible; on mobile, flank arrows are hidden via CSS
      if (window.innerWidth > 640) {
        allPrevBtns.forEach(btn => btn.style.display = "flex");
        allNextBtns.forEach(btn => btn.style.display = "flex");
      }

      const isFirst = reviewsCurrentPage === 0;
      const isLast = reviewsCurrentPage >= totalPages - 1;

      allPrevBtns.forEach(btn => {
        btn.disabled = isFirst;
        btn.setAttribute("aria-disabled", isFirst ? "true" : "false");
      });
      allNextBtns.forEach(btn => {
        btn.disabled = isLast;
        btn.setAttribute("aria-disabled", isLast ? "true" : "false");
      });

      if (indicators) {
        indicators.innerHTML = Array.from({ length: totalPages }, (_, idx) =>
          `<button type="button" class="reviews-dot ${idx === reviewsCurrentPage ? 'active' : ''}" data-page="${idx}" aria-label="Go to reviews slide ${idx + 1}" role="tab" aria-selected="${idx === reviewsCurrentPage ? 'true' : 'false'}"></button>`
        ).join("");

        indicators.querySelectorAll(".reviews-dot").forEach((dot) => {
          dot.addEventListener("click", () => {
            const targetPage = Number(dot.dataset.page) || 0;
            if (targetPage !== reviewsCurrentPage) {
              reviewsCurrentPage = targetPage;
              renderReviewsPage();
            }
          });
        });
      }
    }
  }

  async function fetchAndRenderCustomerReviews() {
    const loadingState = document.getElementById("reviews-loading-state");
    if (loadingState && customerReviews.length === 0) {
      loadingState.style.display = "flex";
    }

    try {
      const res = await fetch("/api/reviews");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data && Array.isArray(data.reviews)) {
        customerReviews = data.reviews.map(r => ({
          ...r,
          status: r.status || "approved"
        }));
        updateReviewsStatsBar(data.stats || {
          totalReviews: customerReviews.length,
          verifiedCount: customerReviews.filter(r => r.isVerified || r.is_verified).length,
          averageRating: customerReviews.length > 0 ? (customerReviews.reduce((a, b) => a + (Number(b.rating) || 5), 0) / customerReviews.length) : null
        });
      } else {
        customerReviews = [];
        updateReviewsStatsBar({ totalReviews: 0, verifiedCount: 0, averageRating: null });
      }
    } catch (err) {
      console.warn("[Reviews] Failed to fetch customer reviews:", err.message);
      customerReviews = [];
      updateReviewsStatsBar({ totalReviews: 0, verifiedCount: 0, averageRating: null });
    } finally {
      renderReviewsPage();
    }

    // If admin is active, also sync pending reviews in the background
    if (isAdminReviewsActive || isEktaAdminAuthenticated()) {
      fetchPendingReviews();
    }
  }

  function initTestimonials() {
    function goToPrevReviews() {
      if (reviewsCurrentPage > 0) {
        reviewsCurrentPage--;
        renderReviewsPage();
      }
    }

    function goToNextReviews() {
      const pageSize = getReviewsPerPage();
      const activeReviews = (customerReviews || []).filter(r => {
        const s = String(r.status || "approved").toLowerCase();
        return s === "approved" || s === "published";
      });
      const totalPages = Math.ceil(activeReviews.length / pageSize);
      if (reviewsCurrentPage < totalPages - 1) {
        reviewsCurrentPage++;
        renderReviewsPage();
      }
    }

    // Wire up both flank arrows and bottom carousel buttons
    document.querySelectorAll("#reviews-page-prev, #reviews-arrow-prev").forEach(btn => {
      btn.addEventListener("click", goToPrevReviews);
    });
    document.querySelectorAll("#reviews-page-next, #reviews-arrow-next").forEach(btn => {
      btn.addEventListener("click", goToNextReviews);
    });

    // Touch Swipe Interaction for Mobile
    const viewport = document.getElementById("reviews-carousel-viewport");
    if (viewport) {
      let touchStartX = 0;
      let touchStartY = 0;
      let touchDeltaX = 0;
      let touchDeltaY = 0;

      viewport.addEventListener("touchstart", (e) => {
        if (!e.touches || e.touches.length === 0) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchDeltaX = 0;
        touchDeltaY = 0;
      }, { passive: true });

      viewport.addEventListener("touchmove", (e) => {
        if (!e.touches || e.touches.length === 0) return;
        touchDeltaX = e.touches[0].clientX - touchStartX;
        touchDeltaY = e.touches[0].clientY - touchStartY;
      }, { passive: true });

      viewport.addEventListener("touchend", () => {
        if (Math.abs(touchDeltaX) > 40 && Math.abs(touchDeltaX) > Math.abs(touchDeltaY)) {
          if (touchDeltaX < 0) {
            goToNextReviews();
          } else {
            goToPrevReviews();
          }
        }
        touchDeltaX = 0;
        touchDeltaY = 0;
      });
    }

    // Wire up empty state Write a Review CTA button
    const emptyWriteBtn = document.getElementById("btn-empty-write-review");
    if (emptyWriteBtn) {
      emptyWriteBtn.addEventListener("click", () => {
        const openModalBtn = document.getElementById("btn-open-review-modal");
        if (openModalBtn) openModalBtn.click();
      });
    }

    // Admin Moderation Mode Toggle Button in testimonials CTA
    const adminToggleBtn = document.getElementById("btn-toggle-admin-reviews");
    if (adminToggleBtn) {
      if (isEktaAdminAuthenticated()) {
        adminToggleBtn.style.display = "inline-flex";
      }

      adminToggleBtn.addEventListener("click", async () => {
        isAdminReviewsActive = !isAdminReviewsActive;
        if (isAdminReviewsActive) {
          adminToggleBtn.classList.add("btn-primary");
          adminToggleBtn.classList.remove("btn-outline");
          await fetchPendingReviews(true);
          showToast("Admin Review Moderation Mode enabled.", "info");
        } else {
          adminToggleBtn.classList.remove("btn-primary");
          adminToggleBtn.classList.add("btn-outline");
          showToast("Standard Showroom Testimonials View enabled.", "info");
        }
        updateAdminReviewsBarUI();
        renderReviewsPage();
      });
    }

    // Responsive resize listener with debounce
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (customerReviews.length > 0 || allAdminReviews.length > 0) {
          renderReviewsPage();
        }
      }, 150);
    });

    // Expose global Review Moderation APIs on window
    window.EktaAdminReviews = {
      fetchPendingReviews,
      fetchAllReviews: () => allAdminReviews,
      getPendingReviews: () => adminPendingReviews,
      toggleReviewStatus,
      updateReviewStatus: toggleReviewStatus,
      deleteReview: deleteReviewFromAdmin,
      refreshTestimonials: fetchAndRenderCustomerReviews,
      renderReviewsPage,
      setAdminFilter: (filter) => {
        adminReviewsFilter = filter;
        renderReviewsPage();
        updateAdminReviewsBarUI();
      }
    };
    window.AdminReviews = window.EktaAdminReviews;
    window.toggleReviewStatus = toggleReviewStatus;
    window.fetchPendingReviews = fetchPendingReviews;

    // Listen for storage events (e.g. status updates from Admin Dashboard in another tab)
    window.addEventListener("storage", (e) => {
      if (e.key === "ekta_testimonials_sync") {
        fetchAndRenderCustomerReviews();
        if (isAdminReviewsActive || isEktaAdminAuthenticated()) {
          fetchPendingReviews(true);
        }
      }
    });

    // Initial fetch
    fetchAndRenderCustomerReviews();
  }

  // =========================================================================
  // 7. LOAN FINANCE CALCULATOR
  // =========================================================================
  let calcPaymentFrequency = "monthly";
  let activeDownPercent = 10;

  function calculatePayment() {
    if (!calcPriceInput || !calcDownInput || !calcTermSelect || !calcRateInput || !calcResultAmount) return;

    const price = Math.max(0, parseFloat(calcPriceInput.value) || 0);
    const tradeIn = Math.max(0, parseFloat(calcTradeInput ? calcTradeInput.value : "0") || 0);
    const downPayment = Math.max(0, parseFloat(calcDownInput.value) || 0);
    const months = parseInt(calcTermSelect.value, 10) || 60;
    const annualRate = Math.max(0, parseFloat(calcRateInput.value) || 0);
    const includeTax = calcTaxToggle ? calcTaxToggle.checked : true;

    // RTO & Registration Calculation (Estimated 8.5% on net purchase after trade-in + ₹25,000 reg)
    const taxableBase = Math.max(0, price - tradeIn);
    const salesTax = includeTax ? (taxableBase * 0.085) + 25000 : 0;

    // Principal Financed
    const principal = Math.max(0, price - tradeIn - downPayment + salesTax);

    // Amortization Formula: P * [ r(1 + r)^n ] / [ (1 + r)^n - 1 ]
    const monthlyRate = (annualRate / 100) / 12;
    let monthlyPayment = 0;

    if (principal > 0) {
      if (monthlyRate === 0) {
        monthlyPayment = principal / months;
      } else {
        const growth = Math.pow(1 + monthlyRate, months);
        monthlyPayment = (principal * monthlyRate * growth) / (growth - 1);
      }
    }

    // Payment Frequency conversion
    const installment = calcPaymentFrequency === "biweekly"
      ? (monthlyPayment * 12) / 26
      : monthlyPayment;

    // Totals
    const totalLoanPayments = monthlyPayment * months;
    const totalInterest = Math.max(0, totalLoanPayments - principal);
    const totalCost = downPayment + tradeIn + totalLoanPayments;

    // Update Main Display
    calcResultAmount.textContent = formatINR(installment);
    if (calcPaymentFreqLabel) {
      calcPaymentFreqLabel.textContent = calcPaymentFrequency === "biweekly"
        ? "Estimated Bi-Weekly Installment"
        : "Estimated Monthly Installment";
    }

    if (calcConditionSummary) {
      calcConditionSummary.textContent = `Based on ${months} months @ ${annualRate.toFixed(1)}% APR with ${formatINR(downPayment)} down${tradeIn > 0 ? ` + ${formatINR(tradeIn)} trade` : ''}`;
    }

    // Update Breakdown Cells
    if (resVehiclePrice) resVehiclePrice.textContent = formatINR(price);
    if (resTotalDown) resTotalDown.textContent = `-${formatINR(downPayment + tradeIn)}`;
    if (resNetPrincipal) resNetPrincipal.textContent = formatINR(principal);
    if (resTaxFees) resTaxFees.textContent = includeTax ? formatINR(salesTax) : "₹0 (Excluded)";
    if (resTotalInterest) resTotalInterest.textContent = formatINR(totalInterest);
    if (resTotalCost) resTotalCost.textContent = formatINR(totalCost);

    if (calcInterestRatio) {
      const ratio = totalLoanPayments > 0 ? ((totalInterest / totalLoanPayments) * 100).toFixed(1) : "0.0";
      calcInterestRatio.textContent = `${ratio}% Interest`;
    }

    // Update Composition Bar
    const compTotal = principal + totalInterest + salesTax;
    if (compTotal > 0) {
      const pPct = ((principal / compTotal) * 100).toFixed(1);
      const iPct = ((totalInterest / compTotal) * 100).toFixed(1);
      const tPct = ((salesTax / compTotal) * 100).toFixed(1);

      if (calcBarPrincipal) calcBarPrincipal.style.width = `${pPct}%`;
      if (calcBarInterest) calcBarInterest.style.width = `${iPct}%`;
      if (calcBarTax) calcBarTax.style.width = `${tPct}%`;
    } else {
      if (calcBarPrincipal) calcBarPrincipal.style.width = "100%";
      if (calcBarInterest) calcBarInterest.style.width = "0%";
      if (calcBarTax) calcBarTax.style.width = "0%";
    }

    // Generate Amortization Table
    generateAmortizationSchedule(principal, monthlyRate, months, monthlyPayment);
  }

  // Generates yearly amortization breakdown matching 6-column table in index.html
  function generateAmortizationSchedule(initialPrincipal, monthlyRate, totalMonths, monthlyPayment) {
    if (!amortizationTbody) return;

    let balance = initialPrincipal;
    const totalYears = Math.ceil(totalMonths / 12);
    let html = "";
    let monthCounter = 0;

    for (let yr = 1; yr <= totalYears; yr++) {
      const startBalance = balance;
      let yearPrincipal = 0;
      let yearInterest = 0;

      const monthsInThisYear = Math.min(12, totalMonths - monthCounter);
      for (let m = 0; m < monthsInThisYear; m++) {
        monthCounter++;
        if (balance <= 0) break;
        const interestPaid = balance * monthlyRate;
        const principalPaid = Math.min(balance, monthlyPayment - interestPaid);
        yearInterest += interestPaid;
        yearPrincipal += principalPaid;
        balance = Math.max(0, balance - principalPaid);
      }

      const totalYearPayment = yearPrincipal + yearInterest;

      html += `
        <tr>
          <td>Year ${yr} (${monthCounter} mos)</td>
          <td>${formatINR(startBalance)}</td>
          <td style="color: #C5A880; font-weight: 600;">+${formatINR(yearPrincipal)}</td>
          <td style="color: #f59e0b; font-weight: 600;">+${formatINR(yearInterest)}</td>
          <td>${formatINR(totalYearPayment)}</td>
          <td style="font-weight: 700; color: var(--color-heading-main, var(--slate-900));">${formatINR(balance)}</td>
        </tr>
      `;

      if (balance <= 0) break;
    }

    amortizationTbody.innerHTML = html;
  }

  // Selects vehicle from cards or modal and loads into calculator
  function selectVehicleInCalculator(carId) {
    const car = VEHICLES.find(v => v.id === carId);
    if (!car) return;
    openVehicleDetails(car.id, "calc");
  }

  // Initializes all interactive controls and listeners for the Loan Calculator
  function initLoanCalculator() {
    // 1. Vehicle Selector Dropdown
    if (calcVehicleSelect) {
      calcVehicleSelect.addEventListener("change", () => {
        const val = calcVehicleSelect.value;
        if (val === "custom") return;
        const car = VEHICLES.find(v => v.id === val);
        if (car) {
          if (calcPriceInput) calcPriceInput.value = car.price;
          if (calcPriceSlider) {
            const currentMax = parseFloat(calcPriceSlider.max || "15000000");
            if (car.price > currentMax) {
              calcPriceSlider.max = Math.ceil(car.price * 1.25);
            }
            calcPriceSlider.value = car.price;
          }

          // Apply active down payment pct if set
          if (activeDownPercent !== null && calcDownInput) {
            const down = Math.round(car.price * (activeDownPercent / 100));
            calcDownInput.value = down;
            if (calcDownSlider) {
              const currentDownMax = parseFloat(calcDownSlider.max || "5000000");
              if (down > currentDownMax) {
                calcDownSlider.max = Math.ceil(down * 1.25);
              }
              calcDownSlider.value = down;
            }
          }
          calculatePayment();
          showToast(`Applied ${car.name} price (${car.priceFormatted})`, "info");
        }
      });
    }

    // 2. Vehicle Price Slider & Input Sync
    if (calcPriceSlider && calcPriceInput) {
      calcPriceSlider.addEventListener("input", (e) => {
        calcPriceInput.value = e.target.value;
        if (calcVehicleSelect) calcVehicleSelect.value = "custom";
        if (activeDownPercent !== null && calcDownInput) {
          const down = Math.round(parseFloat(e.target.value) * (activeDownPercent / 100));
          calcDownInput.value = down;
          if (calcDownSlider) calcDownSlider.value = down;
        }
        calculatePayment();
      });

      calcPriceInput.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value) || 0;
        const currentMax = parseFloat(calcPriceSlider.max || "15000000");
        if (val > currentMax) {
          calcPriceSlider.max = Math.ceil(val * 1.2);
        }
        calcPriceSlider.value = val;
        if (calcVehicleSelect) calcVehicleSelect.value = "custom";
        if (activeDownPercent !== null && calcDownInput) {
          const down = Math.round(val * (activeDownPercent / 100));
          calcDownInput.value = down;
          if (calcDownSlider) calcDownSlider.value = down;
        }
        calculatePayment();
      });
    }

    // 3. Down Payment Slider & Input Sync
    if (calcDownSlider && calcDownInput) {
      calcDownSlider.addEventListener("input", (e) => {
        calcDownInput.value = e.target.value;
        activeDownPercent = null;
        document.querySelectorAll(".quick-chip").forEach(c => c.classList.remove("active"));
        calculatePayment();
      });

      calcDownInput.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value) || 0;
        const currentMax = parseFloat(calcDownSlider.max || "5000000");
        if (val > currentMax) {
          calcDownSlider.max = Math.ceil(val * 1.5);
        }
        calcDownSlider.value = val;
        activeDownPercent = null;
        document.querySelectorAll(".quick-chip").forEach(c => c.classList.remove("active"));
        calculatePayment();
      });
    }

    // 4. Quick Down Payment Percentage Chips
    document.querySelectorAll(".quick-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".quick-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        const pct = parseInt(chip.dataset.pct || chip.dataset.val || "0", 10);
        activeDownPercent = pct;

        const price = parseFloat(calcPriceInput ? calcPriceInput.value : "3850000") || 0;
        const downVal = Math.round(price * (pct / 100));
        if (calcDownInput) calcDownInput.value = downVal;
        if (calcDownSlider) {
          const currentMax = parseFloat(calcDownSlider.max || "5000000");
          if (downVal > currentMax) {
            calcDownSlider.max = Math.ceil(downVal * 1.25);
          }
          calcDownSlider.value = downVal;
        }
        calculatePayment();
      });
    });

    // 5. Trade-In Slider & Input Sync
    if (calcTradeSlider && calcTradeInput) {
      calcTradeSlider.addEventListener("input", (e) => {
        calcTradeInput.value = e.target.value;
        calculatePayment();
      });

      calcTradeInput.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value) || 0;
        const currentMax = parseFloat(calcTradeSlider.max || "3000000");
        if (val > currentMax) {
          calcTradeSlider.max = Math.ceil(val * 1.25);
        }
        calcTradeSlider.value = val;
        calculatePayment();
      });
    }

    // 6. Term Selection & Term Chips
    if (calcTermSelect) {
      calcTermSelect.addEventListener("change", () => {
        const termVal = calcTermSelect.value;
        document.querySelectorAll(".term-chip").forEach(chip => {
          chip.classList.toggle("active", chip.dataset.term === termVal);
        });
        calculatePayment();
      });
    }

    document.querySelectorAll(".term-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const termVal = chip.dataset.term;
        document.querySelectorAll(".term-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        if (calcTermSelect) {
          calcTermSelect.value = termVal;
        }
        calculatePayment();
      });
    });

    // 7. Interest APR Slider & Input Sync + Preset Chips
    if (calcRateSlider && calcRateInput) {
      calcRateSlider.addEventListener("input", (e) => {
        calcRateInput.value = e.target.value;
        document.querySelectorAll(".rate-preset-chip").forEach(c => c.classList.remove("active"));
        calculatePayment();
      });

      calcRateInput.addEventListener("input", (e) => {
        calcRateSlider.value = e.target.value;
        document.querySelectorAll(".rate-preset-chip").forEach(c => c.classList.remove("active"));
        calculatePayment();
      });
    }

    document.querySelectorAll(".rate-preset-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".rate-preset-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        const rateVal = parseFloat(chip.dataset.apr || chip.dataset.rate || "8.5");
        if (calcRateInput) calcRateInput.value = rateVal;
        if (calcRateSlider) calcRateSlider.value = rateVal;
        calculatePayment();
      });
    });

    // 8. Tax Toggle Checkbox
    if (calcTaxToggle) {
      calcTaxToggle.addEventListener("change", calculatePayment);
    }

    // 9. Payment Frequency Buttons
    document.querySelectorAll(".freq-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".freq-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        calcPaymentFrequency = btn.dataset.freq;
        calculatePayment();
      });
    });

    // 10. Amortization Drawer Toggle & Close
    if (btnToggleAmortization && amortizationDrawer) {
      btnToggleAmortization.addEventListener("click", () => {
        const isOpen = amortizationDrawer.classList.toggle("active");
        btnToggleAmortization.innerHTML = isOpen
          ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg> Hide Amortization Schedule`
          : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> View Amortization Schedule`;

        if (isOpen) {
          amortizationDrawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    }

    if (btnCloseAmortization && amortizationDrawer && btnToggleAmortization) {
      btnCloseAmortization.addEventListener("click", () => {
        amortizationDrawer.classList.remove("active");
        btnToggleAmortization.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> View Amortization Schedule`;
      });
    }

    // 11. Apply for Pre-Approval CTA
    if (calcApplyBtn) {
      calcApplyBtn.addEventListener("click", (e) => {
        e.preventDefault();

        // Determine vehicle
        let vehicleName = "";
        if (calcVehicleSelect && calcVehicleSelect.value !== "custom") {
          const car = VEHICLES.find(v => v.id === calcVehicleSelect.value);
          if (car) vehicleName = `${car.year} ${car.name}`;
        }

        const price = parseFloat(calcPriceInput ? calcPriceInput.value : "3850000") || 0;
        const down = parseFloat(calcDownInput ? calcDownInput.value : "500000") || 0;
        const term = calcTermSelect ? calcTermSelect.value : "60";
        const rate = parseFloat(calcRateInput ? calcRateInput.value : "8.5") || 8.5;
        const installment = calcResultAmount ? calcResultAmount.textContent : "₹0";

        // Prefill contact form
        if (vehicleSelect && vehicleName) {
          vehicleSelect.value = vehicleName.replace(/^\d{4}\s/, '');
          if (!vehicleSelect.value) {
            const opts = Array.from(vehicleSelect.options);
            const found = opts.find(o => o.value.includes(vehicleName) || vehicleName.includes(o.value));
            if (found) vehicleSelect.value = found.value;
          }
        }

        const contactService = document.getElementById("contact-service");
        if (contactService) {
          contactService.value = "Price & Financing Quote";
        }

        const contactMessage = document.getElementById("contact-message");
        if (contactMessage) {
          contactMessage.value = `Hello Ekta Motors Financial Team, I am requesting pre-approval with the following parameters:\n- Vehicle: ${vehicleName || 'Custom Vehicle (' + formatINR(price) + ')'}\n- Down Payment: ${formatINR(down)}\n- Estimated Term: ${term} Months\n- APR Target: ${rate}%\n- Estimated Payment: ${installment} (${calcPaymentFrequency})\n\nPlease contact me regarding approved rates and terms.`;
        }

        // Smooth scroll to contact form
        const contactSec = document.getElementById("contact");
        if (contactSec) {
          contactSec.scrollIntoView({ behavior: "smooth" });
        }

        const nameInput = document.getElementById("contact-name");
        if (nameInput) {
          setTimeout(() => nameInput.focus(), 600);
        }

        showToast("Financing estimate applied to pre-approval form!", "info");
      });
    }

    // Initial Calculation
    calculatePayment();
  }

  // =========================================================================
  // 8. TEST DRIVE & CAR BOOKING FORMS WITH SUPABASE BACKEND INTEGRATION
  // =========================================================================
  function initContactForm() {
    // 1. Booking Tabs Switching (Test Drive vs Car Booking)
    const tabBtnTestDrive = document.getElementById("tab-btn-test-drive");
    const tabBtnCarBooking = document.getElementById("tab-btn-car-booking");

    if (tabBtnTestDrive) {
      tabBtnTestDrive.addEventListener("click", () => setBookingTab("test-drive"));
    }
    if (tabBtnCarBooking) {
      tabBtnCarBooking.addEventListener("click", () => setBookingTab("car-booking"));
    }

    // Common Validator Helper
    function validateField(input, testFn, errorMsg) {
      if (!input) return true;
      const errorEl = input.parentElement ? input.parentElement.querySelector(".form-error-msg") : null;
      const isValid = testFn(input.value.trim());

      if (!isValid) {
        input.classList.add("is-invalid");
        input.classList.remove("is-valid");
        if (errorEl) errorEl.textContent = errorMsg;
      } else {
        input.classList.remove("is-invalid");
        input.classList.add("is-valid");
      }
      return isValid;
    }

    // Dynamic Date Restriction Helper
    // Calculates current local date and formats YYYY-MM-DD for date inputs and YYYY-MM-DDTHH:MM for datetime-local
    function getTodayLocalDateStr() {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }

    function syncBookingDateMinLimits() {
      const todayStr = getTodayLocalDateStr();

      // Test Drive Date (date: min set to YYYY-MM-DD to disable past days while keeping today & future selectable)
      const contactDate = document.getElementById("contact-date");
      if (contactDate) {
        contactDate.min = todayStr;
      }

      // Car Booking Date (date: min set to YYYY-MM-DD)
      const carDate = document.getElementById("car-book-date");
      if (carDate) {
        carDate.min = todayStr;
      }
    }

    // Dynamic validator: checks that a date string represents today or a future date
    function isDateOnOrAfterToday(dateStr, isRequired = true) {
      if (!dateStr || !dateStr.trim()) {
        return !isRequired;
      }
      const clean = dateStr.trim().split("T")[0];
      const parts = clean.split("-");
      if (parts.length < 3) return false;
      const sYear = parseInt(parts[0], 10);
      const sMonth = parseInt(parts[1], 10);
      const sDay = parseInt(parts[2], 10);

      if (isNaN(sYear) || isNaN(sMonth) || isNaN(sDay)) return false;

      const now = new Date();
      const tYear = now.getFullYear();
      const tMonth = now.getMonth() + 1;
      const tDay = now.getDate();

      if (sYear < tYear) return false;
      if (sYear > tYear) return true;
      if (sMonth < tMonth) return false;
      if (sMonth > tMonth) return true;
      return sDay >= tDay;
    }

    // Ensure min date constraints are always up to date
    syncBookingDateMinLimits();
    window.addEventListener("focus", syncBookingDateMinLimits);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") syncBookingDateMinLimits();
    });

    // -------------------------------------------------------------
    // FORM 1: TEST DRIVE BOOKING FORM
    // -------------------------------------------------------------
    if (contactForm) {
      const nameInput = document.getElementById("contact-name");
      const phoneInput = document.getElementById("contact-phone");
      const emailInput = document.getElementById("contact-email");
      const carSelect = document.getElementById("vehicle-interest");
      const dateInput = document.getElementById("contact-date");
      const messageInput = document.getElementById("contact-message");

      const isNameValid = () => validateField(nameInput, v => v.length >= 2, "Please enter your full name (at least 2 characters)");
      const isPhoneValid = () => validateField(phoneInput, v => /^[\d\s\-\+\(\)]{10,15}$/.test(v), "Please enter a valid phone number (minimum 10 digits)");
      const isEmailValid = () => validateField(emailInput, v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Please enter a valid email address");
      const isCarValid = () => validateField(carSelect, v => v.length > 0, "Please choose a vehicle for your test drive");
      const isDateValid = () => validateField(
        dateInput,
        v => isDateOnOrAfterToday(v, true),
        "Please select today or a future date for your test drive (past dates cannot be selected)"
      );

      if (nameInput) nameInput.addEventListener("blur", isNameValid);
      if (phoneInput) phoneInput.addEventListener("blur", isPhoneValid);
      if (emailInput) emailInput.addEventListener("blur", isEmailValid);
      if (carSelect) carSelect.addEventListener("change", isCarValid);
      if (dateInput) {
        dateInput.addEventListener("focus", syncBookingDateMinLimits);
        dateInput.addEventListener("click", syncBookingDateMinLimits);
        dateInput.addEventListener("change", isDateValid);
        dateInput.addEventListener("blur", isDateValid);
        dateInput.addEventListener("input", isDateValid);
      }

      contactForm.addEventListener("submit", (e) => {
        e.preventDefault();

        // Refresh min constraint to catch any midnight date shifts
        syncBookingDateMinLimits();

        const validName = isNameValid();
        const validPhone = isPhoneValid();
        const validEmail = isEmailValid();
        const validCar = isCarValid();
        const validDate = isDateValid();

        if (!validName || !validPhone || !validEmail || !validCar || !validDate) {
          if (!validDate) {
            showToast("Test drive date must be today or a future date. Past dates are not allowed.", "danger");
          } else {
            showToast("Please complete all required fields for your test drive booking", "danger");
          }
          return;
        }

        const submitBtn = contactForm.querySelector(".form-submit-btn");
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `Scheduling Test Drive...`;
        }

        const selectedCar = carSelect ? (carSelect.value || "General Inquiries") : "General Inquiries";
        const serviceInput = document.getElementById("contact-service");
        const selectedService = serviceInput && serviceInput.value ? serviceInput.value : "Showroom Test Drive";
        let formattedSlot = "Flexible / Upcoming Date";
        if (dateInput && dateInput.value) {
          try {
            const [y, m, d] = dateInput.value.split("-");
            if (y && m && d) {
              const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
              formattedSlot = dateObj.toLocaleDateString("en-IN", { dateStyle: "medium" });
            } else {
              formattedSlot = dateInput.value;
            }
          } catch (_) {
            formattedSlot = dateInput.value;
          }
        }

        const payload = {
          customer_name: nameInput.value.trim(),
          phone: phoneInput.value.trim(),
          email: emailInput.value.trim(),
          vehicle_name: selectedCar,
          test_drive_type: selectedService,
          preferred_date: dateInput ? dateInput.value : "",
          preferred_slot: formattedSlot,
          city: "Jalna",
          message: messageInput ? messageInput.value.trim() : ""
        };

        fetch("/api/bookings/test-drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
        .then(async res => {
          const data = await res.json();
          if (!res.ok || data.error) {
            throw new Error(data.error || "Failed to confirm test drive booking");
          }
          return data;
        })
        .then(data => {
          const bookingRef = data.ref || (data.booking && (data.booking.booking_ref || data.booking.ref));
          if (!bookingRef) {
            throw new Error("Could not retrieve database booking reference from Supabase.");
          }
          const headline = document.getElementById("success-headline");
          const details = document.getElementById("success-details");
          const supabaseStatus = document.getElementById("success-supabase-status");

          if (headline) headline.textContent = "Test Drive Booking Confirmed!";
          if (details) {
            details.innerHTML = `
              Thank you, <strong>${escapeHtml(payload.customer_name)}</strong>! Your test drive for <strong>${escapeHtml(selectedCar)}</strong> (${escapeHtml(selectedService)}) is reserved.
              <br>Booking Reference: <strong style="color: #C5A880;">${bookingRef}</strong>
              <br>Date &amp; Slot: <strong>${escapeHtml(formattedSlot)}</strong>
              <br>Our dealership coordinator will call you at <strong>${escapeHtml(payload.phone)}</strong> to confirm slot delivery.
            `;
          }

          if (supabaseStatus) {
            supabaseStatus.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
              <span>Booking Confirmed &amp; Logged with Dealership Advisors</span>
            `;
          }

          const paneTestDrive = document.getElementById("pane-test-drive-form");
          if (paneTestDrive) paneTestDrive.style.display = "none";
          if (formSuccessBanner) formSuccessBanner.classList.add("is-success");

          showToast(`Test Drive ${bookingRef} confirmed!`, "success");
        })
        .catch(err => {
          console.warn("Test drive booking error:", err);
          showToast(err.message || "Could not register test drive booking. Please check details.", "danger");
        })
        .finally(() => {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `Book Test Drive`;
          }
        });
      });
    }

    // -------------------------------------------------------------
    // FORM 2: CAR BOOKING & ONLINE RESERVATION FORM
    // -------------------------------------------------------------
    const carResForm = document.getElementById("car-reservation-form");
    if (carResForm) {
      const bookName = document.getElementById("car-book-name");
      const bookPhone = document.getElementById("car-book-phone");
      const bookEmail = document.getElementById("car-book-email");
      const bookCity = document.getElementById("car-book-city");
      const bookCar = document.getElementById("car-book-vehicle");
      const bookColor = document.getElementById("car-book-color");
      const bookPayment = document.getElementById("car-book-payment");
      const bookDate = document.getElementById("car-book-date");
      const bookTrade = document.getElementById("car-book-trade");
      const bookNotes = document.getElementById("car-book-notes");

      const isBookNameValid = () => validateField(bookName, v => v.length >= 2, "Please enter buyer's full name");
      const isBookPhoneValid = () => validateField(bookPhone, v => /^[\d\s\-\+\(\)]{10,15}$/.test(v), "Please enter a valid 10-digit phone number");
      const isBookEmailValid = () => validateField(bookEmail, v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Please enter a valid email address");
      const isBookCarValid = () => validateField(bookCar, v => v.length > 0, "Please select the vehicle model you wish to book");
      const isBookCityValid = () => validateField(bookCity, v => v.length >= 2, "Please enter delivery city");
      const isBookDateValid = () => validateField(
        bookDate,
        v => isDateOnOrAfterToday(v, false),
        "Target delivery date must be today or a future date (past dates cannot be selected)"
      );

      if (bookName) bookName.addEventListener("blur", isBookNameValid);
      if (bookPhone) bookPhone.addEventListener("blur", isBookPhoneValid);
      if (bookEmail) bookEmail.addEventListener("blur", isBookEmailValid);
      if (bookCar) bookCar.addEventListener("change", isBookCarValid);
      if (bookCity) bookCity.addEventListener("blur", isBookCityValid);
      if (bookDate) {
        bookDate.addEventListener("focus", syncBookingDateMinLimits);
        bookDate.addEventListener("click", syncBookingDateMinLimits);
        bookDate.addEventListener("change", isBookDateValid);
        bookDate.addEventListener("blur", isBookDateValid);
        bookDate.addEventListener("input", isBookDateValid);
      }

      carResForm.addEventListener("submit", (e) => {
        e.preventDefault();

        // Refresh min constraint to catch any midnight date shifts
        syncBookingDateMinLimits();

        const vName = isBookNameValid();
        const vPhone = isBookPhoneValid();
        const vEmail = isBookEmailValid();
        const vCar = isBookCarValid();
        const vCity = isBookCityValid();
        const vDate = isBookDateValid();

        if (!vName || !vPhone || !vEmail || !vCar || !vCity || !vDate) {
          if (!vDate) {
            showToast("Target delivery date must be today or a future date. Past dates are not allowed.", "danger");
          } else {
            showToast("Please correct the required fields in the car booking form", "danger");
          }
          return;
        }

        const submitBtn = carResForm.querySelector(".form-submit-btn");
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `Reserving Vehicle...`;
        }

        const payload = {
          buyer_name: bookName.value.trim(),
          phone: bookPhone.value.trim(),
          email: bookEmail.value.trim(),
          city: bookCity.value.trim(),
          vehicle_name: bookCar.value.trim(),
          preferred_color: bookColor ? bookColor.value : "Standard",
          payment_mode: bookPayment ? bookPayment.value : "Financing",
          deposit_token: "₹25,000",
          delivery_target: bookDate ? bookDate.value : "",
          preferred_delivery_date: bookDate ? bookDate.value : "",
          trade_in_details: bookTrade ? bookTrade.value.trim() : "",
          notes: bookNotes ? bookNotes.value.trim() : ""
        };

        fetch("/api/bookings/car", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
        .then(async res => {
          const data = await res.json();
          if (!res.ok || data.error) {
            throw new Error(data.error || "Failed to confirm car reservation");
          }
          return data;
        })
        .then(data => {
          const bookingRef = data.ref || (data.booking && (data.booking.booking_ref || data.booking.ref));
          if (!bookingRef) {
            throw new Error("Could not retrieve database reservation reference from Supabase.");
          }
          const headline = document.getElementById("success-headline");
          const details = document.getElementById("success-details");
          const supabaseStatus = document.getElementById("success-supabase-status");

          if (headline) headline.textContent = "Car Booking Request Received!";
          if (details) {
            details.innerHTML = `
              Thank you, <strong>${escapeHtml(payload.buyer_name)}</strong>! Your booking request for <strong>${escapeHtml(payload.vehicle_name)}</strong> (${escapeHtml(payload.preferred_color)}) has been recorded.
              <br>Booking Reference: <strong style="color: #C5A880;">${bookingRef}</strong>
              <br>Delivery City: <strong>${escapeHtml(payload.city)}</strong>
              ${payload.delivery_target ? `<br>Preferred Delivery: <strong>${escapeHtml(payload.delivery_target)}</strong>` : ''}
              <br>Our dealership relationship manager will contact you at <strong>${escapeHtml(payload.phone)}</strong> to verify details and confirm reservation.
            `;
          }

          if (supabaseStatus) {
            supabaseStatus.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
              <span>Booking Request Recorded in Supabase</span>
            `;
          }

          const paneCarBooking = document.getElementById("pane-car-booking-form");
          if (paneCarBooking) paneCarBooking.style.display = "none";
          if (formSuccessBanner) formSuccessBanner.classList.add("is-success");

          showToast(`Car Booking ${bookingRef} confirmed!`, "success");
        })
        .catch(err => {
          console.warn("Car booking error:", err);
          showToast(err.message || "Could not register car reservation. Please check details.", "danger");
        })
        .finally(() => {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `Submit Car Booking`;
          }
        });
      });
    }

    // Reset Form button
    if (resetFormBtn) {
      resetFormBtn.addEventListener("click", () => {
        if (contactForm) {
          contactForm.reset();
          contactForm.querySelectorAll(".form-control").forEach(inp => inp.classList.remove("is-valid", "is-invalid"));
        }
        if (carResForm) {
          carResForm.reset();
          carResForm.querySelectorAll(".form-control").forEach(inp => inp.classList.remove("is-valid", "is-invalid"));
        }
        if (formSuccessBanner) formSuccessBanner.classList.remove("is-success");

        // Restore active pane
        const paneTestDrive = document.getElementById("pane-test-drive-form");
        const paneCarBooking = document.getElementById("pane-car-booking-form");
        const tabBtnTestDrive = document.getElementById("tab-btn-test-drive");
        if (tabBtnTestDrive && tabBtnTestDrive.classList.contains("active")) {
          if (paneTestDrive) paneTestDrive.style.display = "block";
          if (paneCarBooking) paneCarBooking.style.display = "none";
        } else {
          if (paneTestDrive) paneTestDrive.style.display = "none";
          if (paneCarBooking) paneCarBooking.style.display = "block";
        }
      });
    }
  }

  // =========================================================================
  // 9. EVENT LISTENERS & INITIALIZATION
  // =========================================================================

  // Category Tabs
  categoryTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      categoryTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.selectedCategory = tab.dataset.category;
      renderInventory();
    });
  });

  // =========================================================================
  // RESPONSIVE INVENTORY GRID HANDLER
  // =========================================================================
  let updateScrollControls = function() {};

  function initInventoryScroll() {
    if (!inventoryGrid) return;
    inventoryGrid.classList.remove("horizontal-theme", "grid-view");
  }

  // Sort Select
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      state.sortBy = e.target.value;
      renderInventory();
    });
  }

  // Hero Search Form
  if (heroForm) {
    heroForm.addEventListener("submit", (e) => {
      e.preventDefault();
      state.searchQuery = heroSearchInput ? heroSearchInput.value : "";
      state.bodyTypeFilter = heroBodySelect ? heroBodySelect.value : "all";
      state.priceRangeFilter = heroPriceSelect ? heroPriceSelect.value : "all";
      state.fuelTypeFilter = heroFuelSelect ? heroFuelSelect.value : "all";
      renderInventory();

      const inv = document.getElementById("inventory");
      if (inv) inv.scrollIntoView({ behavior: "smooth" });
    });
  }

  // Clear Filters Button in Meta bar
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", resetAllFilters);
  }

  // Compare Dock Buttons
  if (dockCompareBtn) dockCompareBtn.addEventListener("click", openCompareModal);
  if (navCompareBtn) navCompareBtn.addEventListener("click", openCompareModal);
  if (dockClearBtn) {
    dockClearBtn.addEventListener("click", () => {
      state.comparedIds = [];
      updateCompareDock();
      renderInventory();
      showToast("Comparison cleared", "info");
    });
  }

  // Compare Modal Close
  if (compareModalClose) compareModalClose.addEventListener("click", closeCompareModal);
  if (compareModal) {
    compareModal.addEventListener("click", (e) => {
      if (e.target === compareModal) closeCompareModal();
    });
  }

  // Diff Toggle
  if (diffToggle) {
    diffToggle.addEventListener("change", renderCompareTable);
  }

  // Details Modal Close
  if (detailsModalClose) detailsModalClose.addEventListener("click", closeDetailsModal);
  if (detailsModal) {
    detailsModal.addEventListener("click", (e) => {
      if (e.target === detailsModal) closeDetailsModal();
    });
  }

  // Escape key closes modals
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCompareModal();
      closeDetailsModal();
    }
  });

  // Mobile Menu Toggle
  if (menuToggle && navMenu) {
    const closeMobileMenu = () => {
      menuToggle.classList.remove("is-active");
      navMenu.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
    };

    menuToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const isActive = menuToggle.classList.toggle("is-active");
      navMenu.classList.toggle("is-open");
      menuToggle.setAttribute("aria-expanded", isActive);
    });

    // Close menu when clicking nav link or mobile book CTA
    navLinks.forEach(link => {
      link.addEventListener("click", () => {
        closeMobileMenu();
      });
    });

    const mobileBookBtn = navMenu.querySelector(".nav-menu-book-btn");
    if (mobileBookBtn) {
      mobileBookBtn.addEventListener("click", () => {
        closeMobileMenu();
      });
    }

    // Close menu when clicking or tapping outside
    document.addEventListener("click", (e) => {
      if (navMenu.classList.contains("is-open") && !navMenu.contains(e.target) && !menuToggle.contains(e.target)) {
        closeMobileMenu();
      }
    });

    // Close menu when pressing Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && navMenu.classList.contains("is-open")) {
        closeMobileMenu();
      }
    });
  }

  // Sticky Navbar Scroll Elevation
  window.addEventListener("scroll", () => {
    if (window.scrollY > 30) {
      siteHeader.classList.add("scrolled");
    } else {
      siteHeader.classList.remove("scrolled");
    }

    // Update active nav link based on scroll position
    const sections = document.querySelectorAll("section[id]");
    const scrollY = window.pageYOffset;
    sections.forEach(current => {
      const sectionHeight = current.offsetHeight;
      const sectionTop = current.offsetTop - 100;
      const sectionId = current.getAttribute("id");
      if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
        navLinks.forEach(l => {
          l.classList.remove("active");
          if (l.getAttribute("href") === `#${sectionId}`) {
            l.classList.add("active");
          }
        });
      }
    });
  });

  // Expose Global Store for Admin Portal & Inventory Management
  window.EktaStore = {
    getVehicles: () => VEHICLES,
    setVehicles: (newList) => {
      VEHICLES = newList || [];
      populateVehicleSelect();
      renderInventory();
      updateCompareDock();
    },
    saveVehicle: (vehicleData) => {
      if (sessionStorage.getItem("ekta_admin_session") !== "true") {
        showToast("Unauthorized: Administrator authentication required to edit inventory", "error");
        return;
      }
      const idx = VEHICLES.findIndex(v => v.id === vehicleData.id);
      if (idx >= 0) {
        VEHICLES[idx] = { ...VEHICLES[idx], ...vehicleData };
      } else {
        VEHICLES.unshift(vehicleData);
      }
      populateVehicleSelect();
      renderInventory();
      updateCompareDock();
    },
    deleteVehicle: (carId) => {
      if (sessionStorage.getItem("ekta_admin_session") !== "true") {
        showToast("Unauthorized: Administrator authentication required to delete vehicles", "error");
        return;
      }
      VEHICLES = VEHICLES.filter(v => v.id !== carId);
      state.comparedIds = state.comparedIds.filter(id => id !== carId);
      populateVehicleSelect();
      renderInventory();
      updateCompareDock();
    },
    resetVehicles: () => {
      syncLiveFleetFromBackend();
      showToast("Syncing with live Supabase database...", "info");
    },
    openVehicleDetails: (carId, tab = "specs") => {
      openVehicleDetails(carId, tab);
    },
    renderUniversalCarCard: (car) => renderUniversalCarCard(car),
    getActiveVehicles: () => getActiveVehicles(),
    getCategoryCounts: () => updateCategoryCounts(),
    updateCategoryCounts: () => updateCategoryCounts(),
    formatINR: (val) => formatINR(val),
    showToast: (msg, type = "info") => showToast(msg, type),
    syncBackend: () => syncLiveFleetFromBackend(),
    refreshReviews: () => fetchAndRenderCustomerReviews()
  };

  // =========================================================================
  // 10. CUSTOMER REVIEW SUBMISSION & LIVE BACKEND SYNC
  // =========================================================================
  function openCustomerReviewModal() {
    const modal = document.getElementById("review-submission-modal");
    if (!modal) return;
    
    // Clear previous alerts
    const alertEl = document.getElementById("review-form-alert");
    if (alertEl) {
      alertEl.style.display = "none";
      alertEl.textContent = "";
    }
    
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
    
    const nameInput = document.getElementById("review-author-name");
    if (nameInput) {
      setTimeout(() => nameInput.focus(), 60);
    }
  }

  function closeCustomerReviewModal() {
    const modal = document.getElementById("review-submission-modal");
    if (!modal) return;
    
    modal.classList.remove("active");
    document.body.style.overflow = "";
    
    const form = document.getElementById("customer-review-form");
    if (form) form.reset();
    
    const ratingInput = document.getElementById("review-rating-value");
    if (ratingInput) ratingInput.value = "5";
    
    const ratingHint = document.getElementById("rating-text-hint");
    if (ratingHint) ratingHint.textContent = "(5 - Excellent)";
    
    const starPicker = document.getElementById("rating-star-picker");
    if (starPicker) {
      starPicker.querySelectorAll(".star-pick").forEach((s) => {
        s.style.color = "#f59e0b";
      });
    }
    
    const alertEl = document.getElementById("review-form-alert");
    if (alertEl) {
      alertEl.style.display = "none";
      alertEl.textContent = "";
    }
  }

  function initCustomerReviewModal() {
    const modal = document.getElementById("review-submission-modal");
    const form = document.getElementById("customer-review-form");
    const starPicker = document.getElementById("rating-star-picker");
    const ratingInput = document.getElementById("review-rating-value");
    const ratingHint = document.getElementById("rating-text-hint");

    if (!modal) return;

    const ratingDescriptions = {
      1: "(1 - Needs Improvement)",
      2: "(2 - Fair)",
      3: "(3 - Good)",
      4: "(4 - Very Good)",
      5: "(5 - Excellent)"
    };

    function updateStarsDisplay(rating) {
      if (ratingInput) ratingInput.value = rating;
      if (ratingHint && ratingDescriptions[rating]) {
        ratingHint.textContent = ratingDescriptions[rating];
      }
      if (starPicker) {
        starPicker.querySelectorAll(".star-pick").forEach((s) => {
          const r = Number(s.dataset.rating) || 0;
          if (r <= rating) {
            s.style.color = "#f59e0b";
          } else {
            s.style.color = "#475569";
          }
        });
      }
    }

    if (starPicker) {
      starPicker.addEventListener("click", (e) => {
        const star = e.target.closest(".star-pick");
        if (!star) return;
        const rating = Number(star.dataset.rating) || 5;
        updateStarsDisplay(rating);
      });
    }

    // Global click delegation for review triggers and close buttons
    document.addEventListener("click", (e) => {
      const openBtn = e.target.closest("#btn-open-review-modal, #btn-empty-write-review, .btn-open-review-cta, [data-action='open-review-modal']");
      if (openBtn) {
        e.preventDefault();
        openCustomerReviewModal();
        return;
      }

      const closeBtn = e.target.closest("#review-modal-close, #review-cancel-btn");
      if (closeBtn) {
        e.preventDefault();
        closeCustomerReviewModal();
        return;
      }

      if (e.target === modal) {
        closeCustomerReviewModal();
      }
    });

    // Escape key closes modal
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("active")) {
        closeCustomerReviewModal();
      }
    });

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const alertEl = document.getElementById("review-form-alert");
        const submitBtn = document.getElementById("review-submit-btn");

        function setAlert(message, type = "error") {
          if (!alertEl) return;
          alertEl.textContent = message;
          alertEl.style.display = "block";
          if (type === "error") {
            alertEl.style.backgroundColor = "rgba(239, 68, 68, 0.15)";
            alertEl.style.border = "1px solid #ef4444";
            alertEl.style.color = "#fca5a5";
          } else {
            alertEl.style.backgroundColor = "rgba(34, 197, 94, 0.15)";
            alertEl.style.border = "1px solid #22c55e";
            alertEl.style.color = "#86efac";
          }
        }

        const authorNameInput = document.getElementById("review-author-name");
        const authorCarInput = document.getElementById("review-author-car");
        const purchaseYearInput = document.getElementById("review-purchase-year");
        const quoteInput = document.getElementById("review-quote");

        const authorName = authorNameInput ? authorNameInput.value.trim() : "";
        const authorCar = authorCarInput ? authorCarInput.value.trim() : "";
        const purchaseYear = purchaseYearInput ? purchaseYearInput.value.trim() : "";
        const quote = quoteInput ? quoteInput.value.trim() : "";
        const rating = Number(ratingInput ? ratingInput.value : 5);

        // Validation
        if (!authorName) {
          setAlert("Please enter your full name.", "error");
          if (authorNameInput) authorNameInput.focus();
          return;
        }

        if (!rating || rating < 1 || rating > 5) {
          setAlert("Please select a rating between 1 and 5 stars.", "error");
          return;
        }

        if (!quote) {
          setAlert("Please enter your review text / feedback.", "error");
          if (quoteInput) quoteInput.focus();
          return;
        }

        // Prevent duplicate submissions
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Submitting Review...";
        }

        // Ensure supabase instance is resolved
        if (!supabase && window.supabase) {
          if (typeof window.supabase.from === "function") {
            supabase = window.supabase;
          } else if (typeof window.supabase.createClient === "function") {
            try {
              supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            } catch (_) {}
          }
        }

        // Prepare review record with explicit 'pending' status
        const reviewPayload = {
          customer_name: authorName,
          rating: rating,
          review: quote,
          vehicle_name: authorCar || null,
          purchase_year: purchaseYear ? String(purchaseYear) : null,
          status: "pending",
          verified: false,
          author_name: authorName,
          quote: quote,
          author_car: authorCar || null,
          is_verified: false,
          created_at: new Date().toISOString()
        };

        let data = null;
        let error = null;

        try {
          if (supabase && typeof supabase.from === "function") {
            // Perform actual asynchronous insert using the 'supabase' client instance
            const insertQuery = supabase.from("reviews").insert([reviewPayload]);
            const res = (insertQuery && typeof insertQuery.select === "function")
              ? await insertQuery.select()
              : await insertQuery;

            data = res ? res.data : null;
            error = res ? res.error : null;

            // In case of schema column mismatch, retry with clean standard columns
            if (error && error.message && (error.message.includes("column") || error.message.includes("schema cache"))) {
              const cleanPayload = {
                customer_name: authorName,
                rating: rating,
                review: quote,
                status: "pending",
                verified: false
              };
              if (authorCar) cleanPayload.vehicle_name = authorCar;
              const retryQuery = supabase.from("reviews").insert([cleanPayload]);
              const retryRes = (retryQuery && typeof retryQuery.select === "function")
                ? await retryQuery.select()
                : await retryQuery;
              if (!retryRes.error) {
                data = retryRes.data;
                error = null;
              } else {
                // Try legacy author_name column schema
                const legacyPayload = {
                  author_name: authorName,
                  rating: rating,
                  quote: quote,
                  status: "pending"
                };
                if (authorCar) legacyPayload.author_car = authorCar;
                const legQuery = supabase.from("reviews").insert([legacyPayload]);
                const legRes = (legQuery && typeof legQuery.select === "function")
                  ? await legQuery.select()
                  : await legQuery;
                if (!legRes.error) {
                  data = legRes.data;
                  error = null;
                } else {
                  error = retryRes.error;
                }
              }
            }

            // If direct client insertion was blocked by RLS policy (code 42501), permission denied, or failed
            if (error) {
              console.warn("[Customer Review Supabase Anon Notice]:", error.message, "- saving to Supabase via server API...");
              try {
                const res = await fetch("/api/reviews", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    customerName: authorName,
                    authorName,
                    rating,
                    review: quote,
                    quote,
                    vehicleName: authorCar,
                    authorCar,
                    purchaseYear,
                    status: "pending",
                    verified: false
                  })
                });
                const resJson = await res.json().catch(() => ({}));
                if (res.ok && resJson.success) {
                  data = resJson.review;
                  error = null; // Successfully saved to Supabase!
                } else if (resJson.error) {
                  error = { message: resJson.error };
                }
              } catch (fallbackErr) {
                console.error("[Customer Review Server Fallback Error]:", fallbackErr);
              }
            }
          } else {
            // Fallback: asynchronous POST request via dealership backend
            const res = await fetch("/api/reviews", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                customerName: authorName,
                authorName,
                rating,
                review: quote,
                quote,
                vehicleName: authorCar,
                authorCar,
                purchaseYear,
                status: "pending",
                verified: false
              })
            });
            const resJson = await res.json().catch(() => ({}));
            if (!res.ok || !resJson.success) {
              error = { message: resJson.error || `Review submission failed (HTTP ${res.status}).` };
            } else {
              data = resJson.review;
            }
          }

          if (error) {
            console.error("[Customer Review Supabase Insert Error]:", error);
            let errorMsg = error.message || "Unable to submit your review to Supabase. Please try again.";
            if (error.code === "PGRST205" || (error.message && error.message.includes("schema cache"))) {
              errorMsg = "The 'reviews' table was not found in Supabase. Please ensure the 'reviews' table is created in your Supabase SQL Editor.";
            }
            setAlert(errorMsg, "error");
            showToast(errorMsg, "danger");
            return;
          }

          // Real submission succeeded: Clean confirmation message & UI feedback
          setAlert("Thank you for sharing your experience! Your review has been submitted and is awaiting approval.", "success");
          showToast("Thank you for sharing your experience. Your review has been submitted and is awaiting approval.", "success");

          // Reset form and modal state
          closeCustomerReviewModal();

          // Re-fetch reviews to sync state
          fetchAndRenderCustomerReviews();
        } catch (err) {
          console.error("[Customer Review Submit Network Error]:", err);
          const networkErrMsg = "Network error: Unable to connect to review service. Please try again.";
          setAlert(networkErrMsg, "error");
          showToast(networkErrMsg, "danger");
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Submit Review";
          }
        }
      });
    }
  }

  async function syncLiveFleetFromBackend() {
    isFetchingVehicles = true;
    vehicleFetchError = null;
    renderInventory();

    let fetchedCars = null;
    let fetchErrMsg = null;

    try {
      const res = await fetch("/api/cars");
      const contentType = res.headers.get("content-type") || "";
      let json = null;
      if (contentType.includes("application/json")) {
        json = await res.json();
      } else {
        const raw = await res.text();
        try {
          json = JSON.parse(raw);
        } catch (_) {
          json = null;
        }
      }

      if (res.ok && json && json.success && Array.isArray(json.cars)) {
        fetchedCars = json.cars;
        fetchErrMsg = null;
      } else {
        fetchedCars = null;
        fetchErrMsg = (json && json.error) || (json && json.message) || `Showroom service error (${res.status})`;
      }
    } catch (err) {
      fetchedCars = null;
      fetchErrMsg = err.message || "Failed to load vehicle showroom";
    }

    isFetchingVehicles = false;

    if (fetchedCars && Array.isArray(fetchedCars)) {
      VEHICLES = fetchedCars.map(c => c ? ({ ...c, name: getCleanVehicleName(c) }) : c);
      vehicleFetchError = null;
    } else {
      VEHICLES = [];
      vehicleFetchError = fetchErrMsg || "Showroom inventory could not be loaded";
    }

    populateVehicleSelect();
    renderInventory();
    updateCompareDock();

    // Auto-open vehicle details modal when navigated via /cars/:id deep link
    try {
      const pathCarId = window.location.pathname.startsWith("/cars/") ? window.location.pathname.replace(/^\/cars\//, "").split("/")[0] : null;
      const targetVehicleId = window.__PRELOADED_VEHICLE_ID__ || pathCarId;
      if (targetVehicleId && typeof openVehicleDetails === "function") {
        const targetCar = VEHICLES.find(v => v.id === targetVehicleId || (v.id && v.id.toLowerCase() === targetVehicleId.toLowerCase()));
        if (targetCar) {
          setTimeout(() => {
            openVehicleDetails(targetCar.id);
          }, 150);
        }
      }
    } catch (_) {}
  }

  // =========================================================================
  // 11. OWNER-ONLY BOOKING QUERIES PORTAL & BOTTOM CONTROLS
  // =========================================================================
  function initOwnerBookingQueries() {
    const modal = document.getElementById("owner-booking-queries-modal");
    if (!modal) return;

    const closeBtn = document.getElementById("owner-queries-modal-close");
    const bottomBtn = document.getElementById("btn-bottom-owner-queries");
    const footerNavBtn = document.getElementById("footer-nav-owner-queries");
    const floatingBtn = document.getElementById("floating-owner-queries-btn");

    const gateView = document.getElementById("owner-queries-gate");
    const viewerView = document.getElementById("owner-queries-viewer");
    const gateForm = document.getElementById("owner-gate-form");
    const gateAlert = document.getElementById("gate-alert-box");
    const gateSubmitBtn = document.getElementById("owner-gate-submit-btn");
    const gateSpinner = document.getElementById("gate-btn-spinner");
    const gateBtnIcon = document.getElementById("gate-btn-icon");
    const gateBtnText = document.getElementById("gate-btn-text");

    const refreshBtn = document.getElementById("btn-refresh-owner-queries");
    const logoutBtn = document.getElementById("btn-logout-owner-queries");
    const searchInput = document.getElementById("owner-queries-search");
    const filterChips = document.querySelectorAll("#owner-status-filters .filter-chip");
    const queriesList = document.getElementById("owner-queries-list");

    let allInquiries = [];
    let currentFilter = "all";
    let currentSearch = "";

    function getStoredToken() {
      return (
        localStorage.getItem("ekta_admin_token") ||
        sessionStorage.getItem("ekta_admin_token") ||
        ""
      );
    }

    function setStoredToken(token) {
      if (token) {
        localStorage.setItem("ekta_admin_token", token);
        localStorage.setItem("ekta_admin_session", "true");
        document.cookie = `ekta_admin_token=${encodeURIComponent(token)}; path=/; max-age=86400; SameSite=None; Secure; Partitioned`;
      } else {
        localStorage.removeItem("ekta_admin_token");
        localStorage.removeItem("ekta_admin_session");
        sessionStorage.removeItem("ekta_admin_token");
        sessionStorage.removeItem("ekta_admin_session");
        document.cookie = "ekta_admin_token=; path=/; max-age=0; SameSite=None; Secure; Partitioned";
      }
    }

    async function verifyOwnerAuth() {
      const token = getStoredToken();
      if (!token) return false;
      try {
        const res = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.user) {
            const userEl = document.getElementById("owner-verified-username");
            if (userEl && data.user.username) {
              userEl.textContent = data.user.username;
            }
            return true;
          }
        }
      } catch (err) {
        console.warn("Auth check error", err);
      }
      return false;
    }

    function showGateView(errMsg = "") {
      if (gateView) gateView.style.display = "flex";
      if (viewerView) viewerView.style.display = "none";
      if (gateAlert) {
        if (errMsg) {
          gateAlert.textContent = errMsg;
          gateAlert.style.display = "block";
        } else {
          gateAlert.style.display = "none";
        }
      }
    }

    function showViewerView() {
      if (gateView) gateView.style.display = "none";
      if (viewerView) viewerView.style.display = "block";
    }

    async function openModal() {
      modal.style.display = "flex";
      document.body.style.overflow = "hidden";

      const isAuthed = await verifyOwnerAuth();
      if (isAuthed) {
        showViewerView();
        loadInquiries();
      } else {
        showGateView();
        const idInput = document.getElementById("owner-gate-id");
        if (idInput) setTimeout(() => idInput.focus(), 150);
      }
    }

    function closeModal() {
      modal.style.display = "none";
      document.body.style.overflow = "";
      if (window.location.hash === "#owner-booking-queries" || window.location.hash === "#owner-queries") {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }

    // Event listeners for triggers
    [bottomBtn, footerNavBtn, floatingBtn].forEach((btn) => {
      if (btn) {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          openModal();
        });
      }
    });

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.style.display === "flex") {
        closeModal();
      }
    });

    // Check if opened via URL hash or param
    const urlParams = new URLSearchParams(window.location.search);
    if (
      window.location.hash === "#owner-booking-queries" ||
      urlParams.get("openQueries") === "true" ||
      window.location.hash === "#owner-queries"
    ) {
      setTimeout(openModal, 400);
    }

    // Owner Gate Login
    if (gateForm) {
      gateForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("owner-gate-id").value.trim();
        const password = document.getElementById("owner-gate-pass").value;

        if (gateSubmitBtn) gateSubmitBtn.disabled = true;
        if (gateSpinner) gateSpinner.style.display = "inline-block";
        if (gateBtnIcon) gateBtnIcon.style.display = "none";
        if (gateBtnText) gateBtnText.textContent = "Verifying Credentials...";
        if (gateAlert) gateAlert.style.display = "none";

        try {
          const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
          });
          const data = await res.json();

          if (res.ok && data.token) {
            setStoredToken(data.token);
            const userEl = document.getElementById("owner-verified-username");
            if (userEl && data.user && data.user.username) {
              userEl.textContent = data.user.username;
            }
            showToast("Owner verified! Customer booking queries unlocked.", "success");
            showViewerView();
            loadInquiries();
            gateForm.reset();
          } else {
            showGateView(data.error || "Access Denied: Invalid credentials. Only the verified website owner may access booking queries.");
            const gateCard = document.querySelector(".gate-card");
            if (gateCard) {
              gateCard.classList.add("shake-anim");
              setTimeout(() => gateCard.classList.remove("shake-anim"), 500);
            }
          }
        } catch (err) {
          showGateView("Unable to connect to dealership authentication server. Please check your connection.");
        } finally {
          if (gateSubmitBtn) gateSubmitBtn.disabled = false;
          if (gateSpinner) gateSpinner.style.display = "none";
          if (gateBtnIcon) gateBtnIcon.style.display = "inline";
          if (gateBtnText) gateBtnText.textContent = "Verify & View Booking Queries";
        }
      });
    }

    // Load Inquiries
    async function loadInquiries() {
      const token = getStoredToken();
      if (!token) {
        showGateView("Session expired. Please verify owner credentials again.");
        return;
      }

      if (queriesList) {
        queriesList.innerHTML = `
          <div style="text-align: center; padding: 2.5rem; color: #94a3b8;">
            <div class="gate-spinner" style="display: inline-block; width: 24px; height: 24px; border: 3px solid rgba(245,158,11,0.2); border-top-color: #f59e0b; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 0.75rem;"></div>
            <p>Retrieving confidential customer booking records...</p>
          </div>
        `;
      }

      try {
        const res = await fetch("/api/admin/inquiries", {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (res.status === 401 || res.status === 403) {
          setStoredToken("");
          showGateView("Access unauthorized. Only the verified website owner has permission to view booking queries.");
          return;
        }

        const data = await res.json();
        allInquiries = Array.isArray(data.inquiries) ? data.inquiries : [];
        updateStats();
        renderInquiriesList();
      } catch (err) {
        if (queriesList) {
          queriesList.innerHTML = `
            <div class="owner-empty-state">
              <p style="color: #ef4444;">Failed to load booking queries from the server.</p>
              <button type="button" class="btn btn-sm btn-secondary" onclick="document.getElementById('btn-refresh-owner-queries').click()">Retry</button>
            </div>
          `;
        }
      }
    }

    // Update Stats counters
    function updateStats() {
      const total = allInquiries.length;
      const newCount = allInquiries.filter(i => (i.status || "new").toLowerCase() === "new").length;
      const contactedCount = allInquiries.filter(i => (i.status || "").toLowerCase() === "contacted").length;
      const completedCount = allInquiries.filter(i => (i.status || "").toLowerCase() === "completed").length;

      const totalEl = document.getElementById("owner-stat-total");
      const newEl = document.getElementById("owner-stat-new");
      const contactedEl = document.getElementById("owner-stat-contacted");
      const completedEl = document.getElementById("owner-stat-completed");
      const chipAll = document.getElementById("chip-count-all");
      const chipNew = document.getElementById("chip-count-new");

      if (totalEl) totalEl.textContent = total;
      if (newEl) newEl.textContent = newCount;
      if (contactedEl) contactedEl.textContent = contactedCount;
      if (completedEl) completedEl.textContent = completedCount;
      if (chipAll) chipAll.textContent = total;
      if (chipNew) chipNew.textContent = newCount;
    }

    // Render Inquiries
    function renderInquiriesList() {
      if (!queriesList) return;

      let filtered = allInquiries.filter((inq) => {
        const matchesFilter =
          currentFilter === "all" ||
          (inq.status || "new").toLowerCase() === currentFilter.toLowerCase();

        const q = currentSearch.trim().toLowerCase();
        const matchesSearch =
          !q ||
          (inq.name && inq.name.toLowerCase().includes(q)) ||
          (inq.phone && inq.phone.toLowerCase().includes(q)) ||
          (inq.email && inq.email.toLowerCase().includes(q)) ||
          (inq.carName && inq.carName.toLowerCase().includes(q)) ||
          (inq.service && inq.service.toLowerCase().includes(q)) ||
          (inq.message && inq.message.toLowerCase().includes(q)) ||
          (inq.id && String(inq.id).toLowerCase().includes(q));

        return matchesFilter && matchesSearch;
      });

      if (filtered.length === 0) {
        queriesList.innerHTML = `
          <div class="owner-empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <h5 style="color: #cbd5e1; font-size: 1rem; margin-bottom: 0.25rem;">No Customer Queries Found</h5>
            <p style="font-size: 0.8125rem;">There are no booking queries matching your selected filter.</p>
          </div>
        `;
        return;
      }

      queriesList.innerHTML = filtered.map((inq) => {
        const status = (inq.status || "new").toLowerCase();
        const dateFormatted = inq.createdAt
          ? new Date(inq.createdAt).toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            })
          : "Recently";

        const cleanPhone = (inq.phone || "").replace(/[^0-9+]/g, "");

        const displayRef = inq.ref || `#${inq.id}`;
        const slotText = [inq.preferredDate, inq.preferredTime].filter(Boolean).join(" • ");
        const vehicleDisplay = inq.vehicleName || inq.carName || "General Consultation / Test Drive";
        const messageDisplay = inq.message || inq.comments || "";

        return `
          <div class="owner-inq-card" data-id="${inq.id}">
            <div class="inq-card-header">
              <div class="inq-customer-info">
                <h5>${escapeHTML(inq.name || "Valued Client")}</h5>
                <div class="inq-meta-line">
                  <span class="inq-ref-code">${escapeHTML(displayRef)}</span>
                  <span>•</span>
                  <span>${dateFormatted}</span>
                  ${slotText ? `<span>• Preferred Slot: <strong>${escapeHTML(slotText)}</strong></span>` : ""}
                </div>
              </div>
              <div class="inq-status-group">
                <select class="inq-status-select" data-id="${inq.id}">
                  <option value="new" ${status === "new" ? "selected" : ""}>New / Unread</option>
                  <option value="pending confirmation" ${status.includes("pending") ? "selected" : ""}>Pending Confirmation</option>
                  <option value="contacted" ${status === "contacted" ? "selected" : ""}>Contacted</option>
                  <option value="confirmed" ${status === "confirmed" ? "selected" : ""}>Confirmed Slot</option>
                  <option value="completed" ${status === "completed" ? "selected" : ""}>Completed</option>
                  <option value="cancelled" ${status === "cancelled" ? "selected" : ""}>Cancelled</option>
                </select>
                <button type="button" class="inq-btn-delete" data-id="${inq.id}" title="Delete Query">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              </div>
            </div>

            <div class="inq-card-details-grid">
              <div class="inq-detail-block">
                <div class="inq-detail-label">Vehicle Requested</div>
                <div class="inq-detail-val">${escapeHTML(vehicleDisplay)}</div>
              </div>
              <div class="inq-detail-block">
                <div class="inq-detail-label">Service Type</div>
                <div class="inq-detail-val">${escapeHTML(inq.service || "Showroom Test Drive")}</div>
              </div>
              <div class="inq-detail-block">
                <div class="inq-detail-label">Client Contact</div>
                <div class="inq-detail-val">${escapeHTML(inq.phone || "N/A")} ${inq.email ? `• ${escapeHTML(inq.email)}` : ""}</div>
              </div>
            </div>

            ${messageDisplay ? `
              <div class="inq-message-box">
                <div class="inq-message-label">Client Request Notes:</div>
                <div>${escapeHTML(messageDisplay)}</div>
              </div>
            ` : ""}

            <div class="inq-card-footer">
              <div class="inq-quick-contacts">
                ${inq.phone ? `
                  <a href="tel:${cleanPhone}" class="inq-btn-contact call" title="Call Customer">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                    </svg>
                    <span>Call</span>
                  </a>
                  <a href="https://wa.me/${cleanPhone.replace('+', '')}" target="_blank" class="inq-btn-contact whatsapp" title="Chat on WhatsApp">
                    <span>WhatsApp</span>
                  </a>
                ` : ""}
                ${inq.email ? `
                  <a href="mailto:${encodeURIComponent(inq.email)}?subject=Ekta%20Motors%20Booking%20Confirmation%20%23${inq.id}" class="inq-btn-contact email" title="Send Official Email">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                    <span>Email</span>
                  </a>
                ` : ""}
              </div>

              <div class="inq-notes-wrapper">
                <input
                  type="text"
                  class="inq-notes-input"
                  placeholder="Owner internal notes..."
                  value="${escapeHTML(inq.notes || '')}"
                  data-id="${inq.id}"
                />
                <button type="button" class="inq-btn-save-note" data-id="${inq.id}">Save</button>
              </div>
            </div>
          </div>
        `;
      }).join("");

      // Bind status dropdown changes
      queriesList.querySelectorAll(".inq-status-select").forEach((sel) => {
        sel.addEventListener("change", async (e) => {
          const id = e.target.dataset.id;
          const status = e.target.value;
          await updateInquiry(id, { status });
        });
      });

      // Bind Save Note buttons
      queriesList.querySelectorAll(".inq-btn-save-note").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const id = e.target.dataset.id;
          const input = queriesList.querySelector(`.inq-notes-input[data-id="${id}"]`);
          const notes = input ? input.value.trim() : "";
          await updateInquiry(id, { notes });
          showToast(`Notes saved for inquiry #${id}`, "success");
        });
      });

      // Bind Delete buttons
      queriesList.querySelectorAll(".inq-btn-delete").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const id = e.target.dataset.id;
          if (confirm(`Are you sure you want to remove inquiry #${id}?`)) {
            await deleteInquiry(id);
          }
        });
      });
    }

    async function updateInquiry(id, updates) {
      const token = getStoredToken();
      if (!token) return;
      try {
        const res = await fetch(`/api/admin/inquiries/${id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(updates)
        });
        if (res.ok) {
          const idx = allInquiries.findIndex(i => String(i.id) === String(id));
          if (idx >= 0) {
            allInquiries[idx] = { ...allInquiries[idx], ...updates };
            updateStats();
          }
        } else {
          showToast("Failed to update inquiry status", "error");
        }
      } catch (err) {
        showToast("Error updating inquiry", "error");
      }
    }

    async function deleteInquiry(id) {
      const token = getStoredToken();
      if (!token) return;
      try {
        const res = await fetch(`/api/admin/inquiries/${id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (res.ok) {
          allInquiries = allInquiries.filter(i => String(i.id) !== String(id));
          updateStats();
          renderInquiriesList();
          showToast(`Inquiry #${id} deleted successfully.`, "info");
        } else {
          showToast("Failed to delete inquiry", "error");
        }
      } catch (err) {
        showToast("Error deleting inquiry", "error");
      }
    }

    // Filter Chips
    filterChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        filterChips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        currentFilter = chip.dataset.status || "all";
        renderInquiriesList();
      });
    });

    // Search Input
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        currentSearch = e.target.value;
        renderInquiriesList();
      });
    }

    // Refresh Button
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        loadInquiries();
        showToast("Live booking queries refreshed.", "info");
      });
    }

    // =========================================================================
    // OWNER MODAL: CUSTOMER REVIEWS MODERATION TAB
    // =========================================================================
    const ownerNavTabQueries = document.getElementById("tab-btn-owner-queries");
    const ownerNavTabReviews = document.getElementById("tab-btn-owner-reviews");
    const ownerPaneQueries = document.getElementById("owner-pane-queries");
    const ownerPaneReviews = document.getElementById("owner-pane-reviews");

    const ownerRevFilterAll = document.getElementById("owner-rev-filter-all");
    const ownerRevFilterPending = document.getElementById("owner-rev-filter-pending");
    const ownerRevFilterApproved = document.getElementById("owner-rev-filter-approved");
    const ownerReviewsTbody = document.getElementById("owner-reviews-tbody");

    let ownerRevCurrentFilter = "all"; // 'all' | 'pending' | 'approved'

    function renderOwnerReviewsTable() {
      if (!ownerReviewsTbody) return;

      const totalCount = allAdminReviews.length || customerReviews.length;
      const pendingCount = adminPendingReviews.length;
      const approvedCount = allAdminReviews.filter(r => r.status === "approved").length || customerReviews.length;

      const countAllEl = document.getElementById("owner-rev-count-all");
      const countPendEl = document.getElementById("owner-rev-count-pending");
      const countApprEl = document.getElementById("owner-rev-count-approved");

      if (countAllEl) countAllEl.textContent = totalCount;
      if (countPendEl) countPendEl.textContent = pendingCount;
      if (countApprEl) countApprEl.textContent = approvedCount;

      const tabBadge = document.getElementById("owner-tab-pending-count");
      if (tabBadge) {
        tabBadge.textContent = `${pendingCount} Pending`;
        if (pendingCount > 0) {
          tabBadge.classList.add("amber");
        } else {
          tabBadge.classList.remove("amber");
        }
      }

      // Filter reviews
      let displayList = allAdminReviews.length > 0 ? allAdminReviews : customerReviews;
      if (ownerRevCurrentFilter === "pending") {
        displayList = displayList.filter(r => (r.status || "pending").toLowerCase() === "pending");
      } else if (ownerRevCurrentFilter === "approved") {
        displayList = displayList.filter(r => {
          const s = (r.status || "approved").toLowerCase();
          return s === "approved" || s === "published";
        });
      }

      if (displayList.length === 0) {
        ownerReviewsTbody.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; padding: 2.5rem; color: #94a3b8;">
              ${ownerRevCurrentFilter === 'pending'
                ? 'No pending reviews awaiting moderation.'
                : 'No reviews found in Supabase database.'}
            </td>
          </tr>
        `;
        return;
      }

      ownerReviewsTbody.innerHTML = displayList.map((rev) => {
        const rawStatus = String(rev.status || "pending").toLowerCase();
        const isApproved = rawStatus === "approved" || rawStatus === "published";
        const ratingNum = Math.max(1, Math.min(5, Number(rev.rating) || 5));
        const stars = "★".repeat(ratingNum) + "☆".repeat(5 - ratingNum);

        let dateStr = "Recent";
        const rawDate = rev.createdAt || rev.created_at;
        if (rawDate) {
          const d = new Date(rawDate);
          if (!isNaN(d.getTime())) {
            dateStr = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
          }
        }

        const vehicleStr = rev.authorCar || rev.author_car || rev.vehicle_name || "Certified Vehicle";
        const yearStr = rev.purchaseYear || rev.purchase_year ? ` (${rev.purchaseYear || rev.purchase_year})` : "";

        return `
          <tr id="owner-rev-row-${escapeHtml(String(rev.id || ''))}">
            <td>
              <div style="font-weight: 700; color: #fff;">${escapeHtml(rev.authorName || rev.author_name || "Customer")}</div>
              <div style="font-size: 0.75rem; color: #64748b;">${escapeHtml(dateStr)}</div>
            </td>
            <td>
              <span style="font-size: 0.8125rem; color: #cbd5e1;">${escapeHtml(vehicleStr)}${escapeHtml(yearStr)}</span>
            </td>
            <td>
              <span style="color: #f59e0b; font-size: 0.9375rem;" title="${ratingNum} / 5 stars">${stars}</span>
            </td>
            <td style="max-width: 280px;">
              <div style="font-size: 0.8125rem; color: #94a3b8; line-height: 1.45; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
                "${escapeHtml(rev.quote || rev.reviewText || rev.review || "")}"
              </div>
            </td>
            <td style="text-align: right;">
              <div style="display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem;">
                <span class="review-status-pill ${isApproved ? 'status-approved' : 'status-pending'}" style="font-size: 0.75rem;">
                  ${isApproved ? '✓ Approved' : '⏱ Pending'}
                </span>
                <button type="button"
                  class="btn btn-sm ${isApproved ? 'btn-secondary' : 'btn-primary'} btn-modal-toggle-status"
                  data-id="${escapeHtml(String(rev.id || ''))}"
                  data-current-status="${isApproved ? 'approved' : 'pending'}"
                  data-target-status="${isApproved ? 'pending' : 'approved'}"
                  title="${isApproved ? 'Move back to pending' : 'Approve and publish to public website'}">
                  ${isApproved ? 'Set to Pending' : 'Approve'}
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join("");

      // Bind toggle status buttons in modal table
      ownerReviewsTbody.querySelectorAll(".btn-modal-toggle-status").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const revId = btn.dataset.id;
          const target = btn.dataset.targetStatus;
          btn.disabled = true;
          btn.innerHTML = `<span class="spinner-inline" style="width: 12px; height: 12px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; display: inline-block;"></span>`;
          await toggleReviewStatus(revId, target);
        });
      });
    }

    // Tab switcher events
    if (ownerNavTabQueries && ownerNavTabReviews) {
      ownerNavTabQueries.addEventListener("click", () => {
        ownerNavTabQueries.classList.add("active");
        ownerNavTabReviews.classList.remove("active");
        if (ownerPaneQueries) ownerPaneQueries.style.display = "block";
        if (ownerPaneReviews) ownerPaneReviews.style.display = "none";
      });

      ownerNavTabReviews.addEventListener("click", async () => {
        ownerNavTabReviews.classList.add("active");
        ownerNavTabQueries.classList.remove("active");
        if (ownerPaneQueries) ownerPaneQueries.style.display = "none";
        if (ownerPaneReviews) ownerPaneReviews.style.display = "block";
        await fetchPendingReviews();
        renderOwnerReviewsTable();
      });
    }

    // Filter chip buttons for reviews tab
    [ownerRevFilterAll, ownerRevFilterPending, ownerRevFilterApproved].forEach((btn) => {
      if (btn) {
        btn.addEventListener("click", () => {
          [ownerRevFilterAll, ownerRevFilterPending, ownerRevFilterApproved].forEach(b => b?.classList.remove("active"));
          btn.classList.add("active");
          if (btn === ownerRevFilterPending) ownerRevCurrentFilter = "pending";
          else if (btn === ownerRevFilterApproved) ownerRevCurrentFilter = "approved";
          else ownerRevCurrentFilter = "all";
          renderOwnerReviewsTable();
        });
      }
    });

    // Logout / Lock Button
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        const token = getStoredToken();
        try {
          await fetch("/api/auth/logout", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` }
          });
        } catch (_) {}
        setStoredToken("");
        showGateView();
        showToast("Booking queries locked. Owner session terminated.", "info");
      });
    }
  }

  // =========================================================================
  // THEME TOGGLE: Dark Mode / Light Mode with Persistent localStorage
  // =========================================================================
  function initThemeToggle() {
    const themeBtn = document.getElementById("theme-toggle-btn");
    const themeText = themeBtn ? themeBtn.querySelector(".theme-toggle-text") : null;
    const STORAGE_KEY = "ekta_theme";

    // Read stored preference or system preference
    let isDarkMode = false;
    const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("theme");

    if (stored === "dark") {
      isDarkMode = true;
    } else if (stored === "light") {
      isDarkMode = false;
    } else {
      // Default fallback: check if documentElement has dark-mode, or system preference
      isDarkMode = document.documentElement.classList.contains("dark-mode") ||
                   (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    }

    // Apply on startup
    applyTheme(isDarkMode, false);

    if (themeBtn) {
      themeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        // Toggle 'dark-mode' on document body
        const willBeDark = !document.body.classList.contains("dark-mode");
        applyTheme(willBeDark, true);
      });
    }

    function applyTheme(dark, save = true) {
      if (dark) {
        document.body.classList.add("dark-mode");
        document.documentElement.classList.add("dark-mode");
        if (themeBtn) {
          themeBtn.classList.add("is-dark");
          themeBtn.setAttribute("aria-pressed", "true");
          themeBtn.setAttribute("title", "Switch to Light Theme");
        }
        if (themeText) {
          themeText.textContent = "Dark";
        }
        if (save) {
          try {
            localStorage.setItem(STORAGE_KEY, "dark");
            localStorage.setItem("theme", "dark");
          } catch (_) {}
        }
      } else {
        document.body.classList.remove("dark-mode");
        document.documentElement.classList.remove("dark-mode");
        if (themeBtn) {
          themeBtn.classList.remove("is-dark");
          themeBtn.setAttribute("aria-pressed", "false");
          themeBtn.setAttribute("title", "Switch to Dark Theme");
        }
        if (themeText) {
          themeText.textContent = "Light";
        }
        if (save) {
          try {
            localStorage.setItem(STORAGE_KEY, "light");
            localStorage.setItem("theme", "light");
          } catch (_) {}
        }
      }
    }
  }

  // Scroll-reveal animation for About section paragraphs
  function initAboutScrollAnimation() {
    const paragraphs = document.querySelectorAll("#about .about-text p");
    if (!paragraphs.length) return;

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries, obs) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              obs.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
      );

      paragraphs.forEach((p) => observer.observe(p));
    } else {
      paragraphs.forEach((p) => p.classList.add("is-visible"));
    }
  }

  // Hidden Admin Access Trigger on © symbol (5 rapid clicks within 2s)
  function initHiddenAdminTrigger() {
    const trigger = document.getElementById("footer-admin-trigger");
    if (!trigger) return;

    let clickCount = 0;
    let clickTimer = null;

    trigger.addEventListener("click", () => {
      clickCount++;

      if (clickTimer) {
        clearTimeout(clickTimer);
      }

      if (clickCount >= 5) {
        clickCount = 0;
        clickTimer = null;
        window.location.href = "/admin/login";
        return;
      }

      clickTimer = setTimeout(() => {
        clickCount = 0;
        clickTimer = null;
      }, 2000);
    });
  }

  // Initial Run
  initThemeToggle();
  populateVehicleSelect();
  renderInventory();
  initInventoryScroll();
  initTestimonials();
  initLoanCalculator();
  initContactForm();
  initCustomerReviewModal();
  initOwnerBookingQueries();
  initAboutScrollAnimation();
  initHiddenAdminTrigger();
  syncLiveFleetFromBackend();
  window.addEventListener("focus", syncLiveFleetFromBackend);

  // Cross-tab and admin update synchronization
  try {
    const fleetSyncChannel = new BroadcastChannel("ekta_fleet_sync");
    fleetSyncChannel.onmessage = () => {
      syncLiveFleetFromBackend();
    };
  } catch (_) {}

  window.addEventListener("storage", (e) => {
    if (e.key === "ekta_fleet_sync") {
      syncLiveFleetFromBackend();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      syncLiveFleetFromBackend();
    }
  });
});
