// ypok-auth — autentikasi akun Tatami Control (Cloudflare Workers + D1)
// Endpoint:
//   POST /auth/login     {username, password}                 -> {token, user}
//   POST /auth/register  {username, password, payment_order_id} -> {ok} (public, setelah bayar)
//   GET  /auth/me        (Bearer token)                       -> {user}
//   POST /auth/logout    (Bearer token)                       -> {ok}
//   GET  /auth/users     (Bearer admin)                       -> {users}
//   POST /auth/create    (Bearer admin) {username,password}   -> {ok}
//   POST /auth/reset     (Bearer admin) {username,newPassword} -> {ok}
//   POST /auth/delete    (Bearer admin) {username}            -> {ok}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });

const DAY = 86400000;
const SESSION_TTL = 30 * DAY;

// ---------- PBKDF2 password hashing ----------
function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBytes(hexStr) {
  const out = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hexStr.substr(i * 2, 2), 16);
  return out;
}

async function deriveKey(password, saltBuf) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBuf, iterations: 100000, hash: "SHA-256" },
    key,
    256
  );
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveKey(password, salt);
  return "pbkdf2$100000$" + hex(salt) + "$" + hex(bits);
}

async function verifyPassword(password, stored) {
  try {
    const parts = String(stored || "").split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const bits = await deriveKey(password, hexToBytes(parts[2]));
    const computed = hex(bits);
    if (computed.length !== parts[3].length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ parts[3].charCodeAt(i);
    return diff === 0;
  } catch (e) {
    return false;
  }
}

function randToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

function invalidToken(body) {
  return json(Object.assign({ ok: false, error: "Sesi tidak valid atau kedaluwarsa." }, body || {}), 401);
}

async function readBody(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}

// ---------- Session / current user ----------
async function currentUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const row = await env.tc_auth
    .prepare(
      "SELECT u.username AS username, u.role AS role FROM sessions s JOIN users u ON u.username = s.username WHERE s.token = ?1 AND s.expires_at > ?2"
    )
    .bind(token, Date.now())
    .first();
  if (!row) return null;
  return { token, username: row.username, role: row.role };
}

async function createSession(env, username) {
  const token = randToken();
  await env.tc_auth
    .prepare("INSERT INTO sessions (token, username, expires_at) VALUES (?1, ?2, ?3)")
    .bind(token, username, Date.now() + SESSION_TTL)
    .run();
  return token;
}

// ---------- Endpoint handlers ----------

// Register akun baru setelah pembayaran sukses (public, tanpa auth)
async function handleRegister(request, env) {
  const body = await readBody(request);
  if (!body) return json({ ok: false, error: "Body tidak valid." }, 400);
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const paymentOrderId = String(body.payment_order_id || "").trim();

  if (!/^[a-z0-9_.-]{3,20}$/.test(username))
    return json({ ok: false, error: "Username 3-20 karakter (huruf kecil, angka, _ . -)." }, 400);
  if (password.length < 4) return json({ ok: false, error: "Password minimal 4 karakter." }, 400);
  if (!paymentOrderId) return json({ ok: false, error: "Payment order ID wajib diisi." }, 400);

  // Cek apakah username sudah dipakai
  const exists = await env.tc_auth.prepare("SELECT username FROM users WHERE username = ?1").bind(username).first();
  if (exists) return json({ ok: false, error: "Username \"" + username + "\" sudah dipakai." }, 409);

  // Cek apakah payment valid dan status = 'paid'
  const payment = await env.tc_auth
    .prepare("SELECT order_id, status, username AS paid_username FROM payments WHERE order_id = ?1")
    .bind(paymentOrderId)
    .first();
  if (!payment) return json({ ok: false, error: "Pembayaran tidak ditemukan." }, 404);
  if (payment.status !== "paid") return json({ ok: false, error: "Pembayaran belum lunas. Status: " + payment.status }, 400);
  if (payment.paid_username) return json({ ok: false, error: "Pembayaran ini sudah digunakan untuk membuat akun." }, 400);

  // Buat akun
  const hash = await hashPassword(password);
  await env.tc_auth
    .prepare("INSERT INTO users (username, password_hash, role, payment_order_id, created_at) VALUES (?1, ?2, 'pengguna', ?3, ?4)")
    .bind(username, hash, paymentOrderId, Date.now())
    .run();

  // Tandai payment sudah dipakai
  await env.tc_auth
    .prepare("UPDATE payments SET username = ?1 WHERE order_id = ?2")
    .bind(username, paymentOrderId)
    .run();

  return json({ ok: true });
}

async function handleLogin(request, env) {
  const body = await readBody(request);
  if (!body) return json({ ok: false, error: "Body tidak valid." }, 400);
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!username || !password) return json({ ok: false, error: "Username dan password wajib diisi." }, 400);

  const user = await env.tc_auth
    .prepare("SELECT username, password_hash, role, created_at FROM users WHERE username = ?1")
    .bind(username)
    .first();
  if (!user) return json({ ok: false, error: "Username atau password salah." }, 401);

  const okPass = await verifyPassword(password, user.password_hash);
  if (!okPass) return json({ ok: false, error: "Username atau password salah." }, 401);

  const token = await createSession(env, user.username);
  return json({ ok: true, token, user: { username: user.username, role: user.role } });
}

async function handleMe(request, env) {
  const u = await currentUser(request, env);
  if (!u) return invalidToken();
  return json({ ok: true, user: { username: u.username, role: u.role } });
}

async function handleLogout(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    await env.tc_auth.prepare("DELETE FROM sessions WHERE token = ?1").bind(token).run();
  }
  return json({ ok: true });
}

async function handleUsers(request, env) {
  const u = await currentUser(request, env);
  if (!u) return invalidToken();
  if (u.role !== "admin") return json({ ok: false, error: "Akses khusus admin." }, 403);
  const rows = await env.tc_auth
    .prepare("SELECT username, role, created_at FROM users ORDER BY role ASC, username ASC")
    .all();
  const users = (rows.results || []).map((r) => ({
    username: r.username,
    role: r.role,
    created_at: r.created_at,
  }));
  return json({ ok: true, users });
}

async function handleCreate(request, env) {
  const u = await currentUser(request, env);
  if (!u) return invalidToken();
  if (u.role !== "admin") return json({ ok: false, error: "Akses khusus admin." }, 403);

  const body = await readBody(request);
  if (!body) return json({ ok: false, error: "Body tidak valid." }, 400);
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!/^[a-z0-9_.-]{3,20}$/.test(username))
    return json({ ok: false, error: "Username 3-20 karakter (huruf kecil, angka, _ . -)." }, 400);
  if (password.length < 4) return json({ ok: false, error: "Password minimal 4 karakter." }, 400);

  const exists = await env.tc_auth.prepare("SELECT username FROM users WHERE username = ?1").bind(username).first();
  if (exists) return json({ ok: false, error: "Username \"" + username + "\" sudah dipakai." }, 409);

  const hash = await hashPassword(password);
  await env.tc_auth
    .prepare("INSERT INTO users (username, password_hash, role, payment_order_id, created_at) VALUES (?1, ?2, ?3, NULL, ?4)")
    .bind(username, hash, "pengguna", Date.now())
    .run();
  return json({ ok: true });
}

async function handleReset(request, env) {
  const u = await currentUser(request, env);
  if (!u) return invalidToken();
  if (u.role !== "admin") return json({ ok: false, error: "Akses khusus admin." }, 403);

  const body = await readBody(request);
  if (!body) return json({ ok: false, error: "Body tidak valid." }, 400);
  const username = String(body.username || "").trim().toLowerCase();
  const newPassword = String(body.newPassword || "");
  if (newPassword.length < 4) return json({ ok: false, error: "Password minimal 4 karakter." }, 400);

  const user = await env.tc_auth.prepare("SELECT role FROM users WHERE username = ?1").bind(username).first();
  if (!user) return json({ ok: false, error: "Akun tidak ditemukan." }, 404);
  if (user.role === "admin") return json({ ok: false, error: "Password admin utama tidak bisa direset dari panel." }, 403);

  const hash = await hashPassword(newPassword);
  await env.tc_auth.prepare("UPDATE users SET password_hash = ?1 WHERE username = ?2").bind(hash, username).run();
  await env.tc_auth.prepare("DELETE FROM sessions WHERE username = ?1").bind(username).run();
  return json({ ok: true });
}

async function handleDelete(request, env) {
  const u = await currentUser(request, env);
  if (!u) return invalidToken();
  if (u.role !== "admin") return json({ ok: false, error: "Akses khusus admin." }, 403);

  const body = await readBody(request);
  if (!body) return json({ ok: false, error: "Body tidak valid." }, 400);
  const username = String(body.username || "").trim().toLowerCase();

  const user = await env.tc_auth.prepare("SELECT role FROM users WHERE username = ?1").bind(username).first();
  if (!user) return json({ ok: false, error: "Akun tidak ditemukan." }, 404);
  if (user.role === "admin") return json({ ok: false, error: "Akun admin tidak bisa dihapus." }, 403);

  await env.tc_auth.prepare("DELETE FROM sessions WHERE username = ?1").bind(username).run();
  await env.tc_auth.prepare("DELETE FROM users WHERE username = ?1").bind(username).run();
  return json({ ok: true });
}

// ---------- Router ----------
async function handleRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "POST" && path === "/auth/register") return handleRegister(request, env);
  if (method === "POST" && path === "/auth/login") return handleLogin(request, env);
  if (method === "GET" && path === "/auth/me") return handleMe(request, env);
  if (method === "POST" && path === "/auth/logout") return handleLogout(request, env);
  if (method === "GET" && path === "/auth/users") return handleUsers(request, env);
  if (method === "POST" && path === "/auth/create") return handleCreate(request, env);
  if (method === "POST" && path === "/auth/reset") return handleReset(request, env);
  if (method === "POST" && path === "/auth/delete") return handleDelete(request, env);

  return json({ ok: false, error: "Endpoint tidak ditemukan." }, 404);
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
