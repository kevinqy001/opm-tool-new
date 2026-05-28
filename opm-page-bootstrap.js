/**
 * Runs OpmDataStore.preloadForCurrentPage() on every page that includes this script.
 */
(function () {
  function start() {
    if (!window.OpmDataStore) {
      console.warn("[OPM] OpmDataStore not loaded — skip preload.");
      return;
    }
    window.OpmDataStore.preloadForCurrentPage().catch((err) => {
      console.error("[OPM] Preload failed:", err);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
