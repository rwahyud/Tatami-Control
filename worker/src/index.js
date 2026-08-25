// ypok-payment — Payment gateway backend untuk app Tatami Control.
// Berjalan di Cloudflare Workers, memakai Midtrans Snap (sandbox default).
//
// Endpoint:
//   POST /create-payment       -> buat transaksi baru, simpan di D1, balas { token, redirect_url }
//   GET  /payment-status/:orderId -> tanya status ke Midtrans
//   GET  /payment-info/:orderId   -> cek status pembayaran di D1 (untuk frontend registrasi)
//   POST /webhook              -> notifikasi dari Midtrans (signature diverifikasi)
//
// Konfigurasi via env / secret:
//   MIDTRANS_SERVER_KEY  (secret, wajib)
//   MIDTRANS_MODE        "sandbox" (default) | "production"
//   MIDTRANS_MERCHANT_ID (opsional, dipakai untuk verifikasi webhook)
//   MIDTRANS_FEE_RATE    (opsional, override default 0.007)

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });

const badRequest = (msg) => json({ error: msg }, 400);
const internal = (msg) => json({ error: msg || "Internal error" }, 500);

// Fee Midtrans dalam persen (0.007 = 0,7%, rata-rata MDR QRIS).
// Bisa di-override lewat env MIDTRANS_FEE_RATE (misal "0.011" = 1,1%).
const DEFAULT_FEE_RATE = 0.007;

function feeRate(env) {
  const v = Number(env.MIDTRANS_FEE_RATE);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : DEFAULT_FEE_RATE;
}

// Harga yang dibayar pembeli agar panitia menerima NET bersih.
// amount = ceil(net / (1 - feeRate))
function priceFromNet(net, env) {
  return Math.ceil(net / (1 - feeRate(env)));
}

function baseUrl(env) {
  return env.MIDTRANS_MODE === "production"
    ? { snap: "https://app.midtrans.com/snap/v1", api: "https://api.midtrans.com/v2" }
    : { snap: "https://app.sandbox.midtrans.com/snap/v1", api: "https://api.sandbox.midtrans.com/v2" };
}

function authHeader(serverKey) {
  return "Basic " + btoa(serverKey + ":");
}

async function sha512Hex(text) {
  const buf = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function genOrderId(prefix) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts =
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds());
  return (prefix || "ORD") + "-" + ts + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function createPayment(req, env) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return badRequest("Body harus berupa JSON");
  }

  let amount = Number(body.amount);
  const netAmount = Number(body.net_amount);
  if (!amount && netAmount && Number.isFinite(netAmount)) {
    amount = priceFromNet(netAmount, env);
  }
  if (!amount || amount < 1000 || !Number.isFinite(amount)) {
    return badRequest("amount wajib diisi, minimal 1000");
  }

  const orderId = body.order_id || genOrderId(body.order_prefix || "ORD");
  const customer = { first_name: body.name || "Peserta" };
  if (body.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) customer.email = body.email;
  if (body.phone) customer.phone = String(body.phone);
  const payload = {
    transaction_details: {
      order_id: orderId,
      gross_amount: amount,
    },
    customer_details: customer,
    item_details: Array.isArray(body.items) && body.items.length
      ? body.items
      : [{ id: "reg", price: amount, quantity: 1, name: body.item_name || "Biaya Pendaftaran" }],
    credit_card: { secure: true },
  };

  // Batasi metode pembayaran: QRIS + VA saja
  payload.enable_payments = ["gopay", "shopeepay", "qris", "bri_va", "bca_va", "bni_va", "mandiri_va", "permata_va", "other_va"];

  const url = baseUrl(env).snap + "/transactions";
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": authHeader(env.MIDTRANS_SERVER_KEY),
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return json({ error: "Midtrans: " + JSON.stringify(data), midtrans: data }, resp.status);
  }

  // Simpan payment ke D1
  try {
    await env.tc_auth
      .prepare("INSERT INTO payments (order_id, amount, net_amount, status, created_at) VALUES (?1, ?2, ?3, 'pending', ?4)")
      .bind(orderId, amount, netAmount || Math.floor(amount * (1 - feeRate(env))), Date.now())
      .run();
  } catch (e) {
    // Kalau D1 error, tetap return token supaya user bisa bayar
    // Webhook nanti juga bisa update status
    console.error("D1 insert error:", e);
  }

  return json({
    order_id: orderId,
    token: data.token,
    redirect_url: data.redirect_url,
    amount: amount,
    net_amount: netAmount || Math.floor(amount * (1 - feeRate(env))),
    fee_rate: feeRate(env),
  });
}

async function paymentStatus(req, env, orderId) {
  const url = baseUrl(env).api + "/" + encodeURIComponent(orderId) + "/status";
  const resp = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json", "Authorization": authHeader(env.MIDTRANS_SERVER_KEY) },
  });
  const data = await resp.json().catch(() => ({}));
  return json(
    {
      order_id: data.order_id,
      transaction_status: data.transaction_status,
      fraud_status: data.fraud_status,
      payment_type: data.payment_type,
      gross_amount: data.gross_amount,
      transaction_time: data.transaction_time,
      raw: data,
    },
    resp.status
  );
}

async function paymentInfo(req, env, orderId) {
  try {
    const row = await env.tc_auth
      .prepare("SELECT order_id, amount, net_amount, status, created_at, completed_at FROM payments WHERE order_id = ?1")
      .bind(orderId)
      .first();
    if (!row) return json({ error: "Payment tidak ditemukan." }, 404);
    return json(row);
  } catch (e) {
    return internal("Gagal cek payment: " + (e.message || e));
  }
}

async function webhook(req, env) {
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return badRequest("Body harus berupa JSON");
  }

  const signatureKey = body.signature_key || "";
  const raw = String(body.order_id || "") + String(body.status_code || "") + String(body.gross_amount || "") + env.MIDTRANS_SERVER_KEY;
  const expected = await sha512Hex(raw);
  if (signatureKey !== expected) {
    return json({ error: "Invalid signature" }, 403);
  }

  const merchantId = body.merchant_id || "";
  if (env.MIDTRANS_MERCHANT_ID && merchantId && merchantId !== env.MIDTRANS_MERCHANT_ID) {
    return json({ error: "Unknown merchant" }, 403);
  }

  // Update status pembayaran di D1
  const txStatus = body.transaction_status || "";
  const orderId = body.order_id || "";
  if (orderId && (txStatus === "settlement" || txStatus === "capture")) {
    try {
      await env.tc_auth
        .prepare("UPDATE payments SET status = 'paid', completed_at = ?1 WHERE order_id = ?2")
        .bind(Date.now(), orderId)
        .run();
    } catch (e) {
      console.error("D1 update error:", e);
    }
  } else if (orderId && (txStatus === "expire" || txStatus === "cancel" || txStatus === "deny")) {
    try {
      await env.tc_auth
        .prepare("UPDATE payments SET status = ?1 WHERE order_id = ?2")
        .bind(txStatus, orderId)
        .run();
    } catch (e) {
      console.error("D1 update error:", e);
    }
  }

  return json({
    ok: true,
    order_id: body.order_id,
    transaction_status: body.transaction_status,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (!env.MIDTRANS_SERVER_KEY) {
      return internal("MIDTRANS_SERVER_KEY belum di-set");
    }

    try {
      if (method === "POST" && path === "/create-payment") {
        return await createPayment(request, env);
      }
      if (method === "POST" && path === "/webhook") {
        return await webhook(request, env);
      }
      if (method === "GET" && path.startsWith("/payment-status/")) {
        const orderId = decodeURIComponent(path.slice("/payment-status/".length));
        if (!orderId) return badRequest("orderId wajib diisi");
        return await paymentStatus(request, env, orderId);
      }
      if (method === "GET" && path.startsWith("/payment-info/")) {
        const orderId = decodeURIComponent(path.slice("/payment-info/".length));
        if (!orderId) return badRequest("orderId wajib diisi");
        return await paymentInfo(request, env, orderId);
      }
      return json({ error: "Not found", endpoints: ["POST /create-payment", "GET /payment-status/:orderId", "GET /payment-info/:orderId", "POST /webhook"] }, 404);
    } catch (e) {
      return internal(e && e.message ? e.message : "Internal error");
    }
  },
};
