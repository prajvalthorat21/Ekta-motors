/**
 * EKTA MOTORS - Administration Router Bridge
 * Deprecated client-side mock auth removed in Step 2.
 * All administrative functions are securely managed via /admin/dashboard and authenticated through the backend.
 */
(function () {
  "use strict";
  // Redirect legacy calls to the official admin portal
  if (window.location.pathname === "/admin" || window.location.pathname === "/admin.html") {
    window.location.replace("/admin/login");
  }
})();
