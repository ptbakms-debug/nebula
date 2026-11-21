# NEBULA jalur C: login, database cloud, AI lewat server

Struktur:
- `public/index.html`  aplikasi (sudah tersambung ke Supabase dan fungsi AI)
- `public/config.js`   isi URL dan anon key Supabase
- `supabase/schema.sql`  tabel data, aturan keamanan (RLS), kuota AI
- `netlify/functions/breakdown.mjs`  server kecil untuk Fokus AI (API key aman di sini)
- `netlify.toml`  pengaturan Netlify

## Langkah 1. Supabase (database + login)
1. Buat project di supabase.com.
2. SQL Editor -> New query -> tempel isi `supabase/schema.sql` -> Run.
3. Project Settings -> API: salin **Project URL** dan **anon public key**, tempel ke `public/config.js`.
4. Authentication -> Providers: pastikan **Email** aktif. Saat uji coba boleh mematikan "Confirm email" biar cepat; untuk publik sebaiknya dinyalakan.
5. Authentication -> URL Configuration: isi **Site URL** dengan alamat Netlify-mu (diisi setelah langkah 3), dan tambahkan alamat yang sama di Redirect URLs. Tanpa ini, link konfirmasi email dan reset kata sandi tidak kembali ke aplikasimu.

## Langkah 2. Kunci API Anthropic
Buat API key di console.anthropic.com, isi kredit, dan pasang batas pengeluaran bulanan.

## Langkah 3. Netlify
Fungsi server butuh deploy lewat Git atau CLI (bukan seret-lepas folder).
- Lewat Git: unggah folder ini ke repo GitHub -> Netlify -> Add new site -> Import from Git. Pengaturan build otomatis terbaca dari `netlify.toml`.
- Atau lewat CLI: `npm i -g netlify-cli`, lalu `netlify deploy --prod`.

Setelah situs dibuat: Site configuration -> Environment variables, tambahkan:
| Nama | Isi |
|---|---|
| `SUPABASE_URL` | sama dengan di config.js |
| `SUPABASE_ANON_KEY` | sama dengan di config.js |
| `ANTHROPIC_API_KEY` | API key dari langkah 2 |
| `AI_DAILY_LIMIT` | opsional, batas panggilan AI per pengguna per hari (bawaan 20) |
| `ANTHROPIC_MODEL` | opsional, bawaan `claude-haiku-5-5` |

Deploy ulang setelah variabel diisi, lalu kembali ke Supabase langkah 5 untuk mengisi Site URL.

## Uji coba
1. Buka situs, klik **Masuk / Daftar**, buat akun, konfirmasi email, masuk.
2. Tambah checklist, muat ulang, dan buka dari perangkat lain: data harus ikut.
3. Menu Fokus AI: tulis pekerjaan; label harus "dipecah oleh Claude".
4. Keluar: data lokal di browser dibersihkan.

## Catatan penting
- Isi data (termasuk keuangan) tersimpan di database Supabase-mu. Pengguna lain tidak bisa membacanya (RLS), tetapi kamu sebagai pemilik project bisa. Karena kamu mengumpulkan email dan data keuangan, siapkan kebijakan privasi (UU PDP).
- Teks yang diketik pengguna di Fokus AI dikirim ke Anthropic untuk diproses. Sebutkan ini di kebijakan privasi.
- Skrip Supabase dimuat dari CDN jsDelivr dengan versi dikunci. Untuk keamanan lebih, simpan filenya sendiri di `public/`.
- Jangan pernah menaruh `service_role` key atau API key Anthropic di `config.js` atau `index.html`.
