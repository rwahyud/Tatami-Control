# Tatami Control — Skor Karate

Aplikasi skor karate realtime: **panel kontrol wasit** + **layar skor lapangan**,
tersinkron antar-tab/browser, bisa **dipasang sebagai aplikasi (PWA)** di
HP/laptop/TV, dan mendukung 4 jenis pertandingan:

- Kumite Perorangan
- Kumite Beregu (seri pertandingan per atlet)
- Kata Perorangan (penilaian juri)
- Kata Beregu

> **Catatan:** versi ini **tidak memakai Firebase**. Semua data disimpan di
> browser (localStorage) dan sinkron antar-tab/window di perangkat yang sama
> lewat BroadcastChannel. Cocok dipakai di **localhost / LAN** tanpa internet.

## 1. Struktur Project

```
karate-app/
├── index.html            ← halaman utama
├── manifest.json          ← manifest PWA
├── service-worker.js       ← cache offline / installable
├── css/
│   └── style.css          ← semua styling
├── js/
│   ├── db.js               ← layer akses data (localStorage + sync antar-tab)
│   ├── pwa.js               ← install prompt + registrasi service worker
│   └── app.js               ← logic aplikasi (UI, timer, skor, dll)
```

## 2. Menjalankan di localhost

Karena aplikasi ini murni HTML/CSS/JS statis, cukup jalankan server lokal
(supaya service worker & sinkronisasi antar-tab berjalan normal):

```bash
cd karate-app
python -m http.server 8080
# lalu buka http://localhost:8080
```

Kalau pakai XAMPP, letakkan folder ini di `htdocs/` lalu buka
`http://localhost/NAMA-FOLDER/`.

## 3. Login & Akun

- Buka aplikasi → halaman **login** muncul sebelum dashboard.
- Akun admin dibuat otomatis saat pertama kali aplikasi dibuka. Tambah akun
  panitia di **Panel Admin** (buat akun, reset password, hapus akun).
- Akun pengguna (panitia/pelaksana) yang dibuat admin bisa login dan langsung
  memakai aplikasi.
- Akun & sesi login tersimpan di browser (localStorage) — belum ada server.

## 4. Bagan — bisa buat banyak sekaligus (10+ dalam satu hari)

- Setelah login, halaman pertama adalah **Semua Bagan**: daftar semua
  bagan/turnamen yang pernah dibuat di perangkat ini (kartu per bagan,
  lengkap dengan nama, kategori, jumlah peserta, dan status juara).
- Klik **+ Buat Bagan Baru** untuk membuat bagan lain — cocok untuk tiap
  kategori/kelas (mis. Kumite -55kg Senior, Kumite -60kg Senior, Kata
  Perorangan Junior, dst). Tidak ada batas jumlah bagan; buat sebanyak
  yang dibutuhkan dalam satu hari turnamen.
- Klik **Buka Bagan** pada sebuah kartu untuk masuk ke bagan tersebut
  (kocok ulang, edit peserta, live score tiap laga sampai final).
  Tombol **← Semua Bagan** di pojok kanan atas membawa kembali ke daftar.
- **Kocok Acak** (di dalam bagan) atau saat membuat bagan otomatis memakai
  aturan: **peserta dari kota yang sama tidak ditempatkan bertemu di Ronde 1**
  (selama jumlahnya memungkinkan). Peserta yang belum memilih kota dianggap
  netral.
- Tombol **Hapus** pada kartu (atau **Hapus Turnamen** di dalam bagan)
  menghapus bagan tersebut beserta semua live score-nya — tidak
  memengaruhi bagan lain.
- Data tersimpan per-perangkat (localStorage); versi lama yang hanya
  menyimpan satu bagan otomatis dimigrasikan ke format baru saat dibuka.

## 5. Cara pakai

**Wasit / meja skor (Panel Kontrol):**
1. Login → tab **Buat Pertandingan**.
2. Pilih jenis pertandingan, isi kode (atau pakai kode acak), kategori,
   durasi/jumlah juri, nama kedua sisi, serta **provinsi & kota/kabupaten**
   asal tiap sisi.
3. Klik **Buat & Buka Panel Kontrol** → tab ini jadi panel wasit/admin, dan
   **jendela kedua otomatis terbuka** sebagai layar skor live untuk TV.
4. Layar skor TV bisa juga dibuka manual lewat tab **Gabung Pertandingan**
   dengan kode yang sama.

**Layar skor lapangan (TV / jendela terpisah):**
1. Saat pertandingan berjalan: tampil skor & timer realtime.
2. Saat pertandingan **selesai** (pemenang dipilih): layar beralih otomatis
   menampilkan **banner turnamen** (upload di halaman utama → Banner Turnamen).
3. Saat pertandingan berikutnya dibuat/dimulai: layar kembali ke live score.
4. Tombol **Layar Penuh** di pojok kanan bawah, tombol **Kembali** di kiri bawah.

Kedua layar tersinkron otomatis (realtime) antar-jendela/tab selama dibuka di
perangkat yang sama — tidak perlu refresh manual.

**Pasang sebagai aplikasi (PWA):**
- Di Chrome/Edge Android atau desktop, akan muncul banner "Pasang sebagai
  aplikasi" di layar Setup, atau lewat menu browser → *Install app*.
- Di iOS Safari: tombol *Share* → *Add to Home Screen*.

## 6. Aturan Kumite (disesuaikan gaya JKA)

- **Poin**: bertambah (akumulasi), tombol diberi label istilah JKA —
  **+1 Ippon**, **+2 Nihon**, **+3 Sanbon**. Skor tertinggi saat waktu habis
  yang menang; jika sama, gunakan tombol **Hantei**.
- **Pelanggaran** (5 slot, sesuai dokumen JKA):
  - `Jogai` — keluar tatami pertama kali.
  - `Jogai Chui` — keluar tatami kedua kali.
  - `Keikoku` (Atsu-i) — peringatan kontak ringan, belum ada pengurangan nilai.
  - `Chui` — peringatan keras, lawan otomatis diuntungkan.
  - `Hansoku` — diskualifikasi; begitu dicatat, tombol **"Hansoku! Menangkan
    lawan sekarang"** muncul di panel sisi yang melanggar.
- **Durasi**: tombol cepat **1:30 (Penyisihan)** dan **2:00 (Semifinal/Final)**
  tersedia di form Buat Pertandingan, atau isi manual menit:detik.
- **Kategori usia**: field Kategori punya saran otomatis (datalist) sesuai
  pembagian JKA — Anak-anak, Taruna 16–18 & 19–21, Dewasa/Senior, Veteran
  40–49/50–59/60+.
- **Hantei**: saat waktu habis dan skor kedua sisi sama, tombol **"Buka
  Hantei"** muncul → input suara 4 Juri + 1 Wasit (Aka/Shiro). Suara terbanyak
  menang; kalau seri lagi, sistem otomatis menyiapkan **Encho-sen** (reset
  waktu ke 1 menit, sudden death — poin pertama yang dicetak lalu diputuskan
  manual lewat tombol AKA/SHIRO MENANG).

## 7. Aturan Kata

- Jumlah juri bisa dipilih (3/4/5/7) saat membuat bagan/pertandingan Kata.
- **Dua metode penilaian** (pilih di form bagan/pertandingan Kata):
  1. **Penilaian Angka** — tiap juri memberi nilai 0–10; total =
     **jumlah semua nilai juri** (tidak ada nilai yang dibuang).
  2. **Penilaian Bendera** — tiap juri mengangkat **1 bendera**: merah (Aka)
     atau putih (Shiro). Layar monitor hanya menampilkan **satu bendera**
     hasil mayoritas juri (merah = Aka menang, putih = Shiro menang). Klik
     bendera yang sama dua kali untuk membatalkan suara juri.
- Nama Kata yang dimainkan diisi di kolom "Nama Kata" tiap sisi, dan tampil
  di layar skor TV untuk kedua sisi (Aka maupun Shiro/putih).

## 8. Asal Daerah Atlet (provinsi & kota/kabupaten)

- Saat membuat/mengedit bagan, tiap peserta bisa diberi **asal daerah** dengan
  dua dropdown berjenjang: **Provinsi** lalu **Kota/Kabupaten** (dropdown kota
  otomatis menyesuaikan provinsi yang dipilih).
- Di form **Buat Pertandingan** (pertandingan tunggal), provinsi & kota diisi
  untuk sisi Aka (merah) dan Shiro (putih).
- Asal daerah otomatis tampil sebagai **badge teks** di: **bagan
  pertandingan**, **panel kontrol wasit**, dan **layar skor TV** — ditampilkan
  dalam format `Kota · Provinsi` (cth. "Kota Bandung · Jawa Barat").
- Dataset berisi **38 provinsi Indonesia** beserta kota/kabupaten di
  masing-masing, diatur di `js/app.js` (variabel `PROVINCES`).

**Menambah / mengubah daftar kota-kabupaten:** cukup edit `js/app.js` pada
variabel `PROVINCES` — setiap entri berbentuk array
`["Nama Provinsi", ["Kota/Kab 1", "Kota/Kab 2", ...]]`. Contoh:

```js
var PROVINCES = [
  ["Jawa Barat", ["Kota Bandung", "Kota Bogor", "Kab. Bandung", "Kab. Bogor"]],
  // dst...
];
```

Setelah mengubah `js/app.js`, naikkan versi cache di `service-worker.js`
(`CACHE_NAME`) lalu muat ulang aplikasi supaya perubahan ikut ter-cache.

## 9. Kustomisasi

- **Warna/tema**: ubah variabel CSS di bagian atas `css/style.css`
  (`--aka`, `--ao`, `--tatami`, dll).
- **Nama aplikasi/ikon**: ubah `manifest.json` dan file di folder `icons/`.
- **Aturan poin/pelanggaran/Hantei**: logic ada di `js/app.js` pada fungsi
  `addScore`, `changePenalty`, `computeKataTotal`, `runHanteiDecision`.

## 10. Keterbatasan versi localhost

- Data tersimpan per-browser (localStorage). Tab lain harus di perangkat
  yang sama supaya tersinkron.
- Sinkronisasi antar-perangkat (HP wasit ↔ TV lapangan) tidak didukung
  tanpa backend. Untuk itu, ganti `js/db.js` dengan implementasi Firebase
  Realtime Database (API `TCDB.saveMatch` / `loadMatch` / `subscribeMatch`
  sudah disiapkan agar tinggal ditukar).
