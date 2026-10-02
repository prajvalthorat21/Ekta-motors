// Dealership Administration Dashboard Controller for EKTA MOTORS
(function () {
  "use strict";

  let authToken = localStorage.getItem("ekta_admin_token") || "";
  let currentAdminUser = null;
  let allCars = [];
  let allInquiries = [];
  let allReviews = [];
  let currentReviewFilter = "all";
  let currentReviewSearch = "";
  let reviewsToolbarInitialized = false;
  let carToDeleteId = null;

  // Leads & Workbench State
  let currentLeadTypeFilter = "all";
  let currentLeadStatusFilter = "all";
  let currentLeadDateFilter = "all";
  let currentLeadSortOrder = "newest";
  let currentLeadSearch = "";
  let currentLeadPage = 1;
  const leadsPerPage = 25;
  let inqToDeleteId = null;
  let revToDeleteId = null;

  // Supabase Storage Photo Upload State
  let addCarFiles = [];
  let editCarExistingImages = [];
  let editCarNewFiles = [];
  let editCarRemovedImages = [];

  // Proactively ensure required AI Studio / proxy security cookies are present and renewed
  function refreshSecurityCookies() {
    try {
      const hostname = window.location.hostname || "";
      const domainPart = hostname ? `; Domain=${hostname}` : "";
      document.cookie = `__SECURE-aistudio_auth_flow_may_set_cookies=true; Path=/; Secure; SameSite=None${domainPart}; Partitioned; Max-Age=86400;`;
      document.cookie = `__SECURE-aistudio_auth_flow_may_set_cookies=true; Path=/; Secure; SameSite=None; Partitioned; Max-Age=86400;`;
    } catch (_) {}
  }

  // Refresh immediately on script evaluation
  refreshSecurityCookies();

  // Background keepalive every 20 seconds to guarantee uninterrupted sessions in preview iframe
  setInterval(() => {
    refreshSecurityCookies();
    fetch("/api/health", { credentials: "include", cache: "no-store" }).catch(() => {});
  }, 20000);

  // Safely parse JSON from a response, handling non-JSON/HTML/error responses gracefully
  async function safeParseJson(res) {
    if (!res) return {};
    const contentType = (res.headers && res.headers.get("content-type")) || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      const trimmed = (text || "").trim();

      // Specifically handle Cloud Run / proxy cookie check redirection
      if ((res.url && res.url.includes("__cookie_check.html")) || (res.redirected && trimmed.includes("cookie_check"))) {
        throw new Error("Action required: Browser preview blocked security cookies in the iframe. Please open the Admin Dashboard in a new window/tab to grant cookie access, or try publishing again.");
      }

      if (trimmed.startsWith("<") || res.redirected) {
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem("ekta_admin_token");
          localStorage.removeItem("ekta_admin_session");
          localStorage.removeItem("ekta_admin_user");
          document.cookie = "ekta_admin_token=; Path=/; Max-Age=0; SameSite=Lax";
          document.cookie = "ekta_admin_token_sec=; Path=/; Max-Age=0; SameSite=None; Secure";
          window.location.replace("/admin/login");
          throw new Error("Admin session expired. Please log in again.");
        }
        console.error("[safeParseJson] Unexpected non-JSON response:", {
          status: res.status,
          statusText: res.statusText,
          url: res.url,
          bodySnippet: trimmed.slice(0, 300)
        });
        throw new Error(`Server returned an unexpected response (${res.status} ${res.statusText || 'Error'}). Please try again.`);
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(trimmed ? `Server response error: ${trimmed.slice(0, 120)}` : `Server returned empty response (${res.status})`);
      }
    }
    return await res.json();
  }

  // Helper for authenticated fetch with credentials and proxy cookie recovery
  async function apiFetch(url, options = {}, retryCount = 0) {
    refreshSecurityCookies();
    const headers = options.headers ? { ...options.headers } : {};
    const token = localStorage.getItem("ekta_admin_token") || authToken;
    if (token && !headers["Authorization"]) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    options.headers = headers;
    options.credentials = options.credentials || "include";

    let res;
    try {
      res = await fetch(url, options);
    } catch (fetchErr) {
      console.error("[apiFetch Network Error]:", fetchErr);
      throw fetchErr;
    }

    if (res.status === 401) {
      localStorage.removeItem("ekta_admin_token");
      localStorage.removeItem("ekta_admin_session");
      localStorage.removeItem("ekta_admin_user");
      document.cookie = "ekta_admin_token=; Path=/; Max-Age=0; SameSite=Lax";
      document.cookie = "ekta_admin_token_sec=; Path=/; Max-Age=0; SameSite=None; Secure";
      window.location.replace("/admin/login");
      throw new Error("Admin session expired. Please log in again.");
    }

    // Check if intercepted by Cloud Run __cookie_check.html
    const isCookieCheck = (res.url && res.url.includes("__cookie_check.html")) || 
      (res.redirected && (res.headers.get("content-type") || "").includes("text/html"));

    if (isCookieCheck && retryCount < 2) {
      console.warn(`[apiFetch] Proxy cookie check detected (${res.url}). Refreshing security cookies and retrying (attempt ${retryCount + 1})...`);
      refreshSecurityCookies();
      // Ping health to trigger server-side Set-Cookie
      await fetch("/api/health", { credentials: "include", cache: "no-store" }).catch(() => {});
      // Wait briefly before retrying
      await new Promise(r => setTimeout(r, 400));
      return await apiFetch(url, options, retryCount + 1);
    }

    return res;
  }

  // Toast Notification Helper
  function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <span>${message}</span>
      </div>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function formatINR(val) {
    if (isNaN(val)) return "₹0";
    return "₹" + Number(val).toLocaleString("en-IN");
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 KB';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function validateImageFile(file) {
    const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    const validExts = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();

    if (!validMimes.includes((file.type || '').toLowerCase()) && !validExts.includes(ext)) {
      showToast(`Invalid file type "${file.name}". Only JPG, PNG, and WebP images are allowed.`, "danger");
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast(`File "${file.name}" exceeds the 10MB size limit (${formatFileSize(file.size)}).`, "danger");
      return false;
    }
    return true;
  }

  // Client-side image optimization for lightning-fast, dependable Supabase uploads
  async function compressImageIfLarge(file, maxDimension = 2048, quality = 0.88) {
    if (!file || !file.type || !file.type.startsWith("image/") || file.size <= 1.2 * 1024 * 1024) {
      return file;
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(file);

          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (blob && blob.size < file.size) {
              const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
                type: "image/jpeg",
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          }, "image/jpeg", quality);
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  }

  // Authentication Check
  async function checkAuth() {
    const token = localStorage.getItem("ekta_admin_token");
    if (!token) {
      window.location.replace("/admin/login");
      return;
    }
    try {
      const res = await apiFetch("/api/auth/me");
      const data = await safeParseJson(res);
      if (!data || !data.authenticated) {
        localStorage.removeItem("ekta_admin_token");
        localStorage.removeItem("ekta_admin_session");
        localStorage.removeItem("ekta_admin_user");
        document.cookie = "ekta_admin_token=; Path=/; Max-Age=0; SameSite=Lax";
        document.cookie = "ekta_admin_token_sec=; Path=/; Max-Age=0; SameSite=None; Secure";
        window.location.replace("/admin/login");
        return;
      }
      currentAdminUser = data.user;
      const userDisplay = document.getElementById("admin-user-display");
      if (userDisplay && data.user) {
        userDisplay.textContent = data.user.username || data.user.email || "ektamotors";
      }
      const shield = document.getElementById("auth-shield");
      if (shield) shield.remove();
      document.body.style.visibility = "visible";
      document.body.style.opacity = "1";
    } catch (err) {
      localStorage.removeItem("ekta_admin_token");
      localStorage.removeItem("ekta_admin_session");
      localStorage.removeItem("ekta_admin_user");
      document.cookie = "ekta_admin_token=; Path=/; Max-Age=0; SameSite=Lax";
      document.cookie = "ekta_admin_token_sec=; Path=/; Max-Age=0; SameSite=None; Secure";
      window.location.replace("/admin/login");
    }
  }

  // Tab Navigation Handling
  function initNavigation() {
    const tabBtns = document.querySelectorAll(".admin-tab-btn");
    const panels = document.querySelectorAll(".admin-view-panel");

    function switchTab(viewId) {
      tabBtns.forEach(btn => {
        btn.classList.toggle("active", btn.dataset.view === viewId);
      });
      panels.forEach(p => {
        p.classList.toggle("active", p.id === `view-${viewId}`);
      });
      window.location.hash = viewId;
    }

    tabBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        switchTab(btn.dataset.view);
      });
    });

    const quickAddBtn = document.getElementById("btn-quick-add-car");
    if (quickAddBtn) {
      quickAddBtn.addEventListener("click", () => switchTab("add-car"));
    }

    const navToAddCar = document.getElementById("btn-nav-to-add-car");
    if (navToAddCar) {
      navToAddCar.addEventListener("click", () => switchTab("add-car"));
    }

    const viewAllInqBtn = document.getElementById("btn-view-all-inquiries");
    if (viewAllInqBtn) {
      viewAllInqBtn.addEventListener("click", () => switchTab("bookings"));
    }

    // Hash check on load
    if (window.location.hash) {
      const hashView = window.location.hash.replace("#", "");
      if (document.getElementById(`view-${hashView}`)) {
        switchTab(hashView);
      }
    }
  }

  function notifyFleetUpdated() {
    try {
      localStorage.setItem("ekta_fleet_sync", Date.now().toString());
    } catch (_) {}
    try {
      const bc = new BroadcastChannel("ekta_fleet_sync");
      bc.postMessage({ type: "fleet_updated", timestamp: Date.now() });
      bc.close();
    } catch (_) {}
  }

  // Fetch Data from Server
  async function loadAllData() {
    try {
      const [carsRes, inqRes, revRes] = await Promise.all([
        apiFetch("/api/admin/cars"),
        apiFetch("/api/admin/inquiries"),
        apiFetch("/api/admin/reviews")
      ]);

      const carsData = await safeParseJson(carsRes);
      if (carsRes.ok && carsData && carsData.success) {
        allCars = carsData.cars || [];
      } else {
        allCars = [];
        if (carsData && carsData.error) {
          console.error("[Admin Supabase Error]:", carsData.error);
          showToast(`Database error loading fleet: ${carsData.error}`, "danger");
        }
      }

      const inqData = await safeParseJson(inqRes);
      allInquiries = inqData.inquiries || [];

      const revData = await safeParseJson(revRes);
      allReviews = revData.reviews || [];

      updateOverviewStats();
      renderManageCars();
      renderBookings();
      renderReviews();
      checkStorageStatus();
    } catch (err) {
      console.error("Failed to load admin data", err);
    }
  }

  async function checkStorageStatus() {
    try {
      const res = await apiFetch("/api/admin/storage/status");
      const data = await safeParseJson(res);
      const badge = document.getElementById("storage-status-badge");
      if (badge && data && data.status) {
        if (data.status.exists) {
          badge.className = "badge-pill badge-available";
          badge.innerHTML = `<span style="width: 7px; height: 7px; border-radius: 50%; background: #34d399; display: inline-block;"></span> Supabase Storage: Active (vehicle-images)`;
        } else {
          badge.className = "badge-pill badge-reserved";
          badge.innerHTML = `<span style="width: 7px; height: 7px; border-radius: 50%; background: #fbbf24; display: inline-block;"></span> Supabase Storage: Setting up...`;
        }
      }
    } catch (e) {
      // Non-critical badge update
    }
  }

  // Update Overview Metrics
  function updateOverviewStats() {
    const statCars = document.getElementById("stat-total-cars");
    const statSubCars = document.getElementById("stat-sub-cars");
    const statVal = document.getElementById("stat-inventory-val");
    const statInq = document.getElementById("stat-total-inquiries");
    const statNewInq = document.getElementById("stat-new-inquiries");
    const statRev = document.getElementById("stat-total-reviews");
    const statAppRev = document.getElementById("stat-approved-reviews");
    const tabNewCount = document.getElementById("tab-new-queries-count");

    // Total Fleet: ALL vehicles currently in database inventory
    if (statCars) statCars.textContent = allCars.length;

    // Filter strictly vehicles available for purchase (exclude Sold, Reserved, Unavailable, Archived)
    const availableCars = allCars.filter(c => {
      const status = (c.availability || "Available").toString().trim().toLowerCase();
      return status === "available";
    });
    const availableCount = availableCars.length;
    if (statSubCars) statSubCars.textContent = `${availableCount} Available for Purchase`;

    // Dynamic Inventory Valuation: SUM of the selling price of ALL currently available vehicles
    const totalVal = availableCars.reduce((acc, c) => {
      let rawPrice = c.price;
      if (typeof rawPrice === "string") {
        rawPrice = Number(rawPrice.replace(/[^0-9.-]+/g, ""));
      }
      const num = Number(rawPrice);
      return acc + (isNaN(num) ? 0 : num);
    }, 0);

    // Display with proper Indian currency formatting (e.g. ₹29,00,000)
    if (statVal) statVal.textContent = formatINR(totalVal);

    if (statInq) statInq.textContent = allInquiries.length;
    const newCount = allInquiries.filter(i => (i.status || "New").toLowerCase() === "new").length;
    if (statNewInq) statNewInq.textContent = `${newCount} New inquiries pending action`;

    if (tabNewCount) {
      if (newCount > 0) {
        tabNewCount.textContent = newCount;
        tabNewCount.style.display = "inline-block";
      } else {
        tabNewCount.style.display = "none";
      }
    }

    if (statRev) statRev.textContent = allReviews.length;
    const approvedCount = allReviews.filter(r => {
      const s = String(r.status || "approved").toLowerCase();
      return s === "approved" || s === "published";
    }).length;
    const pendingCount = allReviews.filter(r => {
      const s = String(r.status || "pending").toLowerCase();
      return s === "pending";
    }).length;

    if (statAppRev) statAppRev.textContent = `${approvedCount} Verified & Published`;

    const tabPendingBadge = document.getElementById("tab-pending-reviews-count");
    if (tabPendingBadge) {
      if (pendingCount > 0) {
        tabPendingBadge.textContent = pendingCount;
        tabPendingBadge.style.display = "inline-block";
      } else {
        tabPendingBadge.style.display = "none";
      }
    }

    // Overview Recent Inquiries Table
    const recentTbody = document.getElementById("overview-recent-inquiries-tbody");
    if (recentTbody) {
      recentTbody.innerHTML = "";
      const recents = allInquiries.slice(0, 5);
      if (recents.length === 0) {
        recentTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--admin-text-muted); padding: 2rem;">No customer inquiries recorded yet.</td></tr>`;
      } else {
        recents.forEach(inq => {
          const tr = document.createElement("tr");
          const statusClass = `badge-${(inq.status || "new").toLowerCase()}`;
          const dateStr = inq.createdAt ? new Date(inq.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric" }) : "Today";
          tr.innerHTML = `
            <td><strong style="color: #60a5fa;">${inq.ref || "#BK"}</strong></td>
            <td>
              <div style="font-weight: 700; color: #fff;">${escapeHtml(inq.name || inq.clientName || "Customer")}</div>
              <div style="font-size: 0.75rem; color: var(--admin-text-secondary);">${escapeHtml(inq.phone || inq.clientPhone || "")}</div>
            </td>
            <td>${escapeHtml(inq.vehicleName || inq.vehicle || "General Inquiry")}</td>
            <td><span style="font-size: 0.8125rem;">${escapeHtml(inq.service || inq.serviceType || "Test Drive")}</span></td>
            <td><span class="badge-pill ${statusClass}">${inq.status || "New"}</span></td>
            <td><span style="font-size: 0.8125rem; color: var(--admin-text-muted);">${dateStr}</span></td>
            <td style="text-align: right;">
              <button type="button" class="btn-action-icon view-inq-btn" data-id="${inq.id}" title="View Details">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
            </td>
          `;
          recentTbody.appendChild(tr);
        });
      }
    }
  }

  // =========================================================================
  // CARS FLEET MANAGEMENT (CRUD)
  // =========================================================================
  function renderManageCars() {
    const tbody = document.getElementById("manage-cars-tbody");
    if (!tbody) return;

    const searchTerm = (document.getElementById("cars-search-input")?.value || "").toLowerCase().trim();
    const filterFuel = document.getElementById("cars-filter-fuel")?.value || "all";
    const filterStatus = document.getElementById("cars-filter-status")?.value || "all";
    const sortBy = document.getElementById("cars-sort-select")?.value || "price-desc";

    let list = [...allCars];

    // Search filter
    if (searchTerm) {
      list = list.filter(c => {
        const full = `${c.brand || ""} ${c.model || ""} ${c.name || ""} ${c.variant || ""} ${c.registration || ""}`.toLowerCase();
        return full.includes(searchTerm);
      });
    }

    // Fuel filter
    if (filterFuel !== "all") {
      list = list.filter(c => (c.fuelType || c.fuel || "").toLowerCase() === filterFuel.toLowerCase());
    }

    // Status filter
    if (filterStatus !== "all") {
      list = list.filter(c => (c.availability || "Available").toLowerCase() === filterStatus.toLowerCase());
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === "price-desc") return Number(b.price || 0) - Number(a.price || 0);
      if (sortBy === "price-asc") return Number(a.price || 0) - Number(b.price || 0);
      if (sortBy === "year-desc") return Number(b.year || 0) - Number(a.year || 0);
      return 0;
    });

    tbody.innerHTML = "";
    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 3rem; color: var(--admin-text-muted);">
            No vehicles match your current search and filter criteria.
          </td>
        </tr>
      `;
      return;
    }

    const PHOTO_UNAVAILABLE_DATA_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='500' viewBox='0 0 800 500' fill='none'%3E%3Crect width='800' height='500' fill='%231e293b'/%3E%3Cpath d='M360 210C360 198.954 368.954 190 380 190H420C431.046 190 440 198.954 440 210V230H360V210Z' fill='%23475569'/%3E%3Crect x='340' y='230' width='120' height='80' rx='10' fill='%23334155' stroke='%23475569' stroke-width='4'/%3E%3Ccircle cx='400' cy='270' r='20' stroke='%2364748b' stroke-width='4' fill='%231e293b'/%3E%3Ctext x='400' y='350' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='16' font-weight='500'%3EPhoto Unavailable%3C/text%3E%3C/svg%3E";

    list.forEach(car => {
      const tr = document.createElement("tr");
      const thumb = (car.images && car.images[0]) || car.image || PHOTO_UNAVAILABLE_DATA_URI;
      const status = car.availability || "Available";
      const badgeClass = `badge-${status.toLowerCase()}`;
      const carTitle = car.name || [car.brand, car.model].filter(Boolean).join(" ") || "Vehicle";

      tr.innerHTML = `
        <td>
          <div class="car-cell">
            <img src="${thumb}" alt="${escapeHtml(carTitle)}" class="car-thumb" loading="lazy" onerror="this.onerror=null; this.src='${PHOTO_UNAVAILABLE_DATA_URI}';" />
            <div>
              <div class="car-cell-title">${escapeHtml(carTitle)}</div>
              <div class="car-cell-sub">${car.year || 2024} · ${escapeHtml(car.variant || car.bodyType || "Edition")} · ${escapeHtml(car.registration || "Unregistered")}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 600; color: #fff;">${escapeHtml(car.fuelType || car.fuel || "Electric")}</div>
          <div style="font-size: 0.75rem; color: var(--admin-text-muted);">${escapeHtml(car.transmission || "Automatic")}</div>
        </td>
        <td>
          <span style="font-size: 0.875rem;">${escapeHtml(car.kmDriven || "0 km")}</span>
        </td>
        <td>
          <strong style="color: #60a5fa; font-size: 0.9375rem;">${formatINR(car.price)}</strong>
        </td>
        <td>
          <span class="badge-pill ${badgeClass}">${status}</span>
        </td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 0.4rem; justify-content: flex-end;">
            <button type="button" class="btn-action-icon view-car-btn" data-id="${car.id}" title="View Full Vehicle Details">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
            <button type="button" class="btn-action-icon edit-car-btn" data-id="${car.id}" title="Edit Vehicle Specifications">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button type="button" class="btn-action-icon danger delete-car-btn" data-id="${car.id}" title="Remove Vehicle from Fleet">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // =========================================================================
  // ADD CAR FORM HANDLER & DIRECT SUPABASE STORAGE MULTI-PHOTO UPLOAD
  // =========================================================================
  function initAddCarForm() {
    const form = document.getElementById("form-add-car");
    if (!form) return;

    const dropzone = document.getElementById("add-photo-dropzone");
    const fileInput = document.getElementById("add-photo-file-input");
    const previewContainer = document.getElementById("add-photo-preview-container");
    const previewGrid = document.getElementById("add-photo-grid");
    const counterText = document.getElementById("add-photo-counter");
    const clearAllBtn = document.getElementById("btn-clear-all-add-photos");
    const progressContainer = document.getElementById("add-photo-upload-progress");
    const progressFill = document.getElementById("upload-progress-fill");
    const progressPct = document.getElementById("upload-progress-pct");
    const progressText = document.getElementById("upload-progress-text");

    // Click anywhere on dropzone to trigger native file browser
    dropzone?.addEventListener("click", () => {
      fileInput?.click();
    });

    // Drag and Drop interaction
    ["dragenter", "dragover"].forEach(evt => {
      dropzone?.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add("drag-over");
      });
    });

    ["dragleave", "dragend"].forEach(evt => {
      dropzone?.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove("drag-over");
      });
    });

    dropzone?.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("drag-over");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleIncomingFiles(Array.from(e.dataTransfer.files));
      }
    });

    fileInput?.addEventListener("change", () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleIncomingFiles(Array.from(fileInput.files));
        fileInput.value = "";
      }
    });

    function handleIncomingFiles(incomingFiles) {
      let added = 0;
      for (const f of incomingFiles) {
        if (validateImageFile(f)) {
          const exists = addCarFiles.some(
            existing => existing.name === f.name && existing.size === f.size
          );
          if (!exists) {
            addCarFiles.push(f);
            added++;
          }
        }
      }
      if (added > 0) {
        renderAddCarPreviews();
      }
    }

    function renderAddCarPreviews() {
      if (!previewContainer || !previewGrid) return;
      if (addCarFiles.length === 0) {
        previewContainer.style.display = "none";
        previewGrid.innerHTML = "";
        return;
      }

      previewContainer.style.display = "block";
      if (counterText) {
        counterText.textContent = `Selected Photos (${addCarFiles.length})`;
      }

      previewGrid.innerHTML = "";
      addCarFiles.forEach((file, index) => {
        const card = document.createElement("div");
        card.className = "photo-preview-card";

        const img = document.createElement("img");
        const objectUrl = URL.createObjectURL(file);
        img.src = objectUrl;
        img.alt = file.name;
        card.appendChild(img);

        if (index === 0) {
          const badge = document.createElement("div");
          badge.className = "photo-preview-badge";
          badge.textContent = "COVER PHOTO";
          card.appendChild(badge);
        }

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "photo-preview-remove";
        removeBtn.setAttribute("aria-label", "Remove photo");
        removeBtn.innerHTML = "&times;";
        removeBtn.title = "Remove this photo";
        removeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          URL.revokeObjectURL(objectUrl);
          addCarFiles.splice(index, 1);
          renderAddCarPreviews();
        });
        card.appendChild(removeBtn);

        const meta = document.createElement("div");
        meta.className = "photo-preview-meta";
        meta.innerHTML = `<span class="photo-preview-size">${formatFileSize(file.size)}</span>`;
        card.appendChild(meta);

        previewGrid.appendChild(card);
      });
    }

    clearAllBtn?.addEventListener("click", () => {
      addCarFiles = [];
      renderAddCarPreviews();
    });

    form.addEventListener("reset", () => {
      addCarFiles = [];
      renderAddCarPreviews();
      if (progressContainer) progressContainer.style.display = "none";
    });

    let isPublishingVehicle = false;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (isPublishingVehicle) {
        console.warn("Vehicle publishing already in progress. Ignoring duplicate click.");
        return;
      }

      const submitBtn = document.getElementById("btn-submit-add-car");

      const brand = document.getElementById("add-brand").value.trim();
      const model = document.getElementById("add-model").value.trim();
      const variant = document.getElementById("add-variant").value.trim();
      const price = Number(document.getElementById("add-price").value) || 0;

      if (!brand || !model || !price) {
        showToast("Please fill in the Brand Name (Manufacturer), Model, and Price.", "warning");
        return;
      }

      // Explicit user requirement: must upload real photos, no fallback URLs
      if (addCarFiles.length === 0) {
        showToast("Please upload at least one vehicle photo before publishing.", "warning");
        return;
      }

      isPublishingVehicle = true;
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <span style="display: inline-flex; align-items: center; gap: 8px;">
          <svg class="spin-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation: spin 0.8s linear infinite;">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" stroke-dasharray="32" stroke-linecap="round" opacity="0.3"></circle>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path>
          </svg>
          <span>Publishing to Showroom...</span>
        </span>
      `;

      if (progressContainer) {
        progressContainer.style.display = "block";
        if (progressFill) progressFill.style.width = "25%";
        if (progressPct) progressPct.textContent = "25%";
        if (progressText) progressText.textContent = `Uploading ${addCarFiles.length} photo(s) directly to Supabase Storage...`;
      }

      const vehicleSlug = `${brand.toLowerCase()}-${model.toLowerCase()}`.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vehicle';
      const vehicleId = `${vehicleSlug}-${Date.now().toString(36)}`;

      try {
        // Build multipart FormData with all real photos and all vehicle fields
        const formData = new FormData();
        formData.append("vehicleId", vehicleId);
        formData.append("id", vehicleId);

        // Compress any large images client-side before sending to guarantee fast, reliable upload
        if (progressText) progressText.textContent = `Optimizing ${addCarFiles.length} photo(s) for upload...`;
        const optimizedFiles = await Promise.all(addCarFiles.map(file => compressImageIfLarge(file)));

        // Append optimized image files
        optimizedFiles.forEach(file => {
          formData.append("photos", file);
        });

        // Vehicle specifications & details
        const year = Number(document.getElementById("add-year").value) || 2024;
        const bodyType = document.getElementById("add-body-type").value;
        const category = document.getElementById("add-category").value;
        const kmDriven = document.getElementById("add-km").value.trim() || "0 km";
        const mileage = document.getElementById("add-mileage").value.trim();
        const color = document.getElementById("add-color").value.trim();
        const registration = document.getElementById("add-registration").value.trim();
        const availability = document.getElementById("add-availability").value;
        const fuelType = document.getElementById("add-fuel").value;
        const transmission = document.getElementById("add-transmission").value;
        const engine = document.getElementById("add-engine").value.trim();
        const power = document.getElementById("add-power").value.trim();
        const drivetrain = document.getElementById("add-drivetrain").value.trim();
        const seating = document.getElementById("add-seating").value.trim();
        const description = document.getElementById("add-description").value.trim();
        const rawHighlights = document.getElementById("add-highlights").value.trim();

        formData.append("brand", brand);
        formData.append("model", model);
        formData.append("variant", variant);
        formData.append("year", String(year));
        formData.append("price", String(price));
        formData.append("bodyType", bodyType);
        formData.append("category", category);
        formData.append("kmDriven", kmDriven);
        formData.append("mileage", mileage);
        formData.append("color", color);
        formData.append("registration", registration);
        formData.append("availability", availability);
        formData.append("fuelType", fuelType);
        formData.append("transmission", transmission);
        formData.append("engine", engine);
        formData.append("power", power);
        formData.append("drivetrain", drivetrain);
        formData.append("seating", seating);
        formData.append("description", description);
        formData.append("highlights", rawHighlights);

        if (progressFill) progressFill.style.width = "50%";
        if (progressPct) progressPct.textContent = "50%";
        if (progressText) progressText.textContent = `Storing images in vehicle-images bucket & creating showroom record...`;

        // Send to unified publish endpoint
        const res = await apiFetch("/api/admin/cars/publish", {
          method: "POST",
          body: formData
        });

        const data = await safeParseJson(res);

        if (res.ok && data.success) {
          if (progressFill) progressFill.style.width = "100%";
          if (progressPct) progressPct.textContent = "100%";
          if (progressText) progressText.textContent = `Published successfully!`;

          const photoCount = (data.urls && data.urls.length) || addCarFiles.length;
          showToast(`Vehicle "${data.vehicle?.name || model}" published with ${photoCount} permanent Supabase Storage photo(s)!`, "success");

          form.reset();
          addCarFiles = [];
          renderAddCarPreviews();
          await loadAllData();
          notifyFleetUpdated();

          // Switch to Manage Cars view so admin immediately sees new vehicle
          const manageTab = document.querySelector('[data-view="manage-cars"]');
          if (manageTab) manageTab.click();
        } else {
          console.error("Publishing error response:", data);
          showToast(data.error || "Failed to publish vehicle to showroom.", "danger");
        }
      } catch (err) {
        console.error("Error publishing vehicle:", err);
        showToast(err.message || "Failed to publish vehicle to showroom.", "danger");
      } finally {
        isPublishingVehicle = false;
        submitBtn.disabled = false;
        submitBtn.textContent = "Publish Vehicle to Showroom";
        if (progressContainer) {
          setTimeout(() => {
            progressContainer.style.display = "none";
            if (progressFill) progressFill.style.width = "0%";
          }, 1200);
        }
      }
    });
  }

  // =========================================================================
  // VIEW CAR DETAILS MODAL
  // =========================================================================
  function openCarDetailsModal(carId) {
    const car = allCars.find(c => String(c.id) === String(carId));
    if (!car) return;

    const modal = document.getElementById("modal-car-details");
    const titleEl = document.getElementById("modal-car-title");
    const subEl = document.getElementById("modal-car-sub");
    const bodyEl = document.getElementById("modal-car-body");

    titleEl.textContent = car.name || [car.brand, car.model].filter(Boolean).join(" ") || "Certified Vehicle";
    subEl.textContent = `${car.year || 2024} · ${car.variant || car.bodyType || "Edition"} · Ref #${car.id}`;

    const gallery = car.images && car.images.length > 0 ? car.images : [car.image || PHOTO_UNAVAILABLE_DATA_URI];

    bodyEl.innerHTML = `
      <div style="margin-bottom: 1.5rem;">
        <img src="${gallery[0]}" alt="${escapeHtml(car.name)}" style="width: 100%; max-height: 380px; object-fit: cover; border-radius: 12px; border: 1px solid var(--admin-border);" onerror="this.onerror=null; this.src='${PHOTO_UNAVAILABLE_DATA_URI}';" />
        ${gallery.length > 1 ? `
          <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem; overflow-x: auto; padding-bottom: 0.25rem;">
            ${gallery.map(img => `<img src="${img}" style="width: 80px; height: 55px; object-fit: cover; border-radius: 6px; border: 1px solid var(--admin-border);" />`).join("")}
          </div>
        ` : ""}
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; background: rgba(10, 15, 29, 0.6); padding: 1.25rem; border-radius: 12px; border: 1px solid var(--admin-border);">
        <div><span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Price:</span> <strong style="color: #60a5fa; display: block; font-size: 1.15rem;">${formatINR(car.price)}</strong></div>
        <div><span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Fuel:</span> <strong style="display: block; color: #fff;">${escapeHtml(car.fuelType || car.fuel || "Electric")}</strong></div>
        <div><span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Transmission:</span> <strong style="display: block; color: #fff;">${escapeHtml(car.transmission || "Automatic")}</strong></div>
        <div><span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Kilometers:</span> <strong style="display: block; color: #fff;">${escapeHtml(car.kmDriven || "0 km")}</strong></div>
        <div><span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Engine:</span> <strong style="display: block; color: #fff;">${escapeHtml(car.engine || "High-Output")}</strong></div>
        <div><span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Status:</span> <strong style="display: block; color: #34d399;">${escapeHtml(car.availability || "Available")}</strong></div>
        <div><span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Registration:</span> <strong style="display: block; color: #fff;">${escapeHtml(car.registration || "Unregistered")}</strong></div>
        <div><span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Color:</span> <strong style="display: block; color: #fff;">${escapeHtml(car.color || "Standard")}</strong></div>
      </div>

      <div style="margin-bottom: 1.25rem;">
        <h4 style="margin: 0 0 0.5rem; font-size: 0.9375rem; color: #ffffff;">Vehicle Overview:</h4>
        <p style="color: var(--admin-text-secondary); font-size: 0.875rem; line-height: 1.6;">${escapeHtml(car.description || "Certified pre-owned or brand new vehicle inspected rigorously by Ekta Motors master technicians.")}</p>
      </div>

      ${car.highlights && car.highlights.length > 0 ? `
        <div>
          <h4 style="margin: 0 0 0.5rem; font-size: 0.9375rem; color: #ffffff;">Key Features & Equipment:</h4>
          <ul style="margin: 0; padding-left: 1.25rem; color: var(--admin-text-secondary); font-size: 0.875rem; line-height: 1.7;">
            ${car.highlights.map(h => `<li>${escapeHtml(h)}</li>`).join("")}
          </ul>
        </div>
      ` : ""}
    `;

    modal.style.display = "flex";
  }

  // =========================================================================
  // EDIT CAR MODAL & PHOTO MANAGEMENT
  // =========================================================================
  function renderEditExistingPhotos() {
    const grid = document.getElementById("edit-existing-photos-grid");
    const countEl = document.getElementById("edit-existing-photos-count");
    if (!grid) return;

    if (countEl) {
      countEl.textContent = `Current Showcase Photos (${editCarExistingImages.length}):`;
    }

    grid.innerHTML = "";
    if (editCarExistingImages.length === 0) {
      grid.innerHTML = `<div style="font-size: 0.8125rem; color: #94a3b8; font-style: italic; padding: 0.5rem 0;">No existing photos. Please select photos below.</div>`;
      return;
    }

    editCarExistingImages.forEach((url, idx) => {
      const card = document.createElement("div");
      card.className = "photo-preview-card";

      const img = document.createElement("img");
      img.src = url;
      img.alt = "Vehicle photo " + (idx + 1);
      img.loading = "lazy";
      card.appendChild(img);

      if (idx === 0) {
        const badge = document.createElement("div");
        badge.className = "photo-preview-badge";
        badge.textContent = "COVER";
        card.appendChild(badge);
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "photo-preview-remove";
      removeBtn.innerHTML = "&times;";
      removeBtn.title = "Remove this photo";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const removed = editCarExistingImages.splice(idx, 1)[0];
        if (removed) {
          editCarRemovedImages.push(removed);
        }
        renderEditExistingPhotos();
      });
      card.appendChild(removeBtn);

      grid.appendChild(card);
    });
  }

  function renderEditNewPhotos() {
    const section = document.getElementById("edit-new-photos-section");
    const grid = document.getElementById("edit-new-photos-grid");
    const countEl = document.getElementById("edit-new-photos-count");
    if (!section || !grid) return;

    if (editCarNewFiles.length === 0) {
      section.style.display = "none";
      grid.innerHTML = "";
      return;
    }

    section.style.display = "block";
    if (countEl) {
      countEl.textContent = `New Photos to Upload on Save (${editCarNewFiles.length}):`;
    }

    grid.innerHTML = "";
    editCarNewFiles.forEach((file, idx) => {
      const card = document.createElement("div");
      card.className = "photo-preview-card";

      const img = document.createElement("img");
      const objUrl = URL.createObjectURL(file);
      img.src = objUrl;
      img.alt = file.name;
      card.appendChild(img);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "photo-preview-remove";
      removeBtn.innerHTML = "&times;";
      removeBtn.title = "Remove new photo";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        URL.revokeObjectURL(objUrl);
        editCarNewFiles.splice(idx, 1);
        renderEditNewPhotos();
      });
      card.appendChild(removeBtn);

      const meta = document.createElement("div");
      meta.className = "photo-preview-meta";
      meta.innerHTML = `<span class="photo-preview-size">${formatFileSize(file.size)}</span>`;
      card.appendChild(meta);

      grid.appendChild(card);
    });
  }

  function openEditCarModal(carId) {
    const car = allCars.find(c => String(c.id) === String(carId));
    if (!car) return;

    document.getElementById("edit-car-id").value = car.id;
    document.getElementById("edit-brand").value = car.brand || "";
    document.getElementById("edit-model").value = car.model || car.name || "";
    document.getElementById("edit-variant").value = car.variant || "";
    document.getElementById("edit-year").value = car.year || 2024;
    document.getElementById("edit-price").value = car.price || 0;
    document.getElementById("edit-km").value = car.kmDriven || "0 km";
    document.getElementById("edit-fuel").value = car.fuelType || car.fuel || "Electric";
    document.getElementById("edit-transmission").value = car.transmission || "Automatic";
    document.getElementById("edit-engine").value = car.engine || "";
    document.getElementById("edit-mileage").value = car.mileage || "";
    document.getElementById("edit-color").value = car.color || "";
    document.getElementById("edit-registration").value = car.registration || "";
    document.getElementById("edit-availability").value = car.availability || "Available";
    document.getElementById("edit-description").value = car.description || "";
    document.getElementById("edit-highlights").value = (car.highlights || []).join("\n");

    // Initialize existing photos
    editCarExistingImages = (car.images || [car.image || ""]).filter(Boolean);
    editCarNewFiles = [];
    editCarRemovedImages = [];

    renderEditExistingPhotos();
    renderEditNewPhotos();

    // Initialize 360 sequences status
    renderEdit360Section(car, "exterior");
    renderEdit360Section(car, "interior");

    document.getElementById("modal-edit-car").style.display = "flex";
  }

  function renderEdit360Section(car, type) {
    const isExt = type === "exterior";
    const statusEl = document.getElementById(isExt ? "edit-ext-360-status" : "edit-int-360-status");
    const clearBtn = document.getElementById(isExt ? "btn-clear-ext-360" : "btn-clear-int-360");
    const previewEl = document.getElementById(isExt ? "edit-ext-360-preview" : "edit-int-360-preview");
    const frames = (isExt ? car.exterior360 : car.interior360) || [];

    if (!statusEl) return;

    if (frames.length > 0) {
      statusEl.innerHTML = `${isExt ? 'Exterior' : 'Interior'} 360 Frames: <strong style="color: #34d399;">${frames.length} frames active</strong>`;
      if (clearBtn) clearBtn.style.display = "inline-block";
      if (previewEl) {
        previewEl.style.display = "grid";
        previewEl.innerHTML = frames.map((url, idx) => `
          <div class="photo-preview-card" style="position: relative;">
            <img src="${escapeHtml(url)}" alt="Frame ${idx + 1}" style="width: 100%; height: 60px; object-fit: cover; border-radius: 4px;" />
            <span style="position: absolute; bottom: 2px; right: 2px; background: rgba(0,0,0,0.8); color: #fff; font-size: 0.65rem; padding: 1px 4px; border-radius: 2px; font-weight: 700;">#${idx + 1}</span>
          </div>
        `).join("");
      }
    } else {
      statusEl.innerHTML = `${isExt ? 'Exterior' : 'Interior'} 360 Frames: <span style="color: #94a3b8;">None configured</span>`;
      if (clearBtn) clearBtn.style.display = "none";
      if (previewEl) {
        previewEl.style.display = "none";
        previewEl.innerHTML = "";
      }
    }
  }

  function initEditCarForm() {
    const form = document.getElementById("form-edit-car");
    if (!form) return;

    const dropzone = document.getElementById("edit-photo-dropzone");
    const fileInput = document.getElementById("edit-photo-file-input");
    const progressContainer = document.getElementById("edit-photo-upload-progress");
    const progressFill = document.getElementById("edit-upload-progress-fill");
    const progressPct = document.getElementById("edit-upload-progress-pct");
    const progressText = document.getElementById("edit-upload-progress-text");

    dropzone?.addEventListener("click", () => {
      fileInput?.click();
    });

    ["dragenter", "dragover"].forEach(evt => {
      dropzone?.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add("drag-over");
      });
    });

    ["dragleave", "dragend"].forEach(evt => {
      dropzone?.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove("drag-over");
      });
    });

    dropzone?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
      if (e.dataTransfer && e.dataTransfer.files) {
        for (const f of Array.from(e.dataTransfer.files)) {
          if (validateImageFile(f)) {
            const exists = editCarNewFiles.some(existing => existing.name === f.name && existing.size === f.size);
            if (!exists) editCarNewFiles.push(f);
          }
        }
        renderEditNewPhotos();
      }
    });

    fileInput?.addEventListener("change", () => {
      if (fileInput.files) {
        for (const f of Array.from(fileInput.files)) {
          if (validateImageFile(f)) {
            const exists = editCarNewFiles.some(existing => existing.name === f.name && existing.size === f.size);
            if (!exists) editCarNewFiles.push(f);
          }
        }
        renderEditNewPhotos();
        fileInput.value = "";
      }
    });

    // 360 Sequences Event Handlers
    const btnUploadExt = document.getElementById("btn-upload-ext-360");
    const inputExt = document.getElementById("edit-ext-360-file-input");
    const btnClearExt = document.getElementById("btn-clear-ext-360");

    btnUploadExt?.addEventListener("click", () => inputExt?.click());
    inputExt?.addEventListener("change", async () => {
      const carId = document.getElementById("edit-car-id").value;
      if (!inputExt.files || inputExt.files.length === 0) return;
      const files = Array.from(inputExt.files);
      inputExt.value = "";
      await handle360Upload(carId, "exterior", files);
    });

    btnClearExt?.addEventListener("click", async () => {
      const carId = document.getElementById("edit-car-id").value;
      if (confirm("Are you sure you want to clear and delete the Exterior 360 sequence for this vehicle?")) {
        await handle360Delete(carId, "exterior");
      }
    });

    const btnUploadInt = document.getElementById("btn-upload-int-360");
    const inputInt = document.getElementById("edit-int-360-file-input");
    const btnClearInt = document.getElementById("btn-clear-int-360");

    btnUploadInt?.addEventListener("click", () => inputInt?.click());
    inputInt?.addEventListener("change", async () => {
      const carId = document.getElementById("edit-car-id").value;
      if (!inputInt.files || inputInt.files.length === 0) return;
      const files = Array.from(inputInt.files);
      inputInt.value = "";
      await handle360Upload(carId, "interior", files);
    });

    btnClearInt?.addEventListener("click", async () => {
      const carId = document.getElementById("edit-car-id").value;
      if (confirm("Are you sure you want to clear and delete the Interior 360 sequence for this vehicle?")) {
        await handle360Delete(carId, "interior");
      }
    });

    async function handle360Upload(carId, type, files) {
      try {
        showToast(`Uploading ${files.length} ${type} 360 frames to Supabase Storage in deterministic numeric order...`, "info");
        const formData = new FormData();
        files.forEach(f => formData.append("frames", f));

        const res = await apiFetch(`/api/admin/cars/${carId}/360/${type}`, {
          method: "POST",
          body: formData
        });

        const data = await safeParseJson(res);
        if (res.ok && data.success) {
          showToast(`Successfully uploaded ${data.frames.length} ${type} 360 frames!`, "success");
          await loadAllData();
          const updatedCar = allCars.find(c => String(c.id) === String(carId));
          if (updatedCar) renderEdit360Section(updatedCar, type);
          notifyFleetUpdated();
        } else {
          showToast(data.error || `Failed to upload ${type} 360 frames.`, "danger");
        }
      } catch (err) {
        showToast(err.message || `Error uploading ${type} 360 frames.`, "danger");
      }
    }

    async function handle360Delete(carId, type) {
      try {
        showToast(`Removing ${type} 360 frames from Supabase Storage...`, "info");
        const res = await apiFetch(`/api/admin/cars/${carId}/360/${type}`, {
          method: "DELETE"
        });

        const data = await safeParseJson(res);
        if (res.ok && data.success) {
          showToast(`Successfully cleared ${type} 360 sequence!`, "success");
          await loadAllData();
          const updatedCar = allCars.find(c => String(c.id) === String(carId));
          if (updatedCar) renderEdit360Section(updatedCar, type);
          notifyFleetUpdated();
        } else {
          showToast(data.error || `Failed to clear ${type} 360 sequence.`, "danger");
        }
      } catch (err) {
        showToast(err.message || `Error clearing ${type} 360 sequence.`, "danger");
      }
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const carId = document.getElementById("edit-car-id").value;
      const saveBtn = document.getElementById("btn-save-edit");

      if (editCarExistingImages.length === 0 && editCarNewFiles.length === 0) {
        showToast("Vehicle must have at least one showcase photo.", "warning");
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving Vehicle...";

      try {
        let newUploadedUrls = [];

        // Upload new photos to Supabase Storage if any were added
        if (editCarNewFiles.length > 0) {
          if (progressContainer) {
            progressContainer.style.display = "block";
            if (progressFill) progressFill.style.width = "30%";
            if (progressPct) progressPct.textContent = "30%";
            if (progressText) progressText.textContent = `Uploading ${editCarNewFiles.length} photo(s) to Supabase Storage...`;
          }

          const uploadFormData = new FormData();
          uploadFormData.append("vehicleId", carId);
          if (progressText) progressText.textContent = `Optimizing ${editCarNewFiles.length} photo(s)...`;
          const optimizedEditFiles = await Promise.all(editCarNewFiles.map(f => compressImageIfLarge(f)));
          optimizedEditFiles.forEach(f => uploadFormData.append("photos", f));

          const uploadRes = await apiFetch("/api/admin/vehicles/upload-images", {
            method: "POST",
            body: uploadFormData
          });

          const uploadData = await safeParseJson(uploadRes);
          if (!uploadRes.ok || !uploadData.success) {
            throw new Error(uploadData.error || "Failed to upload new photos to Supabase Storage.");
          }

          newUploadedUrls = uploadData.urls || [];
          if (progressFill) progressFill.style.width = "75%";
          if (progressPct) progressPct.textContent = "75%";
        }

        // Clean up removed photos from Supabase Storage asynchronously
        if (editCarRemovedImages.length > 0) {
          for (const rmUrl of editCarRemovedImages) {
            apiFetch("/api/admin/vehicles/storage-image", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ vehicleId: carId, url: rmUrl })
            }).catch(e => console.warn("Storage cleanup note:", e));
          }
        }

        // Combined images list
        const finalImages = [...editCarExistingImages, ...newUploadedUrls];

        const brand = document.getElementById("edit-brand").value.trim();
        const model = document.getElementById("edit-model").value.trim();
        const variant = document.getElementById("edit-variant").value.trim();
        const year = Number(document.getElementById("edit-year").value);
        const price = Number(document.getElementById("edit-price").value);
        const kmDriven = document.getElementById("edit-km").value.trim();
        const fuelType = document.getElementById("edit-fuel").value;
        const transmission = document.getElementById("edit-transmission").value.trim();
        const engine = document.getElementById("edit-engine").value.trim();
        const mileage = document.getElementById("edit-mileage").value.trim();
        const color = document.getElementById("edit-color").value.trim();
        const registration = document.getElementById("edit-registration").value.trim();
        const availability = document.getElementById("edit-availability").value;
        const description = document.getElementById("edit-description").value.trim();
        const rawHighlights = document.getElementById("edit-highlights").value.trim();
        const highlights = rawHighlights ? rawHighlights.split("\n").map(s => s.trim()).filter(Boolean) : [];

        const payload = {
          name: `${year} ${brand} ${model}${variant ? ' ' + variant : ''}`,
          brand,
          model,
          variant,
          year,
          price,
          kmDriven,
          fuelType,
          transmission,
          engine,
          mileage,
          color,
          registration,
          availability,
          description,
          highlights,
          images: finalImages
        };

        const res = await apiFetch(`/api/admin/cars/${carId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const data = await safeParseJson(res);
        if (res.ok && data.success) {
          showToast(`Vehicle "${payload.name}" updated successfully with ${finalImages.length} photo(s)!`, "success");
          document.getElementById("modal-edit-car").style.display = "none";
          editCarNewFiles = [];
          editCarRemovedImages = [];
          await loadAllData();
          notifyFleetUpdated();
        } else {
          showToast(data.error || "Failed to update vehicle", "danger");
        }
      } catch (err) {
        showToast(err.message || "Error updating vehicle on server", "danger");
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Changes";
        if (progressContainer) {
          progressContainer.style.display = "none";
          if (progressFill) progressFill.style.width = "0%";
        }
      }
    });
  }

  // =========================================================================
  // DELETE CAR MODAL
  // =========================================================================
  function openDeleteCarModal(carId) {
    const car = allCars.find(c => String(c.id) === String(carId));
    if (!car) return;

    carToDeleteId = car.id;
    document.getElementById("del-car-name").textContent = car.name || [car.brand, car.model].filter(Boolean).join(" ") || "Vehicle";
    document.getElementById("modal-delete-car").style.display = "flex";
  }

  function initDeleteCarHandler() {
    const confirmBtn = document.getElementById("btn-confirm-delete");
    if (!confirmBtn) return;

    confirmBtn.addEventListener("click", async () => {
      if (!carToDeleteId) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Deleting...";

      try {
        const res = await apiFetch(`/api/admin/cars/${carToDeleteId}`, {
          method: "DELETE"
        });
        const data = await safeParseJson(res);
        if (res.ok && data.success) {
          showToast("Vehicle permanently removed from fleet", "info");
          document.getElementById("modal-delete-car").style.display = "none";
          carToDeleteId = null;
          await loadAllData();
          notifyFleetUpdated();
        } else {
          showToast(data.error || "Failed to delete vehicle", "danger");
        }
      } catch (err) {
        showToast(err.message || "Error communicating with server", "danger");
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Confirm Delete";
      }
    });
  }

  // =========================================================================
  // CUSTOMER LEADS & WORKBENCH ENGINE
  // =========================================================================
  function updateLeadCounts() {
    const totalLeads = allInquiries.length;
    const tdCount = allInquiries.filter(i => i.type === "test_drive").length;
    const cbCount = allInquiries.filter(i => i.type === "car_booking").length;
    const inqCount = allInquiries.filter(i => i.type === "inquiry" || (!i.type && (i.service || "").toLowerCase().includes("inquiry"))).length;
    const newCount = allInquiries.filter(i => (i.status || "New").toLowerCase() === "new").length;

    const countAllEl = document.getElementById("count-lead-all");
    const countTdEl = document.getElementById("count-lead-td");
    const countCbEl = document.getElementById("count-lead-cb");
    const countInqEl = document.getElementById("count-lead-inq");
    const pendingPill = document.getElementById("leads-pending-pill");
    const pendingText = document.getElementById("leads-pending-text");

    if (countAllEl) countAllEl.textContent = totalLeads;
    if (countTdEl) countTdEl.textContent = tdCount;
    if (countCbEl) countCbEl.textContent = cbCount;
    if (countInqEl) countInqEl.textContent = inqCount;

    if (pendingPill && pendingText) {
      if (newCount > 0) {
        pendingPill.className = "admin-pending-pill";
        pendingText.textContent = `⚡ ${newCount} New Leads`;
      } else {
        pendingPill.className = "admin-pending-pill zero";
        pendingText.textContent = "✓ All Processed";
      }
    }
  }

  function renderBookings() {
    const tbody = document.getElementById("bookings-table-tbody");
    if (!tbody) return;

    updateLeadCounts();

    let list = [...allInquiries];

    // Filter by Lead Type
    if (currentLeadTypeFilter !== "all") {
      list = list.filter(i => {
        if (currentLeadTypeFilter === "test_drive") return i.type === "test_drive";
        if (currentLeadTypeFilter === "car_booking") return i.type === "car_booking";
        if (currentLeadTypeFilter === "inquiry") return i.type === "inquiry" || (!i.type && (i.service || "").toLowerCase().includes("inquiry"));
        return true;
      });
    }

    // Filter by Status
    if (currentLeadStatusFilter !== "all") {
      list = list.filter(i => (i.status || "New").toLowerCase() === currentLeadStatusFilter.toLowerCase());
    }

    // Filter by Date Range
    if (currentLeadDateFilter !== "all") {
      const now = new Date();
      list = list.filter(i => {
        if (!i.createdAt) return false;
        const itemDate = new Date(i.createdAt);
        const diffMs = now.getTime() - itemDate.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (currentLeadDateFilter === "today") return diffDays <= 1;
        if (currentLeadDateFilter === "7days") return diffDays <= 7;
        if (currentLeadDateFilter === "30days") return diffDays <= 30;
        return true;
      });
    }

    // Filter by Search Term
    if (currentLeadSearch.trim()) {
      const q = currentLeadSearch.trim().toLowerCase();
      list = list.filter(i => {
        const full = `${i.ref || ""} ${i.name || ""} ${i.phone || ""} ${i.email || ""} ${i.vehicleName || ""} ${i.city || ""} ${i.service || ""} ${i.message || ""}`.toLowerCase();
        return full.includes(q);
      });
    }

    // Sort Order
    list.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();
      return currentLeadSortOrder === "oldest" ? dateA - dateB : dateB - dateA;
    });

    const totalMatching = list.length;
    const totalPages = Math.ceil(totalMatching / leadsPerPage) || 1;
    if (currentLeadPage > totalPages) currentLeadPage = totalPages;
    if (currentLeadPage < 1) currentLeadPage = 1;

    const startIndex = (currentLeadPage - 1) * leadsPerPage;
    const paginatedList = list.slice(startIndex, startIndex + leadsPerPage);

    // Update Pagination Info & Buttons
    const infoEl = document.getElementById("leads-pagination-info");
    const prevBtn = document.getElementById("btn-leads-prev-page");
    const nextBtn = document.getElementById("btn-leads-next-page");

    if (infoEl) {
      if (totalMatching === 0) {
        infoEl.textContent = "Showing 0–0 of 0 leads";
      } else {
        const endDisplay = Math.min(startIndex + leadsPerPage, totalMatching);
        infoEl.textContent = `Showing ${startIndex + 1}–${endDisplay} of ${totalMatching} leads (Page ${currentLeadPage} of ${totalPages})`;
      }
    }
    if (prevBtn) prevBtn.disabled = currentLeadPage <= 1;
    if (nextBtn) nextBtn.disabled = currentLeadPage >= totalPages;

    tbody.innerHTML = "";
    if (paginatedList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 3.5rem 1rem; color: var(--admin-text-muted);">
            <div style="font-size: 1rem; font-weight: 600; color: #cbd5e1; margin-bottom: 0.35rem;">No customer leads found</div>
            <div style="font-size: 0.8125rem;">Try adjusting your search query, status filters, or date range.</div>
          </td>
        </tr>
      `;
      return;
    }

    paginatedList.forEach(inq => {
      const tr = document.createElement("tr");
      const status = inq.status || "New";

      let typeBadge = '<span class="badge-pill" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-size: 0.65rem;">General</span>';
      if (inq.type === "test_drive") {
        typeBadge = '<span class="badge-pill" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.65rem;">Test Drive</span>';
      } else if (inq.type === "car_booking") {
        typeBadge = '<span class="badge-pill" style="background: rgba(139, 92, 246, 0.15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.3); font-size: 0.65rem;">Reservation</span>';
      }

      let dateStr = "Recent";
      if (inq.createdAt) {
        const d = new Date(inq.createdAt);
        if (!isNaN(d.getTime())) {
          dateStr = d.toLocaleDateString("en-IN", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
        }
      }

      const cleanPhone = (inq.phone || "").replace(/[^0-9+]/g, "");

      tr.innerHTML = `
        <td>
          <div style="display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.25rem;">
            <strong style="color: #60a5fa; font-size: 0.875rem;">${escapeHtml(inq.ref || "#BK")}</strong>
            ${typeBadge}
          </div>
          <div style="font-size: 0.75rem; color: var(--admin-text-muted);">${dateStr}</div>
        </td>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(inq.name || "Customer")}</div>
          <div style="display: flex; align-items: center; gap: 0.4rem; margin-top: 0.25rem; flex-wrap: wrap;">
            ${cleanPhone ? `<a href="tel:${cleanPhone}" class="lead-quick-btn call-btn" style="padding: 0.15rem 0.45rem; font-size: 0.75rem;" title="Call Customer">📞 Call</a>` : '<span style="color: var(--admin-text-muted); font-size: 0.75rem;">No Phone</span>'}
            ${inq.email ? `<a href="mailto:${escapeHtml(inq.email)}?subject=Ekta Motors Booking ${encodeURIComponent(inq.ref || '')}" class="lead-quick-btn email-btn" style="padding: 0.15rem 0.45rem; font-size: 0.75rem;" title="Email Customer">✉️ Email</a>` : ''}
          </div>
          ${inq.city ? `<div style="font-size: 0.75rem; color: var(--admin-text-muted); margin-top: 0.2rem;">📍 ${escapeHtml(inq.city)}</div>` : ''}
        </td>
        <td>
          <div style="font-weight: 600; color: #fff; font-size: 0.875rem;">${escapeHtml(inq.vehicleName || "General Inquiry")}</div>
          ${inq.variant ? `<div style="font-size: 0.75rem; color: #94a3b8;">${escapeHtml(inq.variant)}</div>` : ''}
        </td>
        <td>
          <div style="font-size: 0.8125rem; color: #cbd5e1;">${escapeHtml(inq.service || "Showroom Visit")}</div>
          ${inq.preferredDate ? `<div style="font-size: 0.75rem; color: #60a5fa; font-weight: 600;">Slot: ${escapeHtml(inq.preferredDate)}${inq.preferredTime ? ' (' + escapeHtml(inq.preferredTime) + ')' : ''}</div>` : ''}
          ${inq.tokenAmount ? `<div style="font-size: 0.75rem; color: #34d399; font-weight: 600;">Deposit: ${escapeHtml(inq.tokenAmount)}</div>` : ''}
        </td>
        <td>
          <select class="admin-select inq-status-select" data-id="${inq.id}" style="padding: 0.35rem 0.5rem; font-size: 0.8125rem; border-radius: 6px; font-weight: 600;">
            <option value="New" ${status === "New" ? "selected" : ""}>New</option>
            <option value="Contacted" ${status === "Contacted" ? "selected" : ""}>Contacted</option>
            <option value="In Progress" ${status === "In Progress" ? "selected" : ""}>In Progress</option>
            <option value="Confirmed" ${status === "Confirmed" ? "selected" : ""}>Confirmed</option>
            <option value="Completed" ${status === "Completed" ? "selected" : ""}>Completed</option>
            <option value="Cancelled" ${status === "Cancelled" ? "selected" : ""}>Cancelled</option>
            <option value="Rejected" ${status === "Rejected" ? "selected" : ""}>Rejected</option>
          </select>
        </td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 0.4rem; justify-content: flex-end;">
            <button type="button" class="btn-action-icon view-inq-btn" data-id="${inq.id}" title="Open Lead Detail & Follow-up Workbench">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
            <button type="button" class="btn-action-icon danger delete-inq-btn" data-id="${inq.id}" title="Delete Record">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function openInquiryModal(inqId) {
    const inq = allInquiries.find(i => String(i.id) === String(inqId));
    if (!inq) return;

    const modal = document.getElementById("modal-inquiry-details");
    const refEl = document.getElementById("inq-modal-ref");
    const contentEl = document.getElementById("inq-modal-content");

    let typeTitle = "General Inquiry";
    if (inq.type === "test_drive") typeTitle = "Test Drive Booking";
    if (inq.type === "car_booking") typeTitle = "Car Reservation";

    const cleanPhone = (inq.phone || "").replace(/[^0-9+]/g, "");
    const waPhone = cleanPhone.replace(/^\+?91/, "").replace(/[^0-9]/g, "");

    refEl.textContent = `${inq.ref || "#BK"} · ${typeTitle} · Registered on ${inq.createdAt ? new Date(inq.createdAt).toLocaleString("en-IN") : "Recent"}`;

    const matchingVehicle = allCars.find(c => String(c.id) === String(inq.vehicleId) || String(c.name).toLowerCase() === String(inq.vehicleName).toLowerCase());

    contentEl.innerHTML = `
      <!-- Quick Follow-up Action Bar -->
      <div style="display: flex; gap: 0.5rem; margin-bottom: 1.25rem; flex-wrap: wrap;">
        ${cleanPhone ? `<a href="tel:${cleanPhone}" class="lead-quick-btn call-btn" style="flex: 1; justify-content: center; padding: 0.5rem 1rem;">📞 Direct Call (${escapeHtml(inq.phone)})</a>` : ''}
        ${inq.email ? `<a href="mailto:${escapeHtml(inq.email)}?subject=Ekta Motors - Booking Query Ref: ${encodeURIComponent(inq.ref || '')}" class="lead-quick-btn email-btn" style="flex: 1; justify-content: center; padding: 0.5rem 1rem;">✉️ Send Email</a>` : ''}
        ${waPhone.length >= 10 ? `<a href="https://wa.me/91${waPhone}?text=${encodeURIComponent('Hello ' + inq.name + ', greetings from Ekta Motors Jalna regarding your booking ref ' + (inq.ref || ''))}" target="_blank" rel="noopener noreferrer" class="lead-quick-btn wa-btn" style="flex: 1; justify-content: center; padding: 0.5rem 1rem;">💬 WhatsApp</a>` : ''}
      </div>

      <!-- Customer & Vehicle Info Grid -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem; background: rgba(10, 15, 29, 0.6); padding: 1.25rem; border-radius: 12px; border: 1px solid var(--admin-border);">
        <div>
          <span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Customer Name</span>
          <strong style="color: #fff; display: block; font-size: 1rem;">${escapeHtml(inq.name || "Customer")}</strong>
        </div>
        <div>
          <span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Customer City / Location</span>
          <strong style="color: #fff; display: block; font-size: 0.9375rem;">${escapeHtml(inq.city || "Jalna, Maharashtra")}</strong>
        </div>
        <div>
          <span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Phone Contact</span>
          <div style="color: #60a5fa; font-weight: 700;">${escapeHtml(inq.phone || "None provided")}</div>
        </div>
        <div>
          <span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Email Contact</span>
          <div style="color: #cbd5e1; font-size: 0.875rem;">${escapeHtml(inq.email || "None provided")}</div>
        </div>
        <div style="grid-column: span 2; padding-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
          <div>
            <span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Vehicle of Interest</span>
            <div style="color: #fff; font-weight: 700; font-size: 1rem;">${escapeHtml(inq.vehicleName || "General Dealership Inquiry")}</div>
          </div>
          ${matchingVehicle ? `
            <button type="button" class="btn btn-secondary btn-sm" id="btn-inq-view-car" data-car-id="${matchingVehicle.id}" style="padding: 0.3rem 0.65rem; font-size: 0.75rem;">
              Inspect Vehicle Fleet Record
            </button>
          ` : ''}
        </div>
      </div>

      <!-- Specifics / Message Section -->
      <div style="background: rgba(10, 15, 29, 0.4); border: 1px solid var(--admin-border); border-radius: 8px; padding: 1rem; margin-bottom: 1.25rem;">
        <div style="font-size: 0.8125rem; font-weight: 700; color: #cbd5e1; margin-bottom: 0.5rem;">Request Parameters & Customer Notes</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; font-size: 0.8125rem; margin-bottom: 0.75rem;">
          <div><span style="color: var(--admin-text-muted);">Service:</span> <strong style="color: #fff;">${escapeHtml(inq.service || "Showroom Visit")}</strong></div>
          ${inq.preferredDate ? `<div><span style="color: var(--admin-text-muted);">Slot Date:</span> <strong style="color: #60a5fa;">${escapeHtml(inq.preferredDate)}${inq.preferredTime ? ' (' + escapeHtml(inq.preferredTime) + ')' : ''}</strong></div>` : ''}
          ${inq.tokenAmount ? `<div><span style="color: var(--admin-text-muted);">Token Deposit:</span> <strong style="color: #34d399;">${escapeHtml(inq.tokenAmount)}</strong></div>` : ''}
          ${inq.variant ? `<div><span style="color: var(--admin-text-muted);">Trim/Variant:</span> <strong style="color: #fff;">${escapeHtml(inq.variant)}</strong></div>` : ''}
          ${inq.colorPreference ? `<div><span style="color: var(--admin-text-muted);">Color:</span> <strong style="color: #fff;">${escapeHtml(inq.colorPreference)}</strong></div>` : ''}
          ${inq.paymentPreference ? `<div><span style="color: var(--admin-text-muted);">Payment:</span> <strong style="color: #fff;">${escapeHtml(inq.paymentPreference)}</strong></div>` : ''}
          ${inq.tradeInVehicle && inq.tradeInVehicle !== 'None' ? `<div><span style="color: var(--admin-text-muted);">Trade-in:</span> <strong style="color: #fbbf24;">${escapeHtml(inq.tradeInVehicle)}</strong></div>` : ''}
        </div>
        ${inq.message ? `
          <div style="padding-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.06); font-size: 0.8125rem; color: #f8fafc; white-space: pre-wrap;">
            <strong>Customer Message:</strong> ${escapeHtml(inq.message)}
          </div>
        ` : ''}
      </div>

      <!-- Private Advisor Notes -->
      <div style="margin-bottom: 1.25rem;">
        <span style="color: var(--admin-text-muted); font-size: 0.75rem; text-transform: uppercase;">Dealership Advisor Follow-up Notes</span>
        <textarea id="modal-inq-notes" class="admin-textarea" rows="3" placeholder="Add private advisor notes, test drive outcome, financing pre-approval status..." style="margin-top: 0.35rem;">${escapeHtml(inq.notes || "")}</textarea>
      </div>

      <!-- Status & Save Control -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="font-size: 0.8125rem; color: var(--admin-text-muted);">Status:</span>
          <select id="modal-inq-status" class="admin-select" style="padding: 0.4rem 0.75rem; font-size: 0.8125rem; font-weight: 700;">
            <option value="New" ${inq.status === "New" ? "selected" : ""}>New</option>
            <option value="Contacted" ${inq.status === "Contacted" ? "selected" : ""}>Contacted</option>
            <option value="In Progress" ${inq.status === "In Progress" ? "selected" : ""}>In Progress</option>
            <option value="Confirmed" ${inq.status === "Confirmed" ? "selected" : ""}>Confirmed</option>
            <option value="Completed" ${inq.status === "Completed" ? "selected" : ""}>Completed</option>
            <option value="Cancelled" ${inq.status === "Cancelled" ? "selected" : ""}>Cancelled</option>
            <option value="Rejected" ${inq.status === "Rejected" ? "selected" : ""}>Rejected</option>
          </select>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="btn-save-inq-modal" data-id="${inq.id}">
          Save Notes & Status
        </button>
      </div>
    `;

    modal.style.display = "flex";

    document.getElementById("btn-inq-view-car")?.addEventListener("click", (e) => {
      const carId = e.currentTarget.dataset.carId;
      modal.style.display = "none";
      openCarDetailsModal(carId);
    });

    document.getElementById("btn-save-inq-modal")?.addEventListener("click", async () => {
      const notes = document.getElementById("modal-inq-notes").value.trim();
      const status = document.getElementById("modal-inq-status").value;

      try {
        const res = await apiFetch(`/api/admin/inquiries/${inq.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes, status })
        });
        if (res.ok) {
          showToast(`Inquiry ${inq.ref} updated successfully!`, "success");
          modal.style.display = "none";
          await loadAllData();
        } else {
          showToast("Failed to save inquiry update", "danger");
        }
      } catch (err) {
        showToast("Failed to save inquiry update", "danger");
      }
    });
  }

  // Export Inquiries to CSV
  function exportInquiriesCSV() {
    if (allInquiries.length === 0) {
      showToast("No queries to export", "info");
      return;
    }

    const headers = ["Ref", "Type", "Customer Name", "Phone", "Email", "City", "Vehicle", "Service", "Preferred Date", "Status", "Deposit", "Trade-in", "Message", "Created Date"];
    const rows = allInquiries.map(i => [
      i.ref || "",
      i.type || "inquiry",
      `"${(i.name || "").replace(/"/g, '""')}"`,
      `"${(i.phone || "").replace(/"/g, '""')}"`,
      `"${(i.email || "").replace(/"/g, '""')}"`,
      `"${(i.city || "").replace(/"/g, '""')}"`,
      `"${(i.vehicleName || "").replace(/"/g, '""')}"`,
      `"${(i.service || "").replace(/"/g, '""')}"`,
      `"${(i.preferredDate || "").replace(/"/g, '""')}"`,
      i.status || "New",
      `"${(i.tokenAmount || "").replace(/"/g, '""')}"`,
      `"${(i.tradeInVehicle || "").replace(/"/g, '""')}"`,
      `"${(i.message || "").replace(/"/g, '""')}"`,
      i.createdAt || ""
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Ekta_Motors_Leads_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast("Leads exported to CSV successfully", "success");
  }

  // =========================================================================
  // REVIEWS & FEEDBACK MANAGEMENT
  // =========================================================================
  function renderReviews() {
    const tbody = document.getElementById("reviews-table-tbody");
    if (!tbody) return;

    // Update toolbar counts & pill
    const totalCount = allReviews.length;
    const pendingCount = allReviews.filter(r => String(r.status || "pending").toLowerCase() === "pending").length;
    const approvedCount = allReviews.filter(r => {
      const s = String(r.status || "approved").toLowerCase();
      return s === "approved" || s === "published";
    }).length;

    const countAllEl = document.getElementById("rev-count-all");
    const countPendEl = document.getElementById("rev-count-pending");
    const countApprEl = document.getElementById("rev-count-approved");
    if (countAllEl) countAllEl.textContent = totalCount;
    if (countPendEl) countPendEl.textContent = pendingCount;
    if (countApprEl) countApprEl.textContent = approvedCount;

    const pendingPill = document.getElementById("admin-reviews-pending-pill");
    const pendingText = document.getElementById("admin-reviews-pending-text");
    if (pendingPill && pendingText) {
      if (pendingCount > 0) {
        pendingPill.className = "admin-pending-pill";
        pendingText.textContent = `⚡ ${pendingCount} Pending`;
      } else {
        pendingPill.className = "admin-pending-pill zero";
        pendingText.textContent = "✓ All Approved";
      }
    }

    // Filter reviews according to currentReviewFilter and currentReviewSearch
    let displayedReviews = allReviews;
    if (currentReviewFilter === "pending") {
      displayedReviews = displayedReviews.filter(r => String(r.status || "pending").toLowerCase() === "pending");
    } else if (currentReviewFilter === "approved") {
      displayedReviews = displayedReviews.filter(r => {
        const s = String(r.status || "approved").toLowerCase();
        return s === "approved" || s === "published";
      });
    }

    if (currentReviewSearch.trim()) {
      const q = currentReviewSearch.trim().toLowerCase();
      displayedReviews = displayedReviews.filter(r => {
        const author = (r.authorName || r.name || "").toLowerCase();
        const car = (r.authorCar || "").toLowerCase();
        const quote = (r.quote || r.message || "").toLowerCase();
        return author.includes(q) || car.includes(q) || quote.includes(q);
      });
    }

    tbody.innerHTML = "";
    if (displayedReviews.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 3rem; color: var(--admin-text-muted);">
            ${currentReviewFilter === "pending"
              ? "No pending reviews awaiting moderation."
              : currentReviewSearch.trim()
                ? "No reviews match your search query."
                : "No customer reviews submitted yet."}
          </td>
        </tr>
      `;
      initReviewsToolbarEvents();
      return;
    }

    displayedReviews.forEach(rev => {
      const tr = document.createElement("tr");
      const rawStatus = String(rev.status || "pending").toLowerCase();
      const isApproved = rawStatus === "approved" || rawStatus === "published";
      let badgeClass = isApproved ? "badge-confirmed" : "badge-reserved"; // badge-confirmed (green), badge-reserved (amber pending)
      const displayStatus = isApproved ? "Approved" : "Pending";

      const ratingNum = Math.max(1, Math.min(5, Number(rev.rating) || 5));
      const stars = "★".repeat(ratingNum) + "☆".repeat(5 - ratingNum);

      let formattedDate = "Recent";
      const rawDate = rev.createdAt || rev.created_at;
      if (rawDate) {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          formattedDate = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
        }
      }

      tr.innerHTML = `
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(rev.authorName || rev.name || "Customer")}</div>
          <div style="font-size: 0.75rem; color: var(--admin-text-muted);">${formattedDate}</div>
        </td>
        <td>
          <span style="font-size: 0.8125rem; color: #cbd5e1;">${escapeHtml(rev.authorCar || "Ekta Fleet")}${rev.purchaseYear ? ` (${escapeHtml(String(rev.purchaseYear))})` : ""}</span>
        </td>
        <td>
          <span style="color: #f59e0b; font-size: 1rem;" title="${ratingNum} / 5 stars">${stars}</span>
        </td>
        <td style="max-width: 320px;">
          <div style="font-size: 0.8125rem; color: var(--admin-text-secondary); line-height: 1.5;">
            "${escapeHtml(rev.quote || rev.message || "")}"
          </div>
        </td>
        <td>
          <span class="badge-pill ${badgeClass}">${displayStatus}</span>
        </td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 0.4rem; justify-content: flex-end;">
            <button type="button" class="btn btn-secondary btn-sm toggle-rev-btn" data-id="${rev.id}" data-status="${isApproved ? 'approved' : 'pending'}" style="padding: 0.35rem 0.65rem; font-size: 0.75rem;">
              ${isApproved ? "Set to Pending" : "Approve"}
            </button>
            <button type="button" class="btn-action-icon danger delete-rev-btn" data-id="${rev.id}" title="Delete Customer Review">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    initReviewsToolbarEvents();
  }

  function initReviewsToolbarEvents() {
    if (reviewsToolbarInitialized) return;
    reviewsToolbarInitialized = true;

    const btnAll = document.getElementById("rev-filter-btn-all");
    const btnPend = document.getElementById("rev-filter-btn-pending");
    const btnAppr = document.getElementById("rev-filter-btn-approved");
    const filterBtns = [btnAll, btnPend, btnAppr];

    filterBtns.forEach(btn => {
      if (!btn) return;
      btn.addEventListener("click", () => {
        filterBtns.forEach(b => b?.classList.remove("active"));
        btn.classList.add("active");
        currentReviewFilter = btn.dataset.reviewFilter || "all";
        renderReviews();
      });
    });

    const searchInput = document.getElementById("admin-reviews-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        currentReviewSearch = e.target.value;
        renderReviews();
      });
    }

    const syncBtn = document.getElementById("btn-sync-supabase-reviews");
    if (syncBtn) {
      syncBtn.addEventListener("click", async () => {
        syncBtn.disabled = true;
        const origHtml = syncBtn.innerHTML;
        syncBtn.innerHTML = `<span class="spinner-inline" style="width: 12px; height: 12px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; display: inline-block;"></span> Syncing...`;
        try {
          await loadAllData();
          showToast("Reviews synchronized with Supabase", "success");
        } catch (_) {
          showToast("Failed to sync reviews", "danger");
        } finally {
          syncBtn.disabled = false;
          syncBtn.innerHTML = origHtml;
        }
      });
    }
  }

  // =========================================================================
  // SECURITY & PASSWORD UPDATE
  // =========================================================================
  function initSecurityForm() {
    const form = document.getElementById("form-change-password");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const currentPwd = document.getElementById("pwd-current").value;
      const newPwd = document.getElementById("pwd-new").value;
      const confirmPwd = document.getElementById("pwd-confirm").value;
      const alertEl = document.getElementById("pwd-alert");
      const submitBtn = document.getElementById("btn-submit-pwd");

      alertEl.style.display = "none";

      if (newPwd !== confirmPwd) {
        alertEl.textContent = "New passwords do not match. Please re-type.";
        alertEl.style.display = "block";
        alertEl.style.background = "rgba(239, 68, 68, 0.2)";
        alertEl.style.color = "#fca5a5";
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Updating Password...";

      try {
        const res = await apiFetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword: currentPwd,
            newPassword: newPwd
          })
        });

        const data = await safeParseJson(res);
        if (res.ok && data.success) {
          alertEl.textContent = "Administrator password updated and protected successfully!";
          alertEl.style.display = "block";
          alertEl.style.background = "rgba(16, 185, 129, 0.2)";
          alertEl.style.color = "#86efac";
          form.reset();
        } else {
          alertEl.textContent = data.error || "Failed to change password. Verify your current password.";
          alertEl.style.display = "block";
          alertEl.style.background = "rgba(239, 68, 68, 0.2)";
          alertEl.style.color = "#fca5a5";
        }
      } catch (err) {
        alertEl.textContent = "Unable to connect to server.";
        alertEl.style.display = "block";
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Update Administrator Password";
      }
    });
  }

  // =========================================================================
  // LOGOUT
  // =========================================================================
  function initLogout() {
    const logoutBtn = document.getElementById("btn-logout");
    if (!logoutBtn) return;

    logoutBtn.addEventListener("click", async () => {
      try {
        await apiFetch("/api/auth/logout", { method: "POST" });
      } catch (_) {}
      sessionStorage.clear();
      localStorage.removeItem("ekta_admin_token");
      localStorage.removeItem("ekta_admin_session");
      localStorage.removeItem("ekta_admin_user");
      document.cookie = "ekta_admin_token=; Path=/; Max-Age=0; SameSite=Lax";
      document.cookie = "ekta_admin_token_sec=; Path=/; Max-Age=0; SameSite=None; Secure";
      window.location.replace("/admin/login");
    });
  }

  // Global Event Delegation for Dynamic Buttons
  function initGlobalListeners() {
    document.addEventListener("click", async (e) => {
      // View car specs
      const viewCarBtn = e.target.closest(".view-car-btn");
      if (viewCarBtn) {
        openCarDetailsModal(viewCarBtn.dataset.id);
        return;
      }

      // Edit car
      const editCarBtn = e.target.closest(".edit-car-btn");
      if (editCarBtn) {
        openEditCarModal(editCarBtn.dataset.id);
        return;
      }

      // Delete car
      const delCarBtn = e.target.closest(".delete-car-btn");
      if (delCarBtn) {
        openDeleteCarModal(delCarBtn.dataset.id);
        return;
      }

      // View inquiry
      const viewInqBtn = e.target.closest(".view-inq-btn");
      if (viewInqBtn) {
        openInquiryModal(viewInqBtn.dataset.id);
        return;
      }

      // Delete inquiry confirmation trigger
      const delInqBtn = e.target.closest(".delete-inq-btn");
      if (delInqBtn) {
        inqToDeleteId = delInqBtn.dataset.id;
        const targetInq = allInquiries.find(i => String(i.id) === String(inqToDeleteId));
        const delRefEl = document.getElementById("del-inq-ref");
        const delCustEl = document.getElementById("del-inq-customer");
        if (delRefEl) delRefEl.textContent = targetInq?.ref || `#${inqToDeleteId}`;
        if (delCustEl) delCustEl.textContent = targetInq?.name || "Customer";
        document.getElementById("modal-delete-inquiry").style.display = "flex";
        return;
      }

      // Toggle Review status
      const toggleRevBtn = e.target.closest(".toggle-rev-btn");
      if (toggleRevBtn) {
        const revId = toggleRevBtn.dataset.id;
        const curStatus = (toggleRevBtn.dataset.status || "").toLowerCase();
        const newStatus = (curStatus === "approved" || curStatus === "published") ? "pending" : "approved";
        try {
          const res = await apiFetch(`/api/admin/reviews/${revId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus })
          });
          if (res.ok) {
            showToast(`Review status set to ${newStatus}`, "success");
            try {
              localStorage.setItem("ekta_testimonials_sync", Date.now().toString());
              if (window.opener && window.opener.EktaAdminReviews) {
                window.opener.EktaAdminReviews.refreshTestimonials();
              }
            } catch (_) {}
            await loadAllData();
          }
        } catch (err) {
          showToast("Failed to update review status", "danger");
        }
        return;
      }

      // Delete Review confirmation trigger
      const delRevBtn = e.target.closest(".delete-rev-btn");
      if (delRevBtn) {
        revToDeleteId = delRevBtn.dataset.id;
        const targetRev = allReviews.find(r => String(r.id) === String(revToDeleteId));
        const delAuthEl = document.getElementById("del-rev-author");
        if (delAuthEl) delAuthEl.textContent = targetRev?.authorName || targetRev?.name || "Customer";
        document.getElementById("modal-delete-review").style.display = "flex";
        return;
      }

      // Lead Type Filter Pills
      const leadTypeBtn = e.target.closest("[data-lead-type]");
      if (leadTypeBtn) {
        document.querySelectorAll("[data-lead-type]").forEach(b => b.classList.remove("active"));
        leadTypeBtn.classList.add("active");
        currentLeadTypeFilter = leadTypeBtn.dataset.leadType || "all";
        currentLeadPage = 1;
        renderBookings();
        return;
      }

      // Modal close handlers
      if (e.target.closest("#btn-close-car-modal")) {
        document.getElementById("modal-car-details").style.display = "none";
      }
      if (e.target.closest("#btn-close-edit-modal") || e.target.closest("#btn-cancel-edit")) {
        document.getElementById("modal-edit-car").style.display = "none";
      }
      if (e.target.closest("#btn-cancel-delete")) {
        document.getElementById("modal-delete-car").style.display = "none";
        carToDeleteId = null;
      }
      if (e.target.closest("#btn-close-inquiry-modal")) {
        document.getElementById("modal-inquiry-details").style.display = "none";
      }
      if (e.target.closest("#btn-cancel-delete-inq")) {
        document.getElementById("modal-delete-inquiry").style.display = "none";
        inqToDeleteId = null;
      }
      if (e.target.closest("#btn-cancel-delete-rev")) {
        document.getElementById("modal-delete-review").style.display = "none";
        revToDeleteId = null;
      }

      // Confirm Delete Inquiry
      if (e.target.closest("#btn-confirm-delete-inq")) {
        if (!inqToDeleteId) return;
        try {
          const res = await apiFetch(`/api/admin/inquiries/${inqToDeleteId}`, { method: "DELETE" });
          if (res.ok) {
            showToast("Inquiry lead record permanently removed.", "info");
            document.getElementById("modal-delete-inquiry").style.display = "none";
            inqToDeleteId = null;
            await loadAllData();
          } else {
            showToast("Failed to delete inquiry from database.", "danger");
          }
        } catch (err) {
          showToast("Failed to delete inquiry.", "danger");
        }
      }

      // Confirm Delete Review
      if (e.target.closest("#btn-confirm-delete-rev")) {
        if (!revToDeleteId) return;
        try {
          const res = await apiFetch(`/api/admin/reviews/${revToDeleteId}`, { method: "DELETE" });
          if (res.ok) {
            showToast("Customer review permanently removed.", "info");
            document.getElementById("modal-delete-review").style.display = "none";
            revToDeleteId = null;
            try {
              localStorage.setItem("ekta_testimonials_sync", Date.now().toString());
              if (window.opener && window.opener.EktaAdminReviews) {
                window.opener.EktaAdminReviews.refreshTestimonials();
              }
            } catch (_) {}
            await loadAllData();
          } else {
            showToast("Failed to delete review from database.", "danger");
          }
        } catch (err) {
          showToast("Failed to delete review.", "danger");
        }
      }
    });

    // Close on backdrop click
    document.querySelectorAll(".admin-modal-backdrop").forEach(backdrop => {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) {
          backdrop.style.display = "none";
          carToDeleteId = null;
          inqToDeleteId = null;
          revToDeleteId = null;
        }
      });
    });

    // Live status changer from select dropdown
    document.addEventListener("change", async (e) => {
      if (e.target.classList.contains("inq-status-select")) {
        const inqId = e.target.dataset.id;
        const newStatus = e.target.value;
        try {
          const res = await apiFetch(`/api/admin/inquiries/${inqId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus })
          });
          if (res.ok) {
            showToast(`Status updated to "${newStatus}"`, "success");
            await loadAllData();
          } else {
            showToast("Failed to update status in Supabase", "danger");
          }
        } catch (err) {
          showToast("Failed to update status", "danger");
        }
      }
    });

    // Filters for Cars
    document.getElementById("cars-search-input")?.addEventListener("input", renderManageCars);
    document.getElementById("cars-filter-fuel")?.addEventListener("change", renderManageCars);
    document.getElementById("cars-filter-status")?.addEventListener("change", renderManageCars);
    document.getElementById("cars-sort-select")?.addEventListener("change", renderManageCars);

    // Filters for Queries / Leads
    document.getElementById("queries-search-input")?.addEventListener("input", (e) => {
      currentLeadSearch = e.target.value;
      currentLeadPage = 1;
      renderBookings();
    });
    document.getElementById("queries-filter-status")?.addEventListener("change", (e) => {
      currentLeadStatusFilter = e.target.value;
      currentLeadPage = 1;
      renderBookings();
    });
    document.getElementById("queries-filter-date")?.addEventListener("change", (e) => {
      currentLeadDateFilter = e.target.value;
      currentLeadPage = 1;
      renderBookings();
    });
    document.getElementById("queries-sort-order")?.addEventListener("change", (e) => {
      currentLeadSortOrder = e.target.value;
      renderBookings();
    });

    // Pagination for Leads
    document.getElementById("btn-leads-prev-page")?.addEventListener("click", () => {
      if (currentLeadPage > 1) {
        currentLeadPage--;
        renderBookings();
      }
    });
    document.getElementById("btn-leads-next-page")?.addEventListener("click", () => {
      currentLeadPage++;
      renderBookings();
    });

    // Refresh Leads Button
    document.getElementById("btn-refresh-queries")?.addEventListener("click", async () => {
      showToast("Syncing customer leads from Supabase...", "info");
      await loadAllData();
      showToast("Customer leads up to date!", "success");
    });

    // Export CSV button
    document.getElementById("btn-export-queries-csv")?.addEventListener("click", exportInquiriesCSV);
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Initialization
  async function init() {
    await checkAuth();
    initNavigation();
    initGlobalListeners();
    initAddCarForm();
    initEditCarForm();
    initDeleteCarHandler();
    initSecurityForm();
    initLogout();
    await loadAllData();
  }

  init();
})();
