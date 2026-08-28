/**
 * HomeFlow HighLevel Customizations
 * Release: v1.0.3 (Unified Robust Production Architecture with Dynamic Exclusion)
 * 
 * Centralized async route controller for HighLevel CRM web application.
 * Handles subaccount exclusions, route redirections, layout adjustments,
 * and location-scoped sidebar/header styling without dependencies.
 */
(function () {
  'use strict';

  /* =========================================================
     1. CONFIGURATION & CONSTANTS
  ========================================================= */
  // Legacy hardcoded exclusions disabled — these two Location IDs must now
  // exist as rows in one of the two Supabase `ghl_installations` tables for
  // their exclusion to keep working. Left commented (not deleted) for quick
  // rollback if needed.
  // const LEGACY_EXCLUDED_LOCATION_IDS = [
  //   "3hxU86Tlg4Hj231eATmo",
  //   "wU0QPFEzdTl7CpndxylS"
  // ];
  const LEGACY_EXCLUDED_LOCATION_IDS = [];

  const EXCLUSION_API_ENDPOINT = "https://ghl-agency-whitelabel.vercel.app/api/location-exclusion";
  const EXCLUSION_TTL_MS = 60 * 1000; // 60 seconds TTL

  const HOMEFLOW_LOCATION_ID = "XzzLQ42sqJR43o30CP34";

  const STYLE_IDS = {
    SIDEBAR: "custom-sidebar-global-layout",
    REVIEWS: "custom-review-layout-test",
    WIDGET: "custom-widget-layout-test",
    SOCIAL_PLANNER: "custom-social-planner-layout-test",
    REPUTATION_INTEGRATIONS: "custom-reputation-integrations-layout-test",
    REVIEWS_AI: "custom-reviews-ai-layout-test",
    HOMEFLOW: "hide-header-templates-emails"
  };

  const ALL_STYLE_IDS = Object.values(STYLE_IDS);

  /* =========================================================
     2. DYNAMIC LOCATION EXCLUSION RESOLVER (CACHE & DEDUPLICATION)
  ========================================================= */
  const exclusionCache = new Map(); // locationId => { value: boolean, verifiedAt: number }
  const inFlightRequests = new Map(); // locationId => Promise<boolean>

  function getStoredResult(cleanLocId) {
    // 1. Check in-memory cache
    if (exclusionCache.has(cleanLocId)) {
      return exclusionCache.get(cleanLocId);
    }

    // 2. Check sessionStorage fallback
    try {
      const storageKey = "homeflow:location-exclusion:" + cleanLocId;
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.value === "boolean" && typeof parsed.verifiedAt === "number") {
          exclusionCache.set(cleanLocId, parsed);
          return parsed;
        }
      }
    } catch (e) {
      // Storage access blocked or parse error
    }

    return null;
  }

  async function isLocationExcluded(locationId) {
    if (!locationId || typeof locationId !== "string" || !locationId.trim()) {
      return false;
    }

    const cleanLocId = locationId.trim();

    // 1. Legacy Hardcoded Exclusions (Instant Match)
    if (LEGACY_EXCLUDED_LOCATION_IDS.includes(cleanLocId)) {
      return true;
    }

    const now = Date.now();
    const existing = getStoredResult(cleanLocId);

    // 2. Fresh Cache Hit (within 60s TTL)
    if (existing && (now - existing.verifiedAt) < EXCLUSION_TTL_MS) {
      return existing.value;
    }

    // 3. In-Flight Request Deduplication
    if (inFlightRequests.has(cleanLocId)) {
      return await inFlightRequests.get(cleanLocId);
    }

    // 4. Backend Verification Request with In-Flight Deduplication
    const fetchPromise = (async () => {
      let timeoutId = null;

      try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 7000); // 7s timeout

        const apiUrl = EXCLUSION_API_ENDPOINT + "?locationId=" + encodeURIComponent(cleanLocId);

        const response = await fetch(apiUrl, {
          method: "GET",
          headers: {
            "Accept": "application/json"
          },
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("HTTP status " + response.status);
        }

        const data = await response.json();

        // Strict boolean payload validation
        if (data && typeof data.excluded === "boolean") {
          const result = data.excluded;
          const entry = { value: result, verifiedAt: Date.now() };

          // Cache in memory
          exclusionCache.set(cleanLocId, entry);

          // Cache in sessionStorage
          try {
            const storageKey = "homeflow:location-exclusion:" + cleanLocId;
            sessionStorage.setItem(storageKey, JSON.stringify(entry));
          } catch (e) {
            // Ignore storage errors
          }

          return result;
        }

        throw new Error("Invalid API payload structure");
      } catch (error) {
        console.warn("[GHL White Label Customizations] Location exclusion check failed for", cleanLocId, ":", error.message);

        // Fallback Priority 1: Use last-known valid result for SAME location (even if expired)
        const lastKnown = getStoredResult(cleanLocId);
        if (lastKnown && typeof lastKnown.value === "boolean") {
          return lastKnown.value;
        }

        // Fallback Priority 2: Fail open (false) if no previous valid result exists.
        // DO NOT write a new cache entry on failure.
        return false;
      } finally {
        // Always clean up timeout timer in finally block
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        inFlightRequests.delete(cleanLocId);
      }
    })();

    inFlightRequests.set(cleanLocId, fetchPromise);
    return await fetchPromise;
  }

  /* =========================================================
     3. SHARED ASYNC LOCATION RESOLVER
  ========================================================= */
  async function getLocationId() {
    // 1. Native HighLevel AppUtils API
    if (
      window.AppUtils &&
      window.AppUtils.Utilities &&
      typeof window.AppUtils.Utilities.getCurrentLocation === "function"
    ) {
      try {
        const loc = await window.AppUtils.Utilities.getCurrentLocation();
        if (typeof loc === "string" && loc.trim()) {
          return loc.trim();
        }
        if (loc && loc.id && typeof loc.id === "string") {
          return loc.id;
        }
        if (loc && loc.locationId && typeof loc.locationId === "string") {
          return loc.locationId;
        }
      } catch (e) {
        // Fall through
      }
    }

    // 2. Path Regex Fallback
    const pathMatch = window.location.pathname.match(
      /\/(?:v2\/)?location\/([A-Za-z0-9_-]+)/
    );
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1];
    }

    // 3. Search Params Fallback
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const queryLoc =
        searchParams.get("location_id") ||
        searchParams.get("location") ||
        searchParams.get("loc");
      if (queryLoc && queryLoc.trim()) {
        return queryLoc.trim();
      }
    } catch (e) {
      // Fall through
    }

    // 4. DOM Class Fallback
    try {
      const sidebarEl = document.querySelector('[class*="sidebar-v2-location"]');
      if (sidebarEl) {
        const classes = Array.from(sidebarEl.classList);
        for (let i = 0; i < classes.length; i++) {
          const cls = classes[i];
          if (cls !== "sidebar-v2-location" && cls.length >= 10) {
            return cls;
          }
        }
      }
    } catch (e) {
      // Fall through
    }

    return null;
  }

  /* =========================================================
     4. ROUTE CHECKS & HELPERS
  ========================================================= */
  function getCurrentTab() {
    try {
      return new URLSearchParams(window.location.search).get("tab");
    } catch (e) {
      return null;
    }
  }

  function isOverviewPage(pathname) {
    return pathname.includes("/reputation/overview");
  }

  function isReviewsPage(pathname) {
    return pathname.includes("/reputation/reviews");
  }

  function isWidgetPage(pathname) {
    return pathname.includes("/reputation/widget");
  }

  function isSocialPlannerPage(pathname) {
    return pathname.includes("/marketing/social-planner");
  }

  function isReputationSettingsPage(pathname) {
    return pathname.includes("/reputation/settings");
  }

  function isReputationIntegrationsPage(pathname, tab) {
    return isReputationSettingsPage(pathname) && tab === "reputationIntegrations";
  }

  function isReviewsAIPage(pathname, tab) {
    return isReputationSettingsPage(pathname) && tab === "reviewsAI";
  }

  function isConversationTemplatesPage(pathname) {
    return pathname.includes("/conversations/templates");
  }

  function isMarketingEmailsPage(pathname) {
    return pathname.includes("/marketing/emails");
  }

  /* =========================================================
     5. EFFICIENT DECLARATIVE STYLE MANAGEMENT
  ========================================================= */
  function ensureStyle(styleId, css, shouldExist) {
    const existing = document.getElementById(styleId);

    if (!shouldExist) {
      if (existing) existing.remove();
      return;
    }

    if (existing) {
      if (existing.innerHTML !== css) {
        existing.innerHTML = css;
      }
      return;
    }

    const style = document.createElement("style");
    style.id = styleId;
    style.innerHTML = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function removeStyle(styleId) {
    const element = document.getElementById(styleId);
    if (element) element.remove();
  }

  function removeAllLayouts() {
    ALL_STYLE_IDS.forEach(removeStyle);
  }

  /* =========================================================
     6. EXACT ORIGINAL CSS SELECTORS (100% PARITY)
  ========================================================= */
  function getSidebarGlobalCss(locId) {
    const locSelector = locId ? `.sidebar-v2-location.${locId}` : `.sidebar-v2-location`;
    return `
      /* ── MOVE CUSTOM LINKS UP ── */
      div#app div.sidebar-v2-location #sidebar-v2 div.hl_nav-header nav.w-full a[id='78ae8e45-8a17-4905-8a5e-ff819d60eed6'] {
        order: 4 !important;
      }
      div#app div.sidebar-v2-location #sidebar-v2 div.hl_nav-header nav.w-full a[id='77fece63-4fcd-40e0-be67-35132d26ebde'] {
        order: 4 !important;
      }

      /* ── HIDE SIDEBAR ITEMS ── */
      ${locSelector} #sb_import-data,
      ${locSelector} #sb_custom-values,
      ${locSelector} #sb_contacts,
      ${locSelector} #sb_manage-preferences,
      ${locSelector} #\\36 7d04f019b961eb53460bcdc {
        display: none !important;
      }
    `;
  }

  const REVIEWS_CSS = `
    /* Hide top header bar */
    header.hl_header,
    .hl_header,
    .hl-topbar {
      display: none !important;
    }

    /* Hide the reputation sub-menu tabs */
    .reputation-tabs,
    .hl_tab-nav,
    [class*="reputation"] > nav,
    .tab-navigation,
    .nav-tabs {
      display: none !important;
    }

    /* Hide Add Reviews button */
    #add-reviews-button {
      display: none !important;
    }

    /* Hide Send Review Request button */
    #send-review-request-button {
      display: none !important;
    }

    /* Full width layout */
    #app,
    .hl_wrapper,
    .hl_main,
    main {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      max-width: 100% !important;
    }
  `;

  const WIDGET_AND_SOCIAL_PLANNER_CSS = `
    /* Hide top header/menu bar */
    header.hl_header,
    .hl_header,
    .hl-topbar {
      display: none !important;
    }

    /* Specific selector for the top bar flex row */
    #app > div:nth-child(2) > div:nth-child(1) > div.flex.v2-open > div:nth-child(2) > header.hl_header > div.flex.flex-row {
      display: none !important;
    }

    /* Full width layout */
    #app,
    .hl_wrapper,
    .hl_main,
    main {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      max-width: 100% !important;
    }
  `;

  function getReputationSettingsCss(locId) {
    const locPrefix = locId ? `.sidebar-v2-location.${locId} ` : "";
    return `
      header.hl_header,
      .hl_header,
      .hl-topbar {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        min-height: 0 !important;
        max-height: 0 !important;
        overflow: hidden !important;
      }

      #app > div:nth-child(2) > div:nth-child(1) > div.flex.v2-open > div:nth-child(2) > header.hl_header > div.container-fluid.\\!justify-end,
      #app > div:nth-child(2) > div:nth-child(1) > div.flex.v2-open > div:nth-child(2) > header.hl_header > div.flex.flex-row,
      ${locPrefix}#app > div:nth-child(2) > div:nth-child(1) > div.flex.v2-open > div:nth-child(2) > header.hl_header > div.container-fluid.\\!justify-end,
      ${locPrefix}#app > div:nth-child(2) > div:nth-child(1) > div.flex.v2-open > div:nth-child(2) > header.hl_header > div.flex.flex-row {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        min-height: 0 !important;
        max-height: 0 !important;
        overflow: hidden !important;
      }

      #app > div:nth-child(2) > div:nth-child(1) > div.flex.v2-open > div:nth-child(2) {
        padding-top: 0 !important;
        margin-top: 0 !important;
      }

      #reputation-settings-container > div.hr-wrapper-container.reputationApp > div.hr-config-provider.font-sans > div.flex.min-h-0 > div.hr-tabs.hr-tabs--bar-type > div.hr-tabs-nav--bar-type.hr-tabs-nav--left > div.hr-tabs-nav-scroll-wrapper > div.hr-tabs-nav-y-scroll > div.hr-tabs-nav-scroll-content,
      ${locPrefix}#reputation-settings-container > div.hr-wrapper-container.reputationApp > div.hr-config-provider.font-sans > div.flex.min-h-0 > div.hr-tabs.hr-tabs--bar-type > div.hr-tabs-nav--bar-type.hr-tabs-nav--left > div.hr-tabs-nav-scroll-wrapper > div.hr-tabs-nav-y-scroll > div.hr-tabs-nav-scroll-content {
        display: none !important;
        visibility: hidden !important;
        width: 0 !important;
        min-width: 0 !important;
        max-width: 0 !important;
        overflow: hidden !important;
      }

      #reputation-settings-container .hr-tabs-nav--left,
      #reputation-settings-container .hr-tabs-nav-scroll-wrapper,
      #reputation-settings-container .hr-tabs-nav-y-scroll {
        display: none !important;
        visibility: hidden !important;
        width: 0 !important;
        min-width: 0 !important;
        max-width: 0 !important;
        overflow: hidden !important;
      }

      #reputation-settings-container > div.hr-wrapper-container.reputationApp > div.hr-config-provider.font-sans > div.flex.min-h-0 > div.hr-tabs.hr-tabs--bar-type,
      ${locPrefix}#reputation-settings-container > div.hr-wrapper-container.reputationApp > div.hr-config-provider.font-sans > div.flex.min-h-0 > div.hr-tabs.hr-tabs--bar-type {
        width: 100% !important;
      }

      #reputation-settings-container .hr-tabs-content-holder,
      ${locPrefix}#reputation-settings-container .hr-tabs-content-holder {
        margin-left: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
      }
    `;
  }

  const HOMEFLOW_CSS = `
    header.hl_header,
    .hl_header,
    .hl-topbar {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      min-height: 0 !important;
      max-height: 0 !important;
      overflow: hidden !important;
    }

    #app > div:nth-child(2) > div:nth-child(1) > div.flex.v2-open > div:nth-child(2) > header.hl_header > div.flex.flex-row {
      display: none !important;
    }

    #app > div:nth-child(2) > div:nth-child(1) > div.flex.v2-open > div:nth-child(2) {
      margin-top: 0 !important;
      padding-top: 0 !important;
    }
  `;

  /* =========================================================
     7. REPUTATION OVERVIEW REDIRECT
  ========================================================= */
  async function redirectToReviews(state) {
    if (!state.isExcluded || !state.locationId || !state.isOverviewPage) {
      return;
    }

    const reviewsPath = `/v2/location/${state.locationId}/reputation/reviews`;

    if (window.location.pathname === reviewsPath) {
      return;
    }

    // Try HighLevel official RouteHelper first
    try {
      if (
        window.AppUtils &&
        window.AppUtils.RouteHelper &&
        typeof window.AppUtils.RouteHelper.navigate === "function"
      ) {
        await window.AppUtils.RouteHelper.navigate({
          path: reviewsPath,
          replace: true
        });
        return;
      }
    } catch (e) {
      // Fall back to history replacement
    }

    window.history.replaceState(null, "", reviewsPath);
    window.dispatchEvent(new PopStateEvent("popstate"));

    setTimeout(function () {
      if (window.location.pathname.includes("/reputation/overview")) {
        window.location.href = reviewsPath;
      }
    }, 300);
  }

  /* =========================================================
     8. STATE CALCULATOR & APPLIER
  ========================================================= */
  async function buildState() {
    const locationId = await getLocationId();
    const pathname = window.location.pathname;
    const tab = getCurrentTab();

    const isExcluded = locationId ? await isLocationExcluded(locationId) : false;

    return {
      url: window.location.href,
      pathname,
      tab,
      locationId,
      isExcluded,
      isOverviewPage: isOverviewPage(pathname),
      isReviewsPage: isReviewsPage(pathname),
      isWidgetPage: isWidgetPage(pathname),
      isSocialPlannerPage: isSocialPlannerPage(pathname),
      isReputationIntegrationsPage: isReputationIntegrationsPage(pathname, tab),
      isReviewsAIPage: isReviewsAIPage(pathname, tab),
      isHomeFlowTemplatesPage: locationId === HOMEFLOW_LOCATION_ID && isConversationTemplatesPage(pathname),
      isHomeFlowEmailsPage: locationId === HOMEFLOW_LOCATION_ID && isMarketingEmailsPage(pathname)
    };
  }

  function getStateKey(state) {
    return [
      state.url,
      state.locationId || "unresolved",
      state.isExcluded,
      state.isOverviewPage,
      state.isReviewsPage,
      state.isWidgetPage,
      state.isSocialPlannerPage,
      state.isReputationIntegrationsPage,
      state.isReviewsAIPage,
      state.isHomeFlowTemplatesPage,
      state.isHomeFlowEmailsPage
    ].join("|");
  }

  async function applyState(state) {
    // Not found in either Supabase project: preserve default,
    // unmodified GHL behavior (original Contacts tab visible).
    if (!state.isExcluded) {
      removeAllLayouts();
      return;
    }

    if (state.isOverviewPage) {
      removeAllLayouts();
      await redirectToReviews(state);
      return;
    }

    // Apply the full customization suite (including hiding the Contacts tab)
    // only for locations found in Supabase.
    ensureStyle(STYLE_IDS.SIDEBAR, getSidebarGlobalCss(state.locationId), true);

    // Page-specific layouts
    ensureStyle(STYLE_IDS.REVIEWS, REVIEWS_CSS, state.isReviewsPage);
    ensureStyle(STYLE_IDS.WIDGET, WIDGET_AND_SOCIAL_PLANNER_CSS, state.isWidgetPage);
    ensureStyle(STYLE_IDS.SOCIAL_PLANNER, WIDGET_AND_SOCIAL_PLANNER_CSS, state.isSocialPlannerPage);
    ensureStyle(STYLE_IDS.REPUTATION_INTEGRATIONS, getReputationSettingsCss(state.locationId), state.isReputationIntegrationsPage);
    ensureStyle(STYLE_IDS.REVIEWS_AI, getReputationSettingsCss(state.locationId), state.isReviewsAIPage);
    ensureStyle(STYLE_IDS.HOMEFLOW, HOMEFLOW_CSS, state.isHomeFlowTemplatesPage || state.isHomeFlowEmailsPage);
  }

  /* =========================================================
     9. CENTRAL ASYNC CONTROLLER & SELF-HEALING RUNNER
  ========================================================= */
  let running = false;
  let rerunRequested = false;
  let runSequence = 0;
  let lastAppliedStateKey = null;
  let activeRunUrl = null;

  function invalidateIfContextChanged() {
    const currentUrl = window.location.href;
    if (activeRunUrl && currentUrl !== activeRunUrl) {
      runSequence++;
      activeRunUrl = currentUrl;
    }
  }

  async function run() {
    if (running) {
      invalidateIfContextChanged();
      rerunRequested = true;
      return;
    }

    running = true;
    activeRunUrl = window.location.href;
    const thisRun = ++runSequence;

    try {
      const state = await buildState();

      // Immediate check: If runSequence changed while awaiting buildState(), discard this run immediately!
      if (thisRun !== runSequence) {
        return;
      }

      const stateKey = getStateKey(state);

      // Only skip if location was resolved AND state key matches exactly
      if (state.locationId && stateKey === lastAppliedStateKey) {
        return;
      }

      await applyState(state);

      if (thisRun === runSequence && state.locationId) {
        lastAppliedStateKey = stateKey;
      }
    } catch (error) {
      console.error("[GHL White Label Customizations] Runtime error:", error);
    } finally {
      running = false;

      if (rerunRequested) {
        rerunRequested = false;
        scheduleRun();
      }
    }
  }

  let scheduled = false;
  function scheduleRun() {
    invalidateIfContextChanged();

    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(function () {
      scheduled = false;
      run();
    });
  }

  /* =========================================================
     10. MULTI-LAYER EXECUTION & DOM LISTENERS
  ========================================================= */

  // Synchronous immediate run
  scheduleRun();

  // HighLevel lifecycle events
  window.addEventListener("routeLoaded", scheduleRun);
  window.addEventListener("routeChangeEvent", scheduleRun);
  window.addEventListener("popstate", scheduleRun);

  // Single History API wrapper
  const origPush = history.pushState;
  const origReplace = history.replaceState;

  if (typeof origPush === "function") {
    history.pushState = function () {
      const res = origPush.apply(this, arguments);
      scheduleRun();
      return res;
    };
  }

  if (typeof origReplace === "function") {
    history.replaceState = function () {
      const res = origReplace.apply(this, arguments);
      scheduleRun();
      return res;
    };
  }

  // Single MutationObserver for DOM changes & URL changes
  let lastObservedUrl = window.location.href;
  let observerStarted = false;

  function startObserver() {
    if (observerStarted || !document.body) return;
    observerStarted = true;

    const observer = new MutationObserver(function () {
      const currentUrl = window.location.href;
      if (currentUrl !== lastObservedUrl || !lastAppliedStateKey) {
        lastObservedUrl = currentUrl;
        scheduleRun();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      startObserver();
      scheduleRun();
    }, { once: true });
  } else {
    startObserver();
    scheduleRun();
  }

  window.addEventListener("load", function () {
    startObserver();
    scheduleRun();
  }, { once: true });

  // Self-healing 250ms polling loop (checks URL or un-resolved state)
  setInterval(function () {
    const currentUrl = window.location.href;
    if (currentUrl !== lastObservedUrl || !lastAppliedStateKey) {
      lastObservedUrl = currentUrl;
      scheduleRun();
    }
  }, 250);

})();
