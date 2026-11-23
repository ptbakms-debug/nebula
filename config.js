// Nilai publik. Aman ada di browser karena data dilindungi RLS dan enkripsi.
// JANGAN taruh service_role key atau API key Gemini di sini.
window.NEBULA_CONFIG = {
  SUPABASE_URL: "https://ogezdyjzxxutkaognguh.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_R8bvHGLVrn7Y9D9OCcoDQg_5LqX83zh",

  // Wajib diisi sebelum peluncuran (tampil di halaman Kebijakan Privasi dan Ketentuan):
  OPERATOR_NAME: "",    // nama pengelola, mis. "Budi Santoso" atau nama badan usaha
  CONTACT_EMAIL: "",    // email untuk permintaan data dan pengaduan
  SUPABASE_REGION: "",  // lihat Supabase -> Project Settings -> General, mis. "Singapura"

  // Opsional: isi dengan Site Key Cloudflare Turnstile untuk mengaktifkan CAPTCHA.
  // Aktifkan juga di Supabase -> Authentication -> Attack Protection (CAPTCHA) dengan Secret Key-nya.
  CAPTCHA_SITE_KEY: "",

  // Opsional: nomor WhatsApp NEBULA (hanya angka, kode negara tanpa +, mis. "6281234567890") untuk fitur Pengingat WhatsApp.
  // Kosong = menu Pengingat WhatsApp tidak tampil. Lihat README.
  WA_NUMBER: ""
};
