/* =====================================================================
   DB LAYER — Tatami Control
   Penyimpanan lokal per-akun: data disimpan di localStorage dan tersinkron
   antar-tab/window lewat BroadcastChannel + event "storage".
   SEMUA data di-namespace per akun (mis. tc_rizki_match_<code>), jadi akun
   yang berbeda di perangkat yang sama TIDAK saling melihat/menimpa.
   Akun terikat ke jendela/tab-group (sessionStorage): jendela display yang
   dibuka dari kontrol mewarisi akun yang sama.
   Semua modul lain (app.js) HANYA bicara lewat fungsi-fungsi objek TCDB,
   jadi kalau nanti mau pindah ke backend sungguhan cukup tulis ulang file ini.
   ===================================================================== */

var TCDB = (function () {
  "use strict";

  var CHANNEL_NAME = "tc_sync_channel";
  var channel = null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch (e) {
    channel = null;
  }

  /* ---- Akun aktif (pemisahan data per akun) ---- */
  var ACCOUNT_KEY = "tc_account";
  var account = "";
  try { account = sessionStorage.getItem(ACCOUNT_KEY) || ""; } catch (e) { account = ""; }

  function bindAccount(username) {
    var name = String(username || "").trim().toLowerCase();
    if (name === account) return;
    var prev = account;
    account = name;
    try {
      if (name) sessionStorage.setItem(ACCOUNT_KEY, name);
      else sessionStorage.removeItem(ACCOUNT_KEY);
    } catch (e) {}
    // Data lama (tanpa akun) dipindahkan SEKALI ke akun "admin" (akun yang
    // dulu membuatnya) supaya tidak hilang; akun lain mulai bersih.
    if (prev === "" && name === "admin" && !legacyMigrated()) migrateLegacyTo(name);
  }
  function currentAccount() { return account; }

  function ns(base) {
    return account ? "tc_" + account + "_" + base.slice(3) : base;
  }

  /* ---- Migrasi data lama (tanpa akun) ke namespace "admin" ---- */
  var LEGACY_FLAG_KEY = "tc_legacy_migrated_to";
  function legacyMigrated() {
    try { return !!localStorage.getItem(LEGACY_FLAG_KEY); } catch (e) { return false; }
  }
  function migrateLegacyTo(name) {
    try {
      var copied = false;
      var idx = localStorage.getItem("tc_tournament_index");
      if (idx) {
        localStorage.setItem("tc_" + name + "_tournament_index", idx);
        var list = JSON.parse(idx) || [];
        list.forEach(function (id) {
          if (!id) return;
          var t = localStorage.getItem("tc_tournament_" + id);
          if (t) { localStorage.setItem("tc_" + name + "_tournament_" + id, t); localStorage.removeItem("tc_tournament_" + id); }
        });
        localStorage.removeItem("tc_tournament_index");
        copied = true;
      }
      var leg = localStorage.getItem("tc_tournament");
      if (leg) { localStorage.setItem("tc_" + name + "_tournament", leg); localStorage.removeItem("tc_tournament"); copied = true; }
      var eidx = localStorage.getItem("tc_event_index");
      if (eidx) {
        localStorage.setItem("tc_" + name + "_event_index", eidx);
        var elist = JSON.parse(eidx) || [];
        elist.forEach(function (id) {
          if (!id) return;
          var ev = localStorage.getItem("tc_event_" + id);
          if (ev) { localStorage.setItem("tc_" + name + "_event_" + id, ev); localStorage.removeItem("tc_event_" + id); }
        });
        localStorage.removeItem("tc_event_index");
        copied = true;
      }
      var banner = localStorage.getItem("tc_banner");
      if (banner) { localStorage.setItem("tc_" + name + "_banner", banner); localStorage.removeItem("tc_banner"); copied = true; }
      var active = localStorage.getItem("tc_active_match");
      if (active) { localStorage.setItem("tc_" + name + "_active_match", active); localStorage.removeItem("tc_active_match"); copied = true; }
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.forEach(function (k) {
        if (k && /^tc_match_[A-Z2-9]{4}$/.test(k)) {
          var v = localStorage.getItem(k);
          if (v) { localStorage.setItem("tc_" + name + "_" + k.slice(3), v); localStorage.removeItem(k); }
        }
      });
      if (copied) localStorage.setItem(LEGACY_FLAG_KEY, name);
    } catch (e) {}
  }

  /* ---- broadcast antar-tab (hanya untuk akun yang sama) ---- */
  function broadcast(data) {
    if (!channel) return;
    try { channel.postMessage(Object.assign({ account: account }, data)); } catch (e) {}
  }
  function isForMe(data) {
    return !!(data && data.account === account);
  }

  /* ---- konversi aman ----
     Supaya format data konsisten (dan nilai kata yang belum diisi tidak
     hilang), nilai kosong pada array skor kata disimpan sebagai sentinel
     angka -1. */
  function encodeForSave(match) {
    var m = JSON.parse(JSON.stringify(match));
    ["aka", "ao"].forEach(function (side) {
      if (m[side] && Array.isArray(m[side].scores)) {
        m[side].scores = m[side].scores.map(function (v) {
          return v === null || v === undefined || v === "" ? -1 : v;
        });
      }
    });
    return m;
  }
  function decodeAfterLoad(match) {
    if (!match) return match;
    ["aka", "ao"].forEach(function (side) {
      if (match[side] && match[side].scores) {
        var raw = match[side].scores;
        var len = match.judgesCount || (Array.isArray(raw) ? raw.length : Object.keys(raw).length);
        var arr = [];
        for (var i = 0; i < len; i++) {
          var v = Array.isArray(raw) ? raw[i] : raw[i];
          arr.push(v === undefined || v === null || v === -1 ? null : v);
        }
        match[side].scores = arr;
      }
    });
    return match;
  }

  function matchKey(code) { return ns("tc_match_") + code; }

  function readMatch(code) {
    try {
      var raw = localStorage.getItem(matchKey(code));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("readMatch failed", e);
      return null;
    }
  }

  function saveMatch(match) {
    try {
      match.updatedAt = Date.now();
      localStorage.setItem(matchKey(match.code), JSON.stringify(encodeForSave(match)));
      broadcast({ code: match.code, updatedAt: match.updatedAt });
      return Promise.resolve(true);
    } catch (e) {
      console.error("saveMatch failed", e);
      return Promise.resolve(false);
    }
  }

  function loadMatch(code) {
    return Promise.resolve(decodeAfterLoad(readMatch(code)));
  }

  /* realtime subscription antar-tab — dipakai oleh control & display
     supaya skor tersinkron tanpa polling. Mengembalikan fungsi unsubscribe. */
  function subscribeMatch(code, cb) {
    function notify() {
      cb(decodeAfterLoad(readMatch(code)));
    }
    function onStorage(e) {
      if (e.key === matchKey(code)) notify();
    }
    window.addEventListener("storage", onStorage);
    var onMessage = function (e) {
      if (isForMe(e.data) && e.data.code === code) notify();
    };
    if (channel) channel.addEventListener("message", onMessage);
    return function () {
      window.removeEventListener("storage", onStorage);
      if (channel) channel.removeEventListener("message", onMessage);
    };
  }

  function watchConnection(cb) {
    cb(true);
  }

  /* ---- Banner turnamen (ditampilkan di TV saat pertandingan selesai) ---- */
  function bannerKey() { return ns("tc_banner"); }
  function saveBanner(dataUrl) {
    try {
      localStorage.setItem(bannerKey(), dataUrl);
      broadcast({ banner: dataUrl });
      return true;
    } catch (e) {
      console.error("saveBanner failed", e);
      return false;
    }
  }
  function loadBanner() {
    try { return localStorage.getItem(bannerKey()) || ""; } catch (e) { return ""; }
  }
  function clearBanner() {
    try {
      localStorage.removeItem(bannerKey());
      broadcast({ banner: "" });
    } catch (e) {}
  }

  /* ---- Turnamen / Bagan ----
     BISA LEBIH DARI SATU turnamen/bagan per akun (mis. 10+ bagan dalam satu
     hari). Tiap turnamen disimpan di key sendiri (tc_<akun>_tournament_<id>),
     dan daftar id-nya disimpan di index (tc_<akun>_tournament_index) supaya
     bisa ditampilkan sebagai daftar bagan. Bagan disimpan apa adanya (peserta
     + pemenang + kode live score); struktur ronde diturunkan. */
  function tournamentPrefix() { return ns("tc_tournament_"); }
  function tournamentIndexKey() { return ns("tc_tournament_index"); }
  function legacyTournamentKey() { return ns("tc_tournament"); }

  function readIndex() {
    try {
      var raw = localStorage.getItem(tournamentIndexKey());
      var idx = raw ? JSON.parse(raw) : [];
      return Array.isArray(idx) ? idx : [];
    } catch (e) {
      return [];
    }
  }
  function writeIndex(idx) {
    try { localStorage.setItem(tournamentIndexKey(), JSON.stringify(idx)); } catch (e) {}
  }

  function migrateLegacyTournament() {
    try {
      var raw = localStorage.getItem(legacyTournamentKey());
      if (!raw) return;
      var t = JSON.parse(raw);
      if (t && t.id) {
        localStorage.setItem(tournamentPrefix() + t.id, JSON.stringify(t));
        var idx = readIndex();
        if (idx.indexOf(t.id) === -1) {
          idx.unshift(t.id);
          writeIndex(idx);
        }
      }
      localStorage.removeItem(legacyTournamentKey());
    } catch (e) {}
  }

  function saveTournament(t) {
    try {
      t.updatedAt = Date.now();
      localStorage.setItem(tournamentPrefix() + t.id, JSON.stringify(t));
      var idx = readIndex();
      if (idx.indexOf(t.id) === -1) {
        idx.unshift(t.id);
        writeIndex(idx);
      }
      broadcast({ tournament: Date.now(), tournamentId: t.id });
      return true;
    } catch (e) {
      console.error("saveTournament failed", e);
      return false;
    }
  }
  function loadTournament(id) {
    migrateLegacyTournament();
    if (!id) return null;
    try {
      var raw = localStorage.getItem(tournamentPrefix() + id);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  /* Daftar SEMUA turnamen/bagan yang pernah dibuat untuk akun ini, terbaru
     duluan — dipakai untuk halaman "Semua Bagan". */
  function listTournaments() {
    migrateLegacyTournament();
    var idx = readIndex();
    var out = [];
    idx.forEach(function (id) {
      var t = loadTournament(id);
      if (t) out.push(t);
    });
    out.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return out;
  }
  function clearTournament(id) {
    try {
      if (!id) return;
      localStorage.removeItem(tournamentPrefix() + id);
      var idx = readIndex().filter(function (x) { return x !== id; });
      writeIndex(idx);
      broadcast({ tournament: Date.now(), tournamentId: id, deleted: true });
    } catch (e) {}
  }

  /* realtime subscription untuk perubahan turnamen/bagan — dipakai oleh
     view "bagan"/"baganList" supaya pemenang & daftar bagan terbaru langsung
     tampil tanpa refresh. */
  function subscribeTournament(cb) {
    function onStorage(e) {
      if (!e.key) return;
      if (e.key.indexOf(tournamentPrefix()) === 0 || e.key === tournamentIndexKey()) cb();
    }
    window.addEventListener("storage", onStorage);
    var onMessage = function (e) {
      if (isForMe(e.data) && e.data.tournament) cb();
    };
    if (channel) channel.addEventListener("message", onMessage);
    return function () {
      window.removeEventListener("storage", onStorage);
      if (channel) channel.removeEventListener("message", onMessage);
    };
  }

  /* ---- Kejuaraan / Event ----
     1 kejuaraan = wadah yang menampung 30+ bagan kategori. Kejuaraan hanya
     menyimpan identitas (nama/venue/tanggal); bagan di dalamnya tetap
     disimpan seperti biasa dan mencatat eventId masing-masing. Daftar id
     kejuaraan disimpan di index terpisah (tc_<akun>_event_index). */
  function eventPrefix() { return ns("tc_event_"); }
  function eventIndexKey() { return ns("tc_event_index"); }

  function readEventIndex() {
    try {
      var raw = localStorage.getItem(eventIndexKey());
      var idx = raw ? JSON.parse(raw) : [];
      return Array.isArray(idx) ? idx : [];
    } catch (e) {
      return [];
    }
  }
  function writeEventIndex(idx) {
    try { localStorage.setItem(eventIndexKey(), JSON.stringify(idx)); } catch (e) {}
  }

  function saveEvent(ev) {
    try {
      ev.updatedAt = Date.now();
      localStorage.setItem(eventPrefix() + ev.id, JSON.stringify(ev));
      var idx = readEventIndex();
      if (idx.indexOf(ev.id) === -1) {
        idx.unshift(ev.id);
        writeEventIndex(idx);
      }
      broadcast({ event: Date.now(), eventId: ev.id });
      return true;
    } catch (e) {
      console.error("saveEvent failed", e);
      return false;
    }
  }
  function loadEvent(id) {
    if (!id) return null;
    try {
      var raw = localStorage.getItem(eventPrefix() + id);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function listEvents() {
    var idx = readEventIndex();
    var out = [];
    idx.forEach(function (id) {
      var ev = loadEvent(id);
      if (ev) out.push(ev);
    });
    out.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return out;
  }
  function clearEvent(id) {
    try {
      if (!id) return;
      localStorage.removeItem(eventPrefix() + id);
      var idx = readEventIndex().filter(function (x) { return x !== id; });
      writeEventIndex(idx);
      broadcast({ event: Date.now(), eventId: id, deleted: true });
    } catch (e) {}
  }
  function subscribeEvents(cb) {
    function onStorage(e) {
      if (!e.key) return;
      if (e.key.indexOf(eventPrefix()) === 0 || e.key === eventIndexKey()) cb();
    }
    window.addEventListener("storage", onStorage);
    var onMessage = function (e) {
      if (isForMe(e.data) && e.data.event) cb();
    };
    if (channel) channel.addEventListener("message", onMessage);
    return function () {
      window.removeEventListener("storage", onStorage);
      if (channel) channel.removeEventListener("message", onMessage);
    };
  }

  function deleteMatch(code) {
    try { localStorage.removeItem(matchKey(code)); return true; } catch (e) { return false; }
  }

  /* ---- Pertandingan aktif ----
     Menyimpan kode pertandingan yang sedang "dibuka" oleh wasit/juri/admin
     untuk AKUN INI. Layar skor (display) akun yang sama berlangganan nilai
     ini supaya otomatis pindah mengikuti pertandingan berikutnya — tanpa
     memasukkan kode lagi. Akun lain tidak terpengaruh. */
  function activeKey() { return ns("tc_active_match"); }
  function saveActiveMatch(code) {
    try {
      localStorage.setItem(activeKey(), code || "");
      broadcast({ activeMatch: code || "" });
      return true;
    } catch (e) {
      console.error("saveActiveMatch failed", e);
      return false;
    }
  }
  function loadActiveMatch() {
    try { return localStorage.getItem(activeKey()) || ""; } catch (e) { return ""; }
  }
  function subscribeActiveMatch(cb) {
    function onStorage(e) {
      if (e.key === activeKey()) cb(loadActiveMatch());
    }
    window.addEventListener("storage", onStorage);
    var onMessage = function (e) {
      if (isForMe(e.data) && typeof e.data.activeMatch === "string") cb(e.data.activeMatch);
    };
    if (channel) channel.addEventListener("message", onMessage);
    return function () {
      window.removeEventListener("storage", onStorage);
      if (channel) channel.removeEventListener("message", onMessage);
    };
  }

  /* Sesi per-tab/akun (sessionStorage) supaya jendela kontrol & layar skor
     masing-masing mengingat perannya sendiri, tidak saling menimpa, dan
     terpisah antar akun. */
  function lastSessionKey() { return ns("tc_last_session"); }
  function saveLastSession(obj) {
    try {
      sessionStorage.setItem(lastSessionKey(), JSON.stringify(obj));
    } catch (e) {}
  }
  function loadLastSession() {
    try {
      var raw = sessionStorage.getItem(lastSessionKey());
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function clearLastSession() {
    try {
      sessionStorage.removeItem(lastSessionKey());
    } catch (e) {}
  }

  return {
    bindAccount: bindAccount,
    currentAccount: currentAccount,
    saveMatch: saveMatch,
    loadMatch: loadMatch,
    subscribeMatch: subscribeMatch,
    watchConnection: watchConnection,
    saveLastSession: saveLastSession,
    loadLastSession: loadLastSession,
    clearLastSession: clearLastSession,
    saveBanner: saveBanner,
    loadBanner: loadBanner,
    clearBanner: clearBanner,
    saveTournament: saveTournament,
    loadTournament: loadTournament,
    listTournaments: listTournaments,
    clearTournament: clearTournament,
    subscribeTournament: subscribeTournament,
    saveEvent: saveEvent,
    loadEvent: loadEvent,
    listEvents: listEvents,
    clearEvent: clearEvent,
    subscribeEvents: subscribeEvents,
    saveActiveMatch: saveActiveMatch,
    loadActiveMatch: loadActiveMatch,
    subscribeActiveMatch: subscribeActiveMatch,
    deleteMatch: deleteMatch,
    isConfigPlaceholder: false
  };
})();
