/* =====================================================================
   PWA — Tatami Control
   Registrasi service worker + tombol "Install App" (beforeinstallprompt).
   ===================================================================== */

var TCPWA = (function () {
  "use strict";

  var deferredPrompt = null;
  var installBtnEls = [];
  var dismissedKey = "tc_install_dismissed";

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("./service-worker.js").catch(function (e) {
          console.warn("SW register gagal:", e);
        });
        setupUpdateNotifier();
      });
    }
  }

  // Munculkan bar "Versi baru — Muat Ulang" saat service worker baru menggantikan
  // yang lama (aplikasi sudah terunduh versi baru, tinggal dimuat ulang).
  function setupUpdateNotifier() {
    if (!("serviceWorker" in navigator)) return;
    var showed = false;
    function show() {
      if (showed) return;
      showed = true;
      var bar = document.createElement("div");
      bar.className = "tc-update-bar";
      var span = document.createElement("span");
      span.textContent = "Versi baru aplikasi tersedia.";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Muat Ulang";
      btn.onclick = function () { window.location.reload(); };
      bar.appendChild(span);
      bar.appendChild(btn);
      document.body.appendChild(bar);
    }
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      setTimeout(show, 300);
    });
  }

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function isDismissed() {
    try {
      return localStorage.getItem(dismissedKey) === "1";
    } catch (e) {
      return false;
    }
  }
  function setDismissed() {
    try {
      localStorage.setItem(dismissedKey, "1");
    } catch (e) {}
  }

  function onCanInstall(cb) {
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      if (!isStandalone() && !isDismissed()) cb(true);
    });
    window.addEventListener("appinstalled", function () {
      deferredPrompt = null;
      cb(false);
    });
  }

  function promptInstall() {
    if (!deferredPrompt) return Promise.resolve(false);
    deferredPrompt.prompt();
    return deferredPrompt.userChoice.then(function (choice) {
      deferredPrompt = null;
      return choice.outcome === "accepted";
    });
  }

  function dismiss() {
    setDismissed();
  }

  return {
    registerServiceWorker: registerServiceWorker,
    setupUpdateNotifier: setupUpdateNotifier,
    isStandalone: isStandalone,
    onCanInstall: onCanInstall,
    promptInstall: promptInstall,
    dismiss: dismiss
  };
})();
