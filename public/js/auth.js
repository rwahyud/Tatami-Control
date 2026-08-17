/* =====================================================================
   AUTH — Tatami Control
   Login + role admin/pengguna. Akun tersimpan di Cloudflare Workers + D1
   (server), bukan lagi localStorage, sehingga akun TIDAK hilang saat ganti
   browser/perangkat/clear storage. API TCAuth tetap dibungkus supaya mudah
   ditukar: fungsi yang menyentuh server mengembalikan Promise ({ok,...}),
   fungsi baca sesi (currentUser/isAdmin) tetap sinkron.
   Sesi login disimpan di sessionStorage (per jendela/tab-group): jendela
   layar skor yang dibuka dari kontrol mewarisi sesi yang sama, dan akun yang
   berbeda (di jendela berbeda di perangkat yang sama) tidak saling menimpa.
   Mode offline: kalau server tidak terjangkau, sesi yang sudah login tetap
   dipakai (relevan untuk venue tanpa internet).
   ===================================================================== */

var TCAuth = (function () {
  "use strict";

  var AUTH_URL = CONFIG.AUTH_URL;
  var TOKEN_KEY = "tc_token";
  var USER_KEY = "tc_user";

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }

  function saveSession(token, user) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
      if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      else sessionStorage.removeItem(USER_KEY);
    } catch (e) {}
  }

  function currentUser() {
    try {
      var raw = sessionStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function isAdmin() {
    var u = currentUser();
    return !!(u && u.role === "admin");
  }

  function api(path, opts) {
    var headers = { "Content-Type": "application/json" };
    var token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    var cfg = { method: (opts && opts.method) || "GET", headers: headers };
    if (opts && opts.body) cfg.body = JSON.stringify(opts.body);
    return fetch(AUTH_URL + path, cfg).then(function (res) {
      return res.json().then(function (data) {
        return { status: res.status, data: data };
      });
    });
  }

  function login(username, password) {
    return api("/auth/login", { method: "POST", body: { username: username, password: password } }).then(
      function (r) {
        if (r.status !== 200) {
          return { ok: false, error: (r.data && r.data.error) || "Username atau password salah." };
        }
        saveSession(r.data.token, r.data.user);
        return { ok: true, user: r.data.user };
      }
    );
  }

  function logout() {
    var token = getToken();
    saveSession(null, null);
    if (token) {
      // Best-effort hapus sesi di server; tidak memblokir logout.
      fetch(AUTH_URL + "/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: "{}"
      }).catch(function () {});
    }
    return Promise.resolve({ ok: true });
  }

  // Validasi sesi tersimpan ke server. Kalau server menolak (401) sesi
  // dibersihkan. Kalau server tidak terjangkau, sesi cache tetap dipakai
  // (offline). Tambahan field offline = true pada hasil mode itu.
  function refresh() {
    var token = getToken();
    var cached = currentUser();
    if (!token) return Promise.resolve({ ok: false, error: "Belum login." });
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    return fetch(AUTH_URL + "/auth/me", {
      headers: { Authorization: "Bearer " + token },
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (res.status === 200) {
          return res.json().then(function (d) {
            saveSession(token, d.user);
            return { ok: true, user: d.user };
          });
        }
        saveSession(null, null);
        return { ok: false, error: "Sesi tidak valid." };
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        if (cached) return { ok: true, user: cached, offline: true };
        saveSession(null, null);
        return { ok: false, error: "Server tidak terjangkau." };
      });
  }

  function listUsers() {
    return api("/auth/users").then(function (r) {
      if (r.status !== 200) return { ok: false, error: (r.data && r.data.error) || "Gagal memuat daftar akun." };
      return { ok: true, users: r.data.users };
    });
  }

  function createUser(username, password) {
    return api("/auth/create", { method: "POST", body: { username: username, password: password } }).then(function (r) {
      if (r.status !== 200) return { ok: false, error: (r.data && r.data.error) || "Gagal membuat akun." };
      return { ok: true };
    });
  }

  function deleteUser(username) {
    return api("/auth/delete", { method: "POST", body: { username: username } }).then(function (r) {
      if (r.status !== 200) return { ok: false, error: (r.data && r.data.error) || "Gagal menghapus akun." };
      return { ok: true };
    });
  }

  function resetPassword(username, newPassword) {
    return api("/auth/reset", { method: "POST", body: { username: username, newPassword: newPassword } }).then(function (r) {
      if (r.status !== 200) return { ok: false, error: (r.data && r.data.error) || "Gagal mereset password." };
      return { ok: true };
    });
  }

  return {
    login: login,
    currentUser: currentUser,
    logout: logout,
    isAdmin: isAdmin,
    refresh: refresh,
    listUsers: listUsers,
    createUser: createUser,
    deleteUser: deleteUser,
    resetPassword: resetPassword
  };
})();
