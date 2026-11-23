NEBULA
Struktur:
`public/index.html`  aplikasi
`public/vault.js`  enkripsi di browser (AES-GCM, PBKDF2)
`public/supabase.min.js`  supabase-js 2.45.4, disimpan lokal
`public/config.js`  URL/anon key Supabase, identitas pengelola, kunci CAPTCHA (opsional)
`public/privacy.html`, `public/terms.html`, `public/legal.js`  kebijakan privasi dan ketentuan (draf)
`supabase/schema.sql`  tabel, RLS, kuota AI, hapus akun. Aman dijalankan ulang.
`netlify/functions/breakdown.mjs`  Fokus AI (Google Gemini)
`supabase/whatsapp.sql`, `netlify/functions/wa-webhook.mjs`, `netlify/functions/wa-send.mjs`, `netlify/lib/wa.mjs`  Pengingat WhatsApp (opsional, prototipe)
`netlify.toml`  build dan header keamanan (CSP)
Antarmuka (redesign)
Tiga area: sidebar (Inbox, Today, Upcoming, Projects, Filters, Lainnya), daftar tugas, dan panel Asisten yang bisa dibuka/ditutup. Di layar sempit sidebar menjadi laci dan tombol + mengambang muncul.
Project = target jangka pendek/panjang yang lama (data lama tetap terbaca). Tugas lama (checklist) menjadi tugas di Inbox/Today/Upcoming. Field tambahan tugas (prioritas `pri`, waktu `time`, project `proj`, catatan `note`) opsional dan kompatibel mundur.
Teks cepat: token di akhir judul (`besok`, `hari ini`, `lusa`, `minggu depan`, `jam 10.00`, `p1`..`p3`) diurai jadi tanggal, waktu, prioritas. Pintasan: `q` untuk tambah tugas.
Saran Asisten (prioritas, berpotensi tertunda, jadwal, evaluasi) dihitung di browser dengan aturan sederhana; data tugas tidak dikirim. Hanya teks di kolom Percakapan (Fokus AI) dikirim ke Gemini.
Nama bagian ada di konstanta `L` di `index.html` bila ingin diterjemahkan.
Font memakai font sistem; permintaan ke Google Fonts dihapus (CSP ikut diperketat).
Urutan pasang perubahan ini
Isi `OPERATOR_NAME`, `CONTACT_EMAIL`, `SUPABASE_REGION` di `public/config.js`.
Satu commit ke GitHub (satu deploy = 15 kredit Netlify).
Setelah deploy selesai, jalankan `supabase/schema.sql` di Supabase SQL Editor. Constraint barunya menolak penulisan teks biasa, jadi versi situs lama berhenti menyimpan ke akun begitu schema dijalankan. Jalankan segera setelah deploy.
Login ke situs: akun lama diminta membuat frasa sandi data, lalu datanya dienkripsi dan diunggah ulang.
Supabase
Authentication -> Sign In / Providers: aktifkan Email dan Google. Nyalakan "Confirm email".
Authentication -> URL Configuration: Site URL dan Redirect URLs berisi alamat situs (dengan `/` dan `/**`). Hapus `http://localhost:3000/**` sebelum peluncuran.
Authentication -> Attack Protection: aktifkan CAPTCHA (Turnstile) dengan Secret Key, lalu isi `CAPTCHA_SITE_KEY` di `config.js`. Isi keduanya bersamaan, kalau tidak pendaftaran gagal.
Authentication -> SMTP: pasang SMTP sendiri sebelum banyak pengguna (email bawaan sangat dibatasi).
Setelah schema dijalankan: Database -> Advisors (Security) tidak boleh menampilkan peringatan RLS.
Google (login SSO)
OAuth client (Web): Authorized JavaScript origins = alamat situs; Authorized redirect URI = `https://<project>.supabase.co/auth/v1/callback`. Consent screen: nama aplikasi "NEBULA", lalu Publish app sebelum peluncuran.
Netlify
Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY` (Secret), `SECRETS_SCAN_OMIT_KEYS=SUPABASE_URL,SUPABASE_ANON_KEY`; opsional `AI_DAILY_LIMIT` (20), `GEMINI_MODEL`.
Pengingat WhatsApp (opsional, prototipe)
Mati selama `WA_NUMBER` di `config.js` kosong. Isi pesan hanya "ada N tugas jatuh tempo hari ini/besok" (tanpa judul).
Cara kerja. Server tidak bisa membaca data terenkripsi, jadi browser yang menghitung jumlah tugas per tanggal lalu mengunggah hanya waktu, jumlah, dan jenis (`wa_sync`). Fungsi terjadwal `wa-send` (tiap 15 menit) mengirim yang jatuh tempo. Konsekuensi: jadwal hanya diperbarui saat pengguna membuka NEBULA, jadi tugas yang ditambah atau diselesaikan di perangkat lain belum tentu tercermin sampai aplikasi dibuka lagi.
Memasang (urutan penting).
Jalankan `supabase/schema.sql`, lalu `supabase/whatsapp.sql`.
Buat teks acak minimal 32 karakter (rahasia server), lalu jalankan sekali di SQL Editor (ganti teksnya):
`insert into public.wa_server (secret_hash) values (encode(sha256(convert_to('TEKS-ACAK-ANDA','UTF8')),'hex')) on conflict (id) do update set secret_hash = excluded.secret_hash;`
Meta for Developers: buat app (tipe Business), tambahkan produk WhatsApp. Pakai nomor uji yang disediakan Meta dulu. Tambahkan nomor penerimamu ke daftar penerima uji.
Template: buat template kategori Utility, nama `pengingat_deadline`, bahasa Indonesia, isi: `NEBULA: ada {{1}} tugas jatuh tempo {{2}}. Buka NEBULA untuk detailnya. Balas STOP untuk berhenti.` Sertakan contoh nilai (3, hari ini). Tunggu disetujui. Meta menentukan kategori sendiri dan bisa menetapkannya sebagai Marketing, yang lebih mahal. Selama template belum disetujui, uji sambungan dengan `WA_TEMPLATE_NAME=hello_world`.
Webhook: di konfigurasi WhatsApp, Callback URL = `https://<situsmu>/.netlify/functions/wa-webhook`, Verify token = nilai `WA_VERIFY_TOKEN`, berlangganan field `messages`.
Netlify environment variables (Secret):
`WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN` (token permanen dari System User, bukan token 24 jam), `WA_APP_SECRET` (App Secret untuk tanda tangan webhook), `WA_VERIFY_TOKEN` (teks acak buatanmu), `WA_SERVER_SECRET` (teks dari langkah 2), opsional `WA_TEMPLATE_NAME`, `WA_TEMPLATE_LANG` (id), `WA_API_VERSION` (v23.0).
Isi `WA_NUMBER` di `config.js` (angka saja, mis. `6281234567890`), commit, deploy.
Uji: Data -> Pengingat WhatsApp -> hubungkan nomor penerima uji -> kirim `MULAI <kode>` ke nomor uji.
Batas dan biaya (perlu diverifikasi sebelum produksi).
Maksimal 2 pesan per pengguna per hari (WIB), 06.00 sampai 20.59 WIB. Pengingat yang terlambat lebih dari 3 jam dibuang.
Pesan yang dimulai bisnis di luar jendela 24 jam butuh template yang disetujui dan persetujuan pengguna. Tarif per pesan berubah-ubah; cek halaman tarif Meta terbaru.
Fungsi terjadwal memakai kredit Netlify (komputasi fungsi dihitung per GB-jam). Pantau kredit setelah beberapa hari.
Nomor produksi harus nomor yang tidak aktif di WhatsApp biasa. Verifikasi bisnis Meta mungkin diminta; belum dicoba untuk pengelola perorangan.
Jangan pakai gateway tidak resmi (Baileys, whatsapp-web.js): melanggar ketentuan WhatsApp dan nomor bisa diblokir.
Pengelola dapat melihat nomor, waktu, dan jumlah pengingat pengguna yang mengaktifkan. Sudah diungkap di persetujuan dan Kebijakan Privasi; tinjau oleh ahli hukum.
Tes yang sudah dijalankan: SQL terhadap Postgres lokal, fungsi terhadap Graph API palsu, UI di browser. Belum diuji terhadap Meta asli.
Cara kerja enkripsi
Data yang disimpan ke akun dienkripsi di browser dengan kunci acak (DEK). DEK dibungkus dua kali: frasa sandi data (PBKDF2-SHA256, 600.000 iterasi) dan kode pemulihan 160 bit. Server hanya menyimpan bungkusan dan data terenkripsi; database menolak penulisan yang tidak terenkripsi.
Pengelola bisa melihat: email, nama/foto Google, waktu dan ukuran data, jumlah penggunaan AI. Pengelola tidak bisa membaca isi data.
Frasa sandi dan kode pemulihan hilang = data tidak bisa dibuka, oleh siapa pun.
Frasa sandi lemah bisa ditebak oleh pihak yang memegang salinan database. Minimal 12 karakter diwajibkan, anjurkan beberapa kata acak.
Batas: pengelola mengendalikan kode situs. Versi aplikasi yang diubah dengan niat jahat dapat menangkap frasa sandi.
Teks Fokus AI tidak terenkripsi ujung ke ujung karena dikirim ke Gemini.
Salinan data di browser (localStorage) tidak dienkripsi dan dihapus saat keluar.
Dua perangkat menulis bersamaan: data digabung per item (lokal menang). Item yang dihapus di satu perangkat bisa muncul lagi.
Sebelum peluncuran
[ ] Halaman Kebijakan Privasi dan Ketentuan terisi dan ditinjau ahli hukum
[ ] Redirect URL localhost dihapus; consent screen Google di Production
[ ] "Confirm email", CAPTCHA, dan SMTP aktif
[ ] Uji dengan dua akun: data akun A tidak tampil di akun B
[ ] Uji Hapus akun dengan akun percobaan
[ ] Site lama (`nebula1-t1sw`) dihapus; kunci lama dicabut
[ ] Putuskan: tetap Gemini gratis (Google dapat memakai masukan) atau paket berbayar
[ ] Jika memakai Pengingat WhatsApp: uji di nomor uji Meta, template disetujui dan kategorinya Utility, tarif dicek ulang
[ ] Cadangan: paket gratis Supabase tidak menjamin cadangan dan bisa dijeda; pertimbangkan upgrade, dan anjurkan pengguna ekspor data berkala (menu Data)
