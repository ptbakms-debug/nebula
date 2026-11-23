// Pembantu pengingat WhatsApp: panggil fungsi database (dijaga rahasia server) dan WhatsApp Cloud API.
export const configured = (env) =>
  !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN &&
     env.WA_SERVER_SECRET && env.WA_SERVER_SECRET.length >= 32);

// Panggil fungsi Postgres lewat Supabase REST. Hanya memakai apikey (peran anon); rahasia server ikut sebagai argumen.
export async function rpc(env, name, args, timeoutMs = 5000) {
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`rpc ${name} ${r.status}`);
  return text ? JSON.parse(text) : null;
}

const graphUrl = (env) =>
  `${(env.WA_GRAPH_BASE || "https://graph.facebook.com").replace(/\/$/, "")}/${env.WA_API_VERSION || "v23.0"}/${env.WA_PHONE_NUMBER_ID}/messages`;

// Kode galat sementara (coba lagi nanti): batas laju dan gangguan di sisi Meta.
const TRANSIENT_CODES = new Set([4, 17, 32, 613, 80007, 130429, 131056]);

export async function sendMessage(env, payload) {
  try {
    const r = await fetch(graphUrl(env), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) return { ok: true };
    let code = 0;
    try { code = (await r.json())?.error?.code || 0; } catch { /* abaikan */ }
    const permanent = r.status >= 400 && r.status < 500 && r.status !== 429 && !TRANSIENT_CODES.has(code);
    return { ok: false, permanent, error: `http ${r.status} code ${code}` };
  } catch (e) {
    return { ok: false, permanent: false, error: `network ${e?.name || "error"}` };
  }
}

export const textPayload = (to, body) => ({ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: false } });

// Template pengingat. Isi yang didaftarkan di Meta:
// "NEBULA: ada {{1}} tugas jatuh tempo {{2}}. Buka NEBULA untuk detailnya. Balas STOP untuk berhenti."
export function templatePayload(env, to, n, kind) {
  const name = env.WA_TEMPLATE_NAME || "pengingat_deadline";
  if (name === "hello_world") {   // template bawaan Meta untuk uji sambungan, tanpa variabel
    return { messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: "en_US" } } };
  }
  return {
    messaging_product: "whatsapp", to, type: "template",
    template: {
      name, language: { code: env.WA_TEMPLATE_LANG || "id" },
      components: [{ type: "body", parameters: [
        { type: "text", text: String(Math.max(1, Math.min(99, Number(n) || 1))) },
        { type: "text", text: kind === "today" ? "hari ini" : "besok" },
      ] }],
    },
  };
}
