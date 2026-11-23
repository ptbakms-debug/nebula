// Netlify Function: /.netlify/functions/wa-webhook
// GET  = verifikasi webhook dari Meta. POST = pesan masuk (MULAI <kode> untuk menghubungkan, STOP untuk berhenti).
import crypto from "node:crypto";
import { configured, rpc, sendMessage, textPayload } from "../lib/wa.mjs";

const res = (status, body = "", type = "text/plain") =>
  new Response(body, { status, headers: { "Content-Type": type, "Cache-Control": "no-store" } });

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export default async (req) => {
  const env = process.env;

  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    if (q.get("hub.mode") === "subscribe" && env.WA_VERIFY_TOKEN && safeEq(q.get("hub.verify_token") || "", env.WA_VERIFY_TOKEN)) {
      return res(200, q.get("hub.challenge") || "");
    }
    return res(403, "forbidden");
  }
  if (req.method !== "POST") return res(405, "method_not_allowed");
  if (!configured(env) || !env.WA_APP_SECRET) return res(500, "server_not_configured");

  const raw = await req.text();
  if (raw.length > 200000) return res(413, "too_large");
  const sig = (req.headers.get("x-hub-signature-256") || "").replace(/^sha256=/, "");
  const want = crypto.createHmac("sha256", env.WA_APP_SECRET).update(raw).digest("hex");
  if (!/^[0-9a-f]{64}$/.test(sig) || !safeEq(sig, want)) return res(401, "bad_signature");

  let data;
  try { data = JSON.parse(raw); } catch { return res(400, "bad_request"); }

  const msgs = [];
  for (const e of data?.entry || []) for (const c of e?.changes || []) for (const m of c?.value?.messages || []) msgs.push(m);

  let failed = false, handled = 0;
  for (const m of msgs.slice(0, 20)) {
    const from = String(m?.from || "");
    // Hanya nomor Indonesia dan pesan teks. Pesan lain diabaikan tanpa balasan agar tidak ada biaya balasan.
    if (m?.type !== "text" || !/^62[0-9]{8,13}$/.test(from)) continue;
    const body = String(m?.text?.body || "").trim().toUpperCase().slice(0, 40);
    try {
      let mm;
      if ((mm = /^MULAI\s+([A-Z0-9]{8})$/.exec(body))) {
        const ok = await rpc(env, "wa_link_confirm", { p_secret: env.WA_SERVER_SECRET, p_code: mm[1], p_phone: from });
        if (ok === true) {
          handled++;
          await sendMessage(env, textPayload(from, "Terhubung. NEBULA akan mengingatkan deadline lewat WhatsApp ini. Balas STOP kapan saja untuk berhenti."));
        }
      } else if (/^(STOP|BERHENTI)$/.test(body)) {
        const n = await rpc(env, "wa_optout", { p_secret: env.WA_SERVER_SECRET, p_phone: from });
        if (n > 0) {
          handled++;
          await sendMessage(env, textPayload(from, "Pengingat dimatikan. Kamu bisa mengaktifkannya lagi dari menu Data di NEBULA."));
        }
      }
    } catch (err) {
      failed = true;
      console.error("wa-webhook", err?.message || err);
    }
  }
  // 500 membuat Meta mengirim ulang; semua perintah idempoten sehingga aman.
  return failed ? res(500, "retry") : res(200, JSON.stringify({ ok: true, handled }), "application/json");
};
