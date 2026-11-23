// Netlify Scheduled Function: berjalan tiap 15 menit, mengirim pengingat yang jatuh tempo.
import { configured, rpc, sendMessage, templatePayload } from "../lib/wa.mjs";

export default async () => {
  const env = process.env;
  if (!configured(env)) { console.error("wa-send: belum dikonfigurasi"); return; }
  const t0 = Date.now();
  let rows;
  try { rows = await rpc(env, "wa_claim_due", { p_secret: env.WA_SERVER_SECRET, p_limit: 20 }); }
  catch (e) { console.error("wa-send: gagal klaim", e?.message || e); return; }
  rows = Array.isArray(rows) ? rows : [];
  let sent = 0, failed = 0, deferred = 0;
  for (const r of rows) {
    // Sisakan waktu: sisanya dilepas agar diambil pada putaran berikutnya.
    const late = Date.now() - t0 > 20000;
    const out = late ? { ok: false, permanent: false, error: "ditunda" } : await sendMessage(env, templatePayload(env, r.phone, r.n, r.kind));
    try {
      await rpc(env, "wa_mark", { p_secret: env.WA_SERVER_SECRET, p_id: r.id, p_ok: out.ok, p_error: out.ok ? null : out.error, p_permanent: !!out.permanent });
    } catch (e) { console.error("wa-send: gagal menandai", r.id, e?.message || e); }
    if (out.ok) sent++; else if (out.permanent) failed++; else deferred++;
  }
  console.log(`wa-send: ${rows.length} diklaim, ${sent} terkirim, ${failed} gagal permanen, ${deferred} ditunda`);
};

export const config = { schedule: "*/15 * * * *" };
