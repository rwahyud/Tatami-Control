/* =====================================================================
   APP — Tatami Control
   Logic UI + state machine. Bicara ke database HANYA lewat TCDB
   (lihat js/db.js). Tidak ada dependensi ke Firebase langsung di sini.
   ===================================================================== */
(function () {
  "use strict";

  /* ================= STATE ================= */
  var S = {
    view: "login", // login | admin | bagan | setup | control | display
    setupTab: "new", // new | join
    matchType: "kumite_ind",
    match: null,
    matchCode: "",
    unsub: null, // fungsi unsubscribe realtime
    activeUnsub: null, // fungsi unsubscribe "pertandingan aktif" (khusus layar display)
    online: null, // null=unknown, true/false
    installAvailable: false,
    modal: null,
    formErr: "",
    authErr: "",
    adminErr: "",
    adminOk: "",
    loginRole: "pengguna", // pengguna | admin
    users: null, // cache daftar akun untuk panel admin (null = belum dimuat)
    editPlayers: false,
    tournamentSub: null, // langganan perubahan bagan saat view "bagan"/"baganList"/kejuaraan
    currentTournamentId: null, // id bagan yang sedang dibuka di view "bagan"
    currentEventId: null, // id kejuaraan yang sedang dibuka di view "kejuaraanDetail"
    baganNew: false, // true = form "buat bagan baru" sedang terbuka di daftar bagan
    lockedDisplay: false, // true = layar display terkunci ke match-nya sendiri (multi-tatami)
    baganMatchType: "kumite_ind", // kumite_ind | kata_ind — dipilih di form buat/edit bagan
    baganJudges: 5, // jumlah juri saat jenis bagan = kata
    user: null,
    booting: true
  };

  var buzzedForZero = false; // cegah bunyi berulang saat timer sudah 0

  var APP_VERSION = "19"; // penanda versi (muncul di pojok kanan bawah layar)

  /* ================= PAYMENT (aktivasi aplikasi) =================
     Backend di Cloudflare Worker (ypok-payment). Harga = net ÷ (1 − fee)
     supaya panitia menerima bersih PAY.net. Mode sandbox sekarang. */
  var PAY = {
    worker: CONFIG.PAYMENT_URL,
    net: CONFIG.PAYMENT_NET, // bersih yang diterima panitia (Rp)
    feeRate: CONFIG.PAYMENT_FEE_RATE, // biaya metode pembayaran (0,7%)
    wa: CONFIG.WA_ADMIN, // WhatsApp admin
    state: "idle", // idle | creating | open | success | pending | error | register
    order: null, // { order_id, token, amount, net_amount, fee_rate }
    result: null,
    err: "",
    registerErr: "",
    registerOk: ""
  };
  function payPrice() {
    return Math.ceil(PAY.net / (1 - PAY.feeRate));
  }
  function fmtRupiah(n) {
    return "Rp " + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  /* ================= UTIL ================= */
  function genCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var out = "";
    for (var i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }
  var _cachedCode = null;
  function genCodeCached() {
    if (!_cachedCode) _cachedCode = genCode();
    return _cachedCode;
  }
  function defaultPenalties() {
    return { C1: 0, C2: 0, C3: 0, HC: 0, H: 0 };
  }
  function blankSide(name, province, city) {
    return { name: name || "", province: province || "", city: city || "", score: 0, penalties: defaultPenalties(), senshu: false };
  }

  /* ---- Provinsi & kota di Indonesia ---- */
  var PROVINCES = [
    ["Aceh", ["Kota Banda Aceh", "Kota Sabang", "Kota Lhokseumawe", "Kota Langsa", "Kota Subulussalam", "Kab. Aceh Besar", "Kab. Pidie", "Kab. Pidie Jaya", "Kab. Bireuen", "Kab. Aceh Utara", "Kab. Aceh Barat", "Kab. Aceh Jaya", "Kab. Nagan Raya", "Kab. Aceh Barat Daya", "Kab. Aceh Selatan", "Kab. Simeulue", "Kab. Aceh Singkil", "Kab. Aceh Tenggara", "Kab. Gayo Lues", "Kab. Aceh Tengah", "Kab. Bener Meriah", "Kab. Aceh Timur", "Kab. Aceh Tamiang"]],
    ["Sumatera Utara", ["Kota Medan", "Kota Binjai", "Kota Tebing Tinggi", "Kota Pematangsiantar", "Kota Tanjungbalai", "Kota Sibolga", "Kota Padangsidimpuan", "Kota Gunungsitoli", "Kab. Deli Serdang", "Kab. Serdang Bedagai", "Kab. Karo", "Kab. Dairi", "Kab. Pakpak Bharat", "Kab. Samosir", "Kab. Toba", "Kab. Humbang Hasundutan", "Kab. Tapanuli Utara", "Kab. Tapanuli Tengah", "Kab. Tapanuli Selatan", "Kab. Mandailing Natal", "Kab. Padang Lawas", "Kab. Padang Lawas Utara", "Kab. Labuhanbatu", "Kab. Labuhanbatu Selatan", "Kab. Labuhanbatu Utara", "Kab. Asahan", "Kab. Batu Bara", "Kab. Langkat", "Kab. Simalungun", "Kab. Nias", "Kab. Nias Selatan", "Kab. Nias Utara", "Kab. Nias Barat"]],
    ["Sumatera Barat", ["Kota Padang", "Kota Solok", "Kota Sawahlunto", "Kota Padang Panjang", "Kota Bukittinggi", "Kota Payakumbuh", "Kota Pariaman", "Kab. Padang Pariaman", "Kab. Agam", "Kab. Lima Puluh Kota", "Kab. Pasaman", "Kab. Pasaman Barat", "Kab. Solok", "Kab. Solok Selatan", "Kab. Dharmasraya", "Kab. Sijunjung", "Kab. Tanah Datar", "Kab. Pesisir Selatan", "Kab. Kepulauan Mentawai"]],
    ["Riau", ["Kota Pekanbaru", "Kota Dumai", "Kab. Kampar", "Kab. Rokan Hulu", "Kab. Rokan Hilir", "Kab. Bengkalis", "Kab. Siak", "Kab. Pelalawan", "Kab. Kuantan Singingi", "Kab. Indragiri Hulu", "Kab. Indragiri Hilir", "Kab. Kepulauan Meranti"]],
    ["Kepulauan Riau", ["Kota Batam", "Kota Tanjungpinang", "Kab. Bintan", "Kab. Karimun", "Kab. Kepulauan Anambas", "Kab. Lingga", "Kab. Natuna"]],
    ["Jambi", ["Kota Jambi", "Kota Sungai Penuh", "Kab. Muaro Jambi", "Kab. Batanghari", "Kab. Bungo", "Kab. Tebo", "Kab. Merangin", "Kab. Sarolangun", "Kab. Tanjung Jabung Barat", "Kab. Tanjung Jabung Timur", "Kab. Kerinci"]],
    ["Sumatera Selatan", ["Kota Palembang", "Kota Pagar Alam", "Kota Lubuklinggau", "Kota Prabumulih", "Kab. Banyuasin", "Kab. Ogan Ilir", "Kab. Ogan Komering Ilir", "Kab. Ogan Komering Ulu", "Kab. Ogan Komering Ulu Timur", "Kab. Ogan Komering Ulu Selatan", "Kab. Musi Banyuasin", "Kab. Musi Rawas", "Kab. Musi Rawas Utara", "Kab. Penukal Abab Lematang Ilir", "Kab. Empat Lawang", "Kab. Lahat", "Kab. Muara Enim"]],
    ["Kepulauan Bangka Belitung", ["Kota Pangkalpinang", "Kab. Bangka", "Kab. Bangka Barat", "Kab. Bangka Selatan", "Kab. Bangka Tengah", "Kab. Belitung", "Kab. Belitung Timur"]],
    ["Bengkulu", ["Kota Bengkulu", "Kab. Bengkulu Selatan", "Kab. Bengkulu Tengah", "Kab. Bengkulu Utara", "Kab. Kaur", "Kab. Kepahiang", "Kab. Lebong", "Kab. Mukomuko", "Kab. Rejang Lebong", "Kab. Seluma"]],
    ["Lampung", ["Kota Bandar Lampung", "Kota Metro", "Kab. Lampung Selatan", "Kab. Lampung Tengah", "Kab. Lampung Timur", "Kab. Lampung Utara", "Kab. Lampung Barat", "Kab. Pesisir Barat", "Kab. Tulang Bawang", "Kab. Tulang Bawang Barat", "Kab. Mesuji", "Kab. Way Kanan", "Kab. Tanggamus", "Kab. Pringsewu", "Kab. Pesawaran"]],
    ["DKI Jakarta", ["Kota Jakarta Pusat", "Kota Jakarta Utara", "Kota Jakarta Barat", "Kota Jakarta Selatan", "Kota Jakarta Timur", "Kab. Kepulauan Seribu"]],
    ["Banten", ["Kota Serang", "Kota Cilegon", "Kota Tangerang", "Kota Tangerang Selatan", "Kab. Serang", "Kab. Pandeglang", "Kab. Lebak", "Kab. Tangerang"]],
    ["Jawa Barat", ["Kota Bandung", "Kota Cimahi", "Kota Cirebon", "Kota Depok", "Kota Bekasi", "Kota Bogor", "Kota Sukabumi", "Kota Tasikmalaya", "Kota Banjar", "Kab. Bandung", "Kab. Bandung Barat", "Kab. Cianjur", "Kab. Sukabumi", "Kab. Bogor", "Kab. Bekasi", "Kab. Karawang", "Kab. Purwakarta", "Kab. Subang", "Kab. Indramayu", "Kab. Cirebon", "Kab. Kuningan", "Kab. Majalengka", "Kab. Sumedang", "Kab. Garut", "Kab. Tasikmalaya", "Kab. Ciamis", "Kab. Pangandaran"]],
    ["Jawa Tengah", ["Kota Semarang", "Kota Salatiga", "Kota Magelang", "Kota Surakarta", "Kota Pekalongan", "Kota Tegal", "Kab. Cilacap", "Kab. Banyumas", "Kab. Purbalingga", "Kab. Banjarnegara", "Kab. Kebumen", "Kab. Purworejo", "Kab. Wonosobo", "Kab. Temanggung", "Kab. Magelang", "Kab. Boyolali", "Kab. Klaten", "Kab. Sukoharjo", "Kab. Wonogiri", "Kab. Karanganyar", "Kab. Sragen", "Kab. Grobogan", "Kab. Blora", "Kab. Rembang", "Kab. Pati", "Kab. Kudus", "Kab. Jepara", "Kab. Demak", "Kab. Semarang", "Kab. Kendal", "Kab. Batang", "Kab. Pekalongan", "Kab. Pemalang", "Kab. Tegal", "Kab. Brebes"]],
    ["DI Yogyakarta", ["Kota Yogyakarta", "Kab. Sleman", "Kab. Bantul", "Kab. Kulon Progo", "Kab. Gunungkidul"]],
    ["Jawa Timur", ["Kota Surabaya", "Kota Malang", "Kota Batu", "Kota Kediri", "Kota Blitar", "Kota Madiun", "Kota Mojokerto", "Kota Pasuruan", "Kota Probolinggo", "Kab. Sidoarjo", "Kab. Gresik", "Kab. Lamongan", "Kab. Tuban", "Kab. Bojonegoro", "Kab. Ngawi", "Kab. Magetan", "Kab. Madiun", "Kab. Ponorogo", "Kab. Pacitan", "Kab. Trenggalek", "Kab. Tulungagung", "Kab. Blitar", "Kab. Kediri", "Kab. Nganjuk", "Kab. Jombang", "Kab. Mojokerto", "Kab. Pasuruan", "Kab. Probolinggo", "Kab. Lumajang", "Kab. Jember", "Kab. Banyuwangi", "Kab. Bondowoso", "Kab. Situbondo", "Kab. Pamekasan", "Kab. Sumenep", "Kab. Sampang", "Kab. Bangkalan", "Kab. Malang"]],
    ["Bali", ["Kota Denpasar", "Kab. Badung", "Kab. Gianyar", "Kab. Bangli", "Kab. Klungkung", "Kab. Karangasem", "Kab. Buleleng", "Kab. Tabanan", "Kab. Jembrana"]],
    ["Nusa Tenggara Barat", ["Kota Mataram", "Kota Bima", "Kab. Lombok Barat", "Kab. Lombok Tengah", "Kab. Lombok Timur", "Kab. Lombok Utara", "Kab. Sumbawa", "Kab. Sumbawa Barat", "Kab. Dompu", "Kab. Bima"]],
    ["Nusa Tenggara Timur", ["Kota Kupang", "Kab. Kupang", "Kab. Timor Tengah Selatan", "Kab. Timor Tengah Utara", "Kab. Belu", "Kab. Malaka", "Kab. Rote Ndao", "Kab. Sabu Raijua", "Kab. Sumba Barat", "Kab. Sumba Barat Daya", "Kab. Sumba Tengah", "Kab. Sumba Timur", "Kab. Manggarai", "Kab. Manggarai Barat", "Kab. Manggarai Timur", "Kab. Ngada", "Kab. Nagekeo", "Kab. Ende", "Kab. Sikka", "Kab. Flores Timur", "Kab. Lembata", "Kab. Alor"]],
    ["Kalimantan Barat", ["Kota Pontianak", "Kota Singkawang", "Kab. Kubu Raya", "Kab. Mempawah", "Kab. Landak", "Kab. Sanggau", "Kab. Sekadau", "Kab. Sintang", "Kab. Melawi", "Kab. Kapuas Hulu", "Kab. Bengkayang", "Kab. Sambas", "Kab. Ketapang", "Kab. Kayong Utara"]],
    ["Kalimantan Tengah", ["Kota Palangka Raya", "Kab. Katingan", "Kab. Gunung Mas", "Kab. Pulang Pisau", "Kab. Kapuas", "Kab. Barito Selatan", "Kab. Barito Timur", "Kab. Barito Utara", "Kab. Murung Raya", "Kab. Kotawaringin Barat", "Kab. Kotawaringin Timur", "Kab. Seruyan", "Kab. Sukamara", "Kab. Lamandau"]],
    ["Kalimantan Selatan", ["Kota Banjarmasin", "Kota Banjarbaru", "Kab. Banjar", "Kab. Barito Kuala", "Kab. Tapin", "Kab. Hulu Sungai Selatan", "Kab. Hulu Sungai Tengah", "Kab. Hulu Sungai Utara", "Kab. Balangan", "Kab. Tabalong", "Kab. Tanah Laut", "Kab. Tanah Bumbu", "Kab. Kotabaru"]],
    ["Kalimantan Timur", ["Kota Samarinda", "Kota Balikpapan", "Kota Bontang", "Kab. Kutai Kartanegara", "Kab. Kutai Barat", "Kab. Kutai Timur", "Kab. Mahakam Ulu", "Kab. Paser", "Kab. Penajam Paser Utara", "Kab. Berau"]],
    ["Kalimantan Utara", ["Kota Tarakan", "Kab. Nunukan", "Kab. Malinau", "Kab. Bulungan", "Kab. Tana Tidung"]],
    ["Sulawesi Utara", ["Kota Manado", "Kota Bitung", "Kota Tomohon", "Kota Kotamobagu", "Kab. Minahasa", "Kab. Minahasa Selatan", "Kab. Minahasa Utara", "Kab. Minahasa Tenggara", "Kab. Bolaang Mongondow", "Kab. Bolaang Mongondow Selatan", "Kab. Bolaang Mongondow Timur", "Kab. Bolaang Mongondow Utara", "Kab. Kepulauan Sangihe", "Kab. Kepulauan Sitaro", "Kab. Kepulauan Talaud"]],
    ["Gorontalo", ["Kota Gorontalo", "Kab. Gorontalo", "Kab. Gorontalo Utara", "Kab. Bone Bolango", "Kab. Pohuwato", "Kab. Boalemo"]],
    ["Sulawesi Tengah", ["Kota Palu", "Kab. Donggala", "Kab. Sigi", "Kab. Parigi Moutong", "Kab. Tojo Una-una", "Kab. Toli-Toli", "Kab. Buol", "Kab. Banggai", "Kab. Banggai Kepulauan", "Kab. Banggai Laut", "Kab. Morowali", "Kab. Morowali Utara", "Kab. Poso"]],
    ["Sulawesi Barat", ["Kab. Mamuju", "Kab. Mamuju Tengah", "Kab. Pasangkayu", "Kab. Majene", "Kab. Polewali Mandar"]],
    ["Sulawesi Selatan", ["Kota Makassar", "Kota Parepare", "Kota Palopo", "Kab. Maros", "Kab. Pangkajene dan Kepulauan", "Kab. Barru", "Kab. Bone", "Kab. Soppeng", "Kab. Wajo", "Kab. Sidenreng Rappang", "Kab. Pinrang", "Kab. Enrekang", "Kab. Luwu", "Kab. Luwu Timur", "Kab. Luwu Utara", "Kab. Tana Toraja", "Kab. Toraja Utara", "Kab. Gowa", "Kab. Takalar", "Kab. Jeneponto", "Kab. Bantaeng", "Kab. Bulukumba", "Kab. Sinjai", "Kab. Kepulauan Selayar"]],
    ["Sulawesi Tenggara", ["Kota Kendari", "Kota Baubau", "Kab. Konawe", "Kab. Konawe Selatan", "Kab. Konawe Utara", "Kab. Konawe Kepulauan", "Kab. Kolaka", "Kab. Kolaka Utara", "Kab. Kolaka Timur", "Kab. Muna", "Kab. Muna Barat", "Kab. Buton", "Kab. Buton Utara", "Kab. Buton Selatan", "Kab. Buton Tengah", "Kab. Wakatobi", "Kab. Bombana"]],
    ["Maluku", ["Kota Ambon", "Kota Tual", "Kab. Maluku Tengah", "Kab. Maluku Tenggara", "Kab. Seram Bagian Barat", "Kab. Seram Bagian Timur", "Kab. Buru", "Kab. Buru Selatan", "Kab. Kepulauan Aru", "Kab. Kepulauan Tanimbar", "Kab. Maluku Barat Daya"]],
    ["Maluku Utara", ["Kota Ternate", "Kota Tidore Kepulauan", "Kab. Halmahera Barat", "Kab. Halmahera Tengah", "Kab. Halmahera Timur", "Kab. Halmahera Selatan", "Kab. Halmahera Utara", "Kab. Kepulauan Sula", "Kab. Pulau Morotai", "Kab. Pulau Taliabu"]],
    ["Papua Barat", ["Kab. Manokwari", "Kab. Manokwari Selatan", "Kab. Pegunungan Arfak", "Kab. Teluk Bintuni", "Kab. Teluk Wondama", "Kab. Fakfak", "Kab. Kaimana"]],
    ["Papua Barat Daya", ["Kota Sorong", "Kab. Sorong", "Kab. Sorong Selatan", "Kab. Raja Ampat", "Kab. Tambrauw", "Kab. Maybrat"]],
    ["Papua", ["Kota Jayapura", "Kab. Jayapura", "Kab. Keerom", "Kab. Sarmi", "Kab. Mamberamo Raya", "Kab. Kepulauan Yapen", "Kab. Biak Numfor", "Kab. Supiori", "Kab. Waropen"]],
    ["Papua Tengah", ["Kab. Nabire", "Kab. Paniai", "Kab. Puncak Jaya", "Kab. Puncak", "Kab. Mimika", "Kab. Dogiyai", "Kab. Deiyai", "Kab. Intan Jaya"]],
    ["Papua Pegunungan", ["Kab. Jayawijaya", "Kab. Pegunungan Bintang", "Kab. Yahukimo", "Kab. Tolikara", "Kab. Nduga", "Kab. Lanny Jaya", "Kab. Mamberamo Tengah", "Kab. Yalimo"]],
    ["Papua Selatan", ["Kab. Merauke", "Kab. Mappi", "Kab. Asmat", "Kab. Boven Digoel"]]
  ];
  function provinceOptionsHtml(selected) {
    var sel = selected || "";
    return (
      '<option value="">— Pilih Provinsi —</option>' +
      PROVINCES.map(function (pr) {
        return '<option value="' + escHtml(pr[0]) + '"' + (pr[0] === sel ? " selected" : "") + ">" + escHtml(pr[0]) + "</option>";
      }).join("")
    );
  }
  function citiesOf(province) {
    for (var i = 0; i < PROVINCES.length; i++) if (PROVINCES[i][0] === province) return PROVINCES[i][1];
    return [];
  }
  function cityOptionsHtml(province, selected) {
    var cities = citiesOf(province);
    if (!cities.length) return '<option value="">— Pilih Provinsi dulu —</option>';
    var sel = selected || "";
    return (
      '<option value="">— Pilih Kota —</option>' +
      cities.map(function (c) {
        return '<option value="' + escHtml(c) + '"' + (c === sel ? " selected" : "") + ">" + escHtml(c) + "</option>";
      }).join("")
    );
  }
  /* Teks asal daerah "Kota · Provinsi" untuk panel & layar skor */
  function orgText(s) {
    var parts = [];
    if (s && s.city) parts.push(s.city);
    if (s && s.province) parts.push(s.province);
    return parts.join(" · ");
  }
  /* Label kecil asal daerah untuk bagan (kota bila ada, provinsi di tooltip) */
  function orgBadgeHtml(p, size) {
    var txt = (p && p.city) || (p && p.province) || "";
    if (!txt) return '<span class="org-badge ' + (size || "") + '"></span>';
    return '<span class="org-badge ' + (size || "") + '" title="' + escHtml(orgText(p)) + '">' + escHtml(txt) + "</span>";
  }
  /* Metode penilaian kata: angka (nilai juri) atau bendera (merah/putih) */
  function kataModeOptionsHtml(selected) {
    var sel = selected || "scores";
    return (
      '<select id="t-kata-mode">' +
      '<option value="scores"' + (sel === "scores" ? " selected" : "") + ">Penilaian Angka (nilai juri 0–10)</option>" +
      '<option value="flags"' + (sel === "flags" ? " selected" : "") + ">Penilaian Bendera (merah vs putih)</option>" +
      "</select>"
    );
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var mm = Math.floor(sec / 60);
    var ss = sec % 60;
    return mm + ":" + (ss < 10 ? "0" : "") + ss;
  }
  function escHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg, isErr) {
    var wrap = document.getElementById("toast-wrap");
    if (!wrap) return;
    var el = document.createElement("div");
    el.className = "toast" + (isErr ? " err" : "");
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 3200);
  }

  /* ================= BUKA LAYAR SKOR OTOMATIS =================
     Multi-tatami: tiap pertandingan membuka jendela sendiri dengan NAMA
     JENDELA UNIK per kode (tatami-control-<CODE> / tatami-display-<CODE>).
     Dengan begitu 4 tatami bisa punya 4 jendela kontrol + 4 layar TV
     sekaligus, tanpa saling menimpa. Registry menyimpan referensi jendela
     yang masih terbuka. */
  var winRegistry = {};
  function winKey(name, code) {
    return name + "-" + code;
  }
  function getWinRef(name, code) {
    var w = winRegistry[winKey(name, code)];
    return w && !w.closed ? w : null;
  }
  function openWindow(name, code) {
    var key = winKey(name, code);
    var w = getWinRef(name, code);
    if (!w) {
      w = window.open("about:blank", key);
      if (w) winRegistry[key] = w;
    }
    return w;
  }
  function forgetWin(name, code) {
    delete winRegistry[winKey(name, code)];
  }

  function displayUrl(code, opts) {
    var u = new URL(location.href);
    u.searchParams.set("code", code);
    u.searchParams.set("role", "display");
    if (opts && opts.lock) u.searchParams.set("lock", "1");
    return u.toString();
  }

  function controlUrl(code) {
    var u = new URL(location.href);
    u.searchParams.set("code", code);
    u.searchParams.set("role", "control");
    return u.toString();
  }

  function shareModalHtml() {
    return (
      '<h3>Buka Layar Skor</h3><p style="font-size:14px;color:var(--text-dim);line-height:1.6;">Di jendela/perangkat lain, buka aplikasi ini, pilih <b>Gabung Pertandingan</b>, masukkan kode <b style="color:var(--tatami);font-family:Bebas Neue;font-size:18px;">' +
      S.match.code +
      '</b>, lalu pilih <b>Layar Skor</b>. Skor akan langsung tersinkron otomatis.</p><button class="primary-btn" id="modal-close" style="margin-top:16px;">Mengerti</button>'
    );
  }

  function openDisplayWindow(code, opts) {
    var w = openWindow("tatami-display", code);
    if (w) {
      w.location.href = displayUrl(code, opts);
      try { w.focus(); } catch (e) {}
      return true;
    }
    toast("Pop-up diblokir browser. Aktifkan izin pop-up atau buka layar skor manual.", true);
    showModal(shareModalHtml());
    return false;
  }

  /* ================= AUDIO (buzzer akhir waktu) ================= */
  var audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = "square";
      o.frequency.value = 880;
      g.gain.value = 0.15;
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      setTimeout(function () {
        o.stop();
      }, 550);
    } catch (e) {}
  }

  /* ================= MATCH FACTORY ================= */
  function newMatch(cfg) {
    var code = cfg.code || genCode();
    var m = {
      code: code,
      type: cfg.type,
      category: cfg.category || "",
      court: cfg.court || "",
      tatami: cfg.tatami || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      winner: null,
      timer: { remaining: cfg.duration || 0, endAt: null, running: false },
      duration: cfg.duration || 0
    };
    if (cfg.type === "kumite_ind") {
      m.aka = blankSide(cfg.akaName, cfg.akaProvince, cfg.akaCity);
      m.ao = blankSide(cfg.aoName, cfg.aoProvince, cfg.aoCity);
    } else if (cfg.type === "kumite_team") {
      m.teamAka = { name: cfg.akaName || "", members: cfg.akaMembers || [], wins: 0, province: cfg.akaProvince || "", city: cfg.akaCity || "" };
      m.teamAo = { name: cfg.aoName || "", members: cfg.aoMembers || [], wins: 0, province: cfg.aoProvince || "", city: cfg.aoCity || "" };
      m.matchIndex = 0;
      m.teamLog = [];
      m.aka = blankSide(m.teamAka.members[0] || "Atlet 1", cfg.akaProvince, cfg.akaCity);
      m.ao = blankSide(m.teamAo.members[0] || "Atlet 1", cfg.aoProvince, cfg.aoCity);
    } else if (cfg.type === "kata_ind") {
      m.judgesCount = cfg.judgesCount || 5;
      m.kataMode = cfg.kataMode || "scores"; // "scores" (angka) | "flags" (bendera merah/putih)
      m.aka = { name: cfg.akaName || "", province: cfg.akaProvince || "", city: cfg.akaCity || "", kataName: "", scores: new Array(m.judgesCount).fill(null), total: null };
      m.ao = { name: cfg.aoName || "", province: cfg.aoProvince || "", city: cfg.aoCity || "", kataName: "", scores: new Array(m.judgesCount).fill(null), total: null };
      if (m.kataMode === "flags") m.flagVotes = new Array(m.judgesCount).fill(null);
    } else if (cfg.type === "kata_team") {
      m.judgesCount = cfg.judgesCount || 5;
      m.kataMode = cfg.kataMode || "scores";
      m.teamAka = { name: cfg.akaName || "", members: cfg.akaMembers || [], province: cfg.akaProvince || "", city: cfg.akaCity || "" };
      m.teamAo = { name: cfg.aoName || "", members: cfg.aoMembers || [], province: cfg.aoProvince || "", city: cfg.aoCity || "" };
      m.aka = { name: cfg.akaName || "", province: cfg.akaProvince || "", city: cfg.akaCity || "", kataName: "", scores: new Array(m.judgesCount).fill(null), total: null };
      m.ao = { name: cfg.aoName || "", province: cfg.aoProvince || "", city: cfg.aoCity || "", kataName: "", scores: new Array(m.judgesCount).fill(null), total: null };
      if (m.kataMode === "flags") m.flagVotes = new Array(m.judgesCount).fill(null);
    }
    return m;
  }

  /* ================= TIMER LOGIC ================= */
  function getRemaining(m) {
    if (!m || !m.timer) return 0;
    if (m.timer.running && m.timer.endAt) {
      var rem = (m.timer.endAt - Date.now()) / 1000;
      return Math.max(0, rem);
    }
    return m.timer.remaining;
  }

  /* ================= RENDER DISPATCH ================= */
  function render() {
    var app = document.getElementById("app");
    if (S.view === "landing") app.innerHTML = renderLanding();
    else if (S.view === "login") app.innerHTML = renderLogin();
    else if (S.view === "admin") app.innerHTML = renderAdmin();
    else if (S.view === "kejuaraan") app.innerHTML = renderKejuaraanList();
    else if (S.view === "kejuaraanDetail") app.innerHTML = renderKejuaraanDetail();
    else if (S.view === "baganList") app.innerHTML = renderBaganList();
    else if (S.view === "bagan") app.innerHTML = renderBagan();
    else if (S.view === "setup") app.innerHTML = renderSetup();
    else if (S.view === "control") app.innerHTML = renderControl();
    else if (S.view === "display") app.innerHTML = renderDisplay();
    bindEvents();
    syncTournamentSub();
  }

  /* Langganan perubahan turnamen aktif HANYA saat view "bagan", supaya
     pemenang live score terbaru otomatis tampil tanpa refresh manual. */
  function syncTournamentSub() {
    var onTournamentView =
      S.view === "bagan" ||
      S.view === "baganList" ||
      S.view === "kejuaraan" ||
      S.view === "kejuaraanDetail";
    if (onTournamentView && !S.tournamentSub) {
      S.tournamentSub = TCDB.subscribeTournament(function () {
        if (
          S.view === "bagan" ||
          S.view === "baganList" ||
          S.view === "kejuaraan" ||
          S.view === "kejuaraanDetail"
        ) render();
      });
    } else if (!onTournamentView && S.tournamentSub) {
      S.tournamentSub();
      S.tournamentSub = null;
    }
  }

  function connPillHtml(extraClass) {
    var cls = S.online === null ? "" : S.online ? "online" : "offline";
    var label = S.online === null ? "Menghubungkan…" : S.online ? "Tersambung" : "Offline";
    return '<span class="conn-pill ' + cls + " " + (extraClass || "") + '"><span class="dot"></span>' + label + "</span>";
  }

  function installBannerHtml() {
    if (!S.installAvailable) return "";
    return (
      '<div class="install-banner"><div class="ib-text"><b>Pasang sebagai aplikasi</b>Buka lebih cepat &amp; bisa dipakai tanpa browser, langsung dari layar utama.</div>' +
      '<div style="display:flex;gap:8px;"><button class="install-dismiss" id="install-dismiss">Nanti</button><button class="install-btn" id="install-now">Pasang</button></div></div>'
    );
  }

  /* ================= LANDING + PAYMENT VIEW =================
     Halaman pertama sebelum login: menjelaskan Tatami Control singkat.
     Untuk memakai aplikasi, user membayar sekali (net PAY.net; harga
     tampil = net + biaya metode pembayaran). Setelah lunas, bukti
     dikirim ke WhatsApp admin; admin lalu membuatkan akun secara manual. */
  function renderLanding() {
    if (PAY.state === "success" || PAY.state === "register") return renderRegister();
    if (PAY.state === "pending") return renderPayPending();
    var price = payPrice();
    return (
      '<div class="setup-wrap">' +
      '<div class="brand" style="justify-content:center;">' +
      '<div style="display:flex;align-items:center;gap:12px;"><div class="brand-mark"></div><div class="brand-text"><div class="eyebrow">Tatami Control</div><h1>Skor Karate Langsung</h1></div></div>' +
      "</div>" +
      '<div class="card">' +
      "<h3 style=\"margin:0 0 8px;\">Tentang Tatami Control</h3>" +
      '<p style="margin:0;font-size:13px;color:var(--text-dim);line-height:1.65;">' +
      "Aplikasi pengelola pertandingan karate: membuat bagan pertandingan, kocok peserta otomatis, kontrol skor kumite & kata secara realtime, dan menampilkan layar skor untuk penonton di lapangan — semuanya tersinkron lewat internet." +
      "</p></div>" +
      '<div class="card">' +
      '<h3 style="margin:0 0 4px;">Aktifkan Aplikasi</h3>' +
      '<div class="price-box">' +
      '<div class="price-label">Total yang dibayar</div>' +
      '<div class="price-val">' + fmtRupiah(price) + "</div>" +
      '<div class="price-note">Termasuk biaya metode pembayaran ' + fmtRupiah(price - PAY.net) + "</div>" +
      "</div>" +
      '<button class="primary-btn" id="pay-now" style="width:100%;margin-top:16px;"' + (PAY.state === "creating" ? " disabled" : "") + ">" +
      (PAY.state === "creating" ? "Menyiapkan pembayaran…" : "Bayar &amp; Aktifkan") +
      "</button>" +
      (PAY.err ? '<div class="err-msg">' + escHtml(PAY.err) + "</div>" : "") +
      '<div class="hint" style="text-align:center;margin-top:12px;">Setelah bayar, kamu bisa langsung buat akun dan login.</div>' +
      "</div>" +
      '<button class="small-btn" id="landing-login" style="display:block;margin:0 auto;">Sudah punya akun? Masuk</button>' +
      '<div class="setup-footer">Tatami Control · panel kontrol wasit &amp; layar skor realtime</div>' +
      "</div>"
    );
  }

  function renderRegister() {
    var o = PAY.order || {};
    return (
      '<div class="setup-wrap">' +
      '<div class="brand" style="justify-content:center;">' +
      '<div style="display:flex;align-items:center;gap:12px;"><div class="brand-mark"></div><div class="brand-text"><div class="eyebrow">Tatami Control</div><h1>Buat Akun</h1></div></div>' +
      "</div>" +
      '<div class="card">' +
      "<h3 style=\"margin:0 0 8px;\">Pembayaran Berhasil!</h3>" +
      '<p style="margin:0 0 12px;font-size:13px;color:var(--text-dim);line-height:1.65;">' +
      "ID Pesanan: <b>" + escHtml(o.order_id || "-") + "</b><br>" +
      "Silakan buat akun untuk masuk ke aplikasi." +
      "</p>" +
      '<div class="field"><label>Username</label><input type="text" id="reg-user" placeholder="cth. panitia1" autocomplete="username"></div>' +
      '<div class="field"><label>Password</label><input type="password" id="reg-pass" placeholder="minimal 4 karakter" autocomplete="new-password"></div>' +
      '<button class="primary-btn" id="reg-submit" style="margin-top:16px;width:100%;">Buat Akun</button>' +
      (PAY.registerErr ? '<div class="err-msg">' + escHtml(PAY.registerErr) + "</div>" : "") +
      (PAY.registerOk ? '<div class="ok-msg">' + escHtml(PAY.registerOk) + "</div>" : "") +
      "</div>" +
      '<button class="small-btn" id="landing-login" style="display:block;margin:0 auto;">Sudah punya akun? Masuk</button>' +
      '<div class="setup-footer">Tatami Control · skor karate langsung</div>' +
      "</div>"
    );
  }

  function renderPayPending() {
    var o = PAY.order || {};
    return (
      '<div class="setup-wrap">' +
      '<div class="brand" style="justify-content:center;">' +
      '<div style="display:flex;align-items:center;gap:12px;"><div class="brand-mark"></div><div class="brand-text"><div class="eyebrow">Tatami Control</div><h1>Menunggu Pembayaran</h1></div></div>' +
      "</div>" +
      '<div class="card">' +
      "<h3 style=\"margin:0 0 8px;\">Status: Menunggu</h3>" +
      '<p style="margin:0 0 12px;font-size:13px;color:var(--text-dim);">Pembayaranmu berstatus menunggu konfirmasi (ID: ' + escHtml(o.order_id || "-") + '). Jika sudah selesai bayar, kirim bukti ke WhatsApp admin, atau cek ulang statusnya.</p>' +
      '<button class="primary-btn" id="wa-send" style="width:100%;">Kirim Bukti ke WhatsApp Admin</button>' +
      '<button class="small-btn" id="pay-check" style="display:block;margin:14px auto 0;">Cek Ulang Status Pembayaran</button>' +
      "</div>" +
      '<div class="setup-footer">Tatami Control · skor karate langsung</div>' +
      "</div>"
    );
  }

  function startPayment() {
    PAY.err = "";
    PAY.state = "creating";
    render();
    fetch(PAY.worker + "/create-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ net_amount: PAY.net, item_name: "Aktivasi Aplikasi Tatami Control" })
    })
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, d: d }; });
      })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d && res.d.error ? res.d.error : "Gagal menyiapkan pembayaran.");
        PAY.order = res.d;
        openSnap(res.d.token);
      })
      .catch(function (e) {
        PAY.err = e && e.message ? e.message : "Gagal menyiapkan pembayaran.";
        PAY.state = "error";
        render();
      });
  }

  function openSnap(token) {
    PAY.state = "open";
    render();
    if (!window.snap || !window.snap.pay) {
      PAY.err = "Midtrans Snap belum termuat. Muat ulang halaman lalu coba lagi.";
      PAY.state = "error";
      render();
      return;
    }
    window.snap.pay(token, {
      onSuccess: function (result) {
        PAY.result = result;
        PAY.state = "register";
        render();
      },
      onPending: function (result) {
        PAY.result = result;
        PAY.state = "pending";
        render();
      },
      onError: function () {
        PAY.err = "Pembayaran gagal. Silakan coba lagi.";
        PAY.state = "error";
        render();
      },
      onClose: function () {
        if (PAY.state === "open") {
          PAY.state = "idle";
          render();
        }
      }
    });
  }

  function checkPayment() {
    var o = PAY.order || {};
    if (!o.order_id) { startPayment(); return; }
    fetch(PAY.worker + "/payment-status/" + encodeURIComponent(o.order_id))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var st = d.transaction_status;
        if (st === "settlement" || st === "capture") {
          PAY.state = "register";
          render();
        } else if (st === "pending" || st === "authorize" || !st) {
          PAY.state = "pending";
          render();
        } else {
          PAY.err = "Pembayaran berstatus \"" + st + "\". Silakan coba bayar lagi.";
          PAY.state = "error";
          render();
        }
      })
      .catch(function () {
        PAY.err = "Gagal cek status pembayaran.";
        PAY.state = "error";
        render();
      });
  }

  function sendWhatsApp() {
    var o = PAY.order || {};
    var msg =
      "Halo Admin Tatami Control,\nSaya sudah melakukan pembayaran aktivasi aplikasi.\n\n" +
      "• ID Pesanan: " + (o.order_id || "-") + "\n" +
      "• Total Bayar: " + fmtRupiah(o.amount || payPrice()) + "\n\n" +
      "Mohon diverifikasi dan dibuatkan akunnya. Terima kasih.";
    window.open("https://wa.me/" + PAY.wa + "?text=" + encodeURIComponent(msg), "_blank");
  }

  /* ================= REGISTER (setelah bayar) ================= */
  function handleRegister() {
    var username = (document.getElementById("reg-user") || {}).value || "";
    var password = (document.getElementById("reg-pass") || {}).value || "";
    username = username.trim().toLowerCase();
    PAY.registerErr = "";
    PAY.registerOk = "";

    if (!username || !password) {
      PAY.registerErr = "Isi username & password.";
      render();
      return;
    }
    if (!/^[a-z0-9_.-]{3,20}$/.test(username)) {
      PAY.registerErr = "Username 3-20 karakter (huruf kecil, angka, _ . -).";
      render();
      return;
    }
    if (password.length < 4) {
      PAY.registerErr = "Password minimal 4 karakter.";
      render();
      return;
    }

    var o = PAY.order || {};
    if (!o.order_id) {
      PAY.registerErr = "Order ID tidak ditemukan. Muat ulang halaman dan coba lagi.";
      render();
      return;
    }

    fetch(CONFIG.AUTH_URL + "/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password, payment_order_id: o.order_id })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d.ok) {
          PAY.registerErr = (res.d && res.d.error) || "Gagal membuat akun.";
          render();
          return;
        }
        PAY.registerOk = "Akun berhasil dibuat! Silakan login.";
        PAY.state = "idle";
        PAY.order = null;
        render();
      })
      .catch(function () {
        PAY.registerErr = "Gagal terhubung ke server. Coba lagi.";
        render();
      });
  }

  /* ================= LOGIN VIEW ================= */
  function renderLogin() {
    var role = S.loginRole || "pengguna";
    var isAdminRole = role === "admin";
    return (
      '<div class="setup-wrap">' +
      '<div class="brand" style="justify-content:center;">' +
      '<div style="display:flex;align-items:center;gap:12px;"><div class="brand-mark"></div><div class="brand-text"><div class="eyebrow">Tatami Control</div><h1>Skor Karate Langsung</h1></div></div>' +
      "</div>" +
      '<div class="login-card card">' +
      '<h3 style="margin:0 0 4px;">Masuk</h3>' +
      '<p style="margin:0 0 16px;font-size:13px;color:var(--text-dim);">' +
      (isAdminRole
        ? "Login khusus admin untuk mengelola akun pengguna turnamen."
        : "Login dengan akun panitia yang dibuat admin untuk membuka panel turnamen.") +
      "</p>" +
      '<div class="role-toggle">' +
      '<button class="role-tab ' + (isAdminRole ? "" : "active") + '" data-login-role="pengguna">Pengguna</button>' +
      '<button class="role-tab ' + (isAdminRole ? "active" : "") + '" data-login-role="admin">Admin</button>' +
      "</div>" +
      '<div class="field"><label>Username</label><input type="text" id="lg-user" autocomplete="username" placeholder="Username"></div>' +
      '<div class="field"><label>Password</label><input type="password" id="lg-pass" autocomplete="current-password" placeholder="Password"></div>' +
      '<button class="primary-btn" id="lg-submit" style="margin-top:16px;width:100%;">Masuk sebagai ' + (isAdminRole ? "Admin" : "Pengguna") + "</button>" +
      (S.authErr ? '<div class="err-msg">' + escHtml(S.authErr) + "</div>" : "") +
      '<div class="hint">' +
      (isAdminRole
        ? "Hanya admin yang bisa mengelola akun pengguna turnamen."
        : 'Belum punya akun? Minta dibuatkan oleh admin turnamen.') +
      "</div>" +
      "</div>" +
      '<div class="setup-footer">Tatami Control · panel kontrol wasit & layar skor realtime</div>' +
      "</div>"
    );
  }

  /* ================= ADMIN VIEW ================= */
  function refreshUsers() {
    TCAuth.listUsers().then(function (res) {
      if (res.ok) {
        S.users = res.users;
      } else {
        S.users = [];
        S.adminErr = res.error || "Gagal memuat daftar akun.";
      }
      if (S.view === "admin") render();
    });
  }

  function renderAdmin() {
    var users = S.users;
    var rows;
    if (!users) {
      rows = '<div class="hint">Memuat daftar akun…</div>';
    } else {
      rows = users
        .map(function (u) {
          var isSelf = S.user && u.username === S.user.username;
          return (
            '<div class="user-row">' +
            '<div class="u-info"><div class="u-name">' + escHtml(u.username) + (isSelf ? ' <span class="u-flag">Anda</span>' : "") + '</div>' +
            '<div class="u-role ' + (u.role === "admin" ? "adm" : "") + '">' + (u.role === "admin" ? "Admin" : "Pengguna") + "</div></div>" +
            '<div class="u-actions">' +
            (u.role !== "admin"
              ? '<button class="small-btn" data-reset-pass="' + escHtml(u.username) + '">Reset Password</button>' +
                '<button class="small-btn danger" data-del-user="' + escHtml(u.username) + '">Hapus</button>'
              : "") +
            "</div></div>"
          );
        })
        .join("");
    }

    return (
      '<div class="setup-wrap">' +
      '<div class="brand" style="justify-content:space-between;">' +
      '<div style="display:flex;align-items:center;gap:12px;"><div class="brand-mark"></div><div class="brand-text"><div class="eyebrow">Tatami Control</div><h1>Panel Admin</h1></div></div>' +
      '<div style="display:flex;align-items:center;gap:10px;">' +
      '<span class="user-chip">' + escHtml(S.user ? S.user.username : "admin") + '</span>' +
      '<button class="small-btn" id="btn-to-app">Masuk ke Aplikasi</button>' +
      '<button class="small-btn" id="btn-logout">Keluar</button>' +
      "</div></div>" +
      '<div class="card">' +
      '<h3 style="margin:0 0 4px;">Buat Akun Pengguna</h3>' +
      '<p style="margin:0 0 16px;font-size:13px;color:var(--text-dim);">Akun untuk panitia/pelaksana pertandingan yang akan memakai aplikasi.</p>' +
      '<div class="field"><label>Username</label><input type="text" id="nu-user" placeholder="cth. panitia1"></div>' +
      '<div class="field"><label>Password</label><input type="text" id="nu-pass" placeholder="minimal 4 karakter"></div>' +
      '<button class="primary-btn" id="nu-create" style="margin-top:12px;width:100%;">Buat Akun</button>' +
      (S.adminErr ? '<div class="err-msg">' + escHtml(S.adminErr) + "</div>" : "") +
      (S.adminOk ? '<div class="ok-msg">' + escHtml(S.adminOk) + "</div>" : "") +
      "</div>" +
      '<div class="card"><h3 style="margin:0 0 16px;">Daftar Akun</h3>' +
      (rows ? '<div class="user-list">' + rows + "</div>" : '<div class="hint">Belum ada akun pengguna.</div>') +
      "</div>" +
      '<div class="setup-footer">Tatami Control · manajemen akun turnamen</div>' +
      "</div>"
    );
  }

  /* ================= HEADER / USER MENU ================= */
  function headerRightHtml() {
    var h = connPillHtml();
    if (S.user) h += '<span class="user-chip">' + escHtml(S.user.username) + "</span>";
    if (TCAuth.isAdmin()) h += '<button class="small-btn" id="btn-admin">Panel Admin</button>';
    h += '<button class="small-btn" id="btn-logout">Keluar</button>';
    return h;
  }

  function winnerName(m) {
    if (!m || !m.winner) return "";
    var isTeam = m.type === "kumite_team" || m.type === "kata_team";
    if (m.winner === "aka") return isTeam ? m.teamAka.name : m.aka.name;
    if (m.winner === "ao") return isTeam ? m.teamAo.name : m.ao.name;
    return "Hikiwake / Seri";
  }

  /* ================= SETUP VIEW ================= */
  function typeLabel(t) {
    return {
      kumite_ind: ["Kumite Perorangan", "1 lawan 1, poin & pelanggaran"],
      kumite_team: ["Kumite Beregu", "Tim vs tim, seri pertandingan"],
      kata_ind: ["Kata Perorangan", "Penilaian juri, 1 performa"],
      kata_team: ["Kata Beregu", "Penilaian juri, performa tim"]
    }[t];
  }

  function renderSetup() {
    var isTeam = S.matchType === "kumite_team" || S.matchType === "kata_team";
    var isKata = S.matchType === "kata_ind" || S.matchType === "kata_team";
    var typeOptsHtml = ["kumite_ind", "kumite_team", "kata_ind", "kata_team"]
      .map(function (t) {
        var l = typeLabel(t);
        return (
          '<button class="type-opt ' + (S.matchType === t ? "sel" : "") + '" data-type="' + t + '">' +
          '<div class="t-title">' + l[0] + '</div><div class="t-sub">' + l[1] + "</div></button>"
        );
      })
      .join("");

    var akaMemberFields = "",
      aoMemberFields = "";
    if (isTeam) {
      var n = S.teamSize || 3;
      for (var i = 0; i < n; i++) {
        akaMemberFields += '<div class="member-row"><input type="text" class="ak-member" placeholder="Nama atlet ' + (i + 1) + '"></div>';
        aoMemberFields += '<div class="member-row"><input type="text" class="ao-member" placeholder="Nama atlet ' + (i + 1) + '"></div>';
      }
    }

    var newForm = "";
    if (S.setupTab === "new") {
      newForm =
        "" +
        '<div class="card"><div class="field"><label>Jenis Pertandingan</label><div class="type-grid">' + typeOptsHtml + "</div></div></div>" +
        '<div class="card"><div class="row2">' +
        '<div class="field"><label>Kode Pertandingan</label><input type="text" id="f-code" maxlength="6" value="' +
        (S.pendingCode || genCodeCached()) +
        '" style="text-transform:uppercase; font-family:Bebas Neue; font-size:18px; letter-spacing:0.08em;"></div>' +
        '<div class="field"><label>Tatami / Lapangan</label><input type="text" id="f-court" placeholder="Tatami 1"></div>' +
        "</div>" +
        '<div class="row2">' +
        '<div class="field"><label>Nomor Tatami (opsional)</label><select id="f-tatami">' +
        '<option value="">— Pilih —</option>' +
        [1, 2, 3, 4, 5, 6, 7, 8]
          .map(function (n) { return '<option value="' + n + '">Tatami ' + n + "</option>"; })
          .join("") +
        "</select></div>" +
        '<div class="field"><label>Kategori (usia/sabuk JKA)</label><input type="text" id="f-category" placeholder="Kumite -67kg Senior Putra" list="jka-categories">' +
        '<datalist id="jka-categories">' +
        [
          "Anak-anak Kyu (<16 th)", "Taruna 16–18 th", "Taruna 19–21 th",
          "Dewasa / Senior (22 th+, min. Dan 1)", "Veteran 40–49 th", "Veteran 50–59 th", "Veteran 60 th+"
        ].map(function (c) { return '<option value="' + escHtml(c) + '"></option>'; }).join("") +
        "</datalist></div>" +
        "</div>" +
        (isKata
          ? '<div class="field"><label>Jumlah Juri</label><select id="f-judges">' +
            [3, 4, 5, 7]
              .map(function (j) {
                return '<option value="' + j + '" ' + (j === 5 ? "selected" : "") + ">" + j + " Juri</option>";
              })
              .join("") +
            "</select></div>" +
            '<div class="field"><label>Metode Penilaian</label><select id="f-kata-mode">' +
            '<option value="scores">Penilaian Angka (nilai juri 0–10)</option>' +
            '<option value="flags">Penilaian Bendera (merah vs putih)</option>' +
            "</select></div>"
          : '<div class="field"><label>Durasi Pertandingan (menit:detik)</label><div class="row2">' +
            '<input type="number" id="f-min" min="0" max="10" value="2" placeholder="Menit">' +
            '<input type="number" id="f-sec" min="0" max="59" value="0" placeholder="Detik">' +
            "</div>" +
            '<div style="display:flex;gap:8px;margin-top:8px;">' +
            '<button type="button" class="small-btn" data-duration-preset="90">1:30 · Penyisihan</button>' +
            '<button type="button" class="small-btn" data-duration-preset="120">2:00 · Semifinal/Final</button>' +
            "</div></div>") +
        "</div>" +
        '<div class="corner-row">' +
        '<div class="corner-box aka"><div class="field"><label style="color:var(--aka-glow)">' +
        (isTeam ? "Nama Tim Merah (Aka)" : "Nama Atlet Merah (Aka)") +
        '</label><input type="text" id="f-aka-name" placeholder="' + (isTeam ? "Tim A" : "Nama atlet") + '"></div>' +
        '<div class="field"><label>Provinsi (Aka)</label><select id="f-aka-province">' + provinceOptionsHtml("") + "</select></div>" +
        '<div class="field"><label>Kota/Kabupaten (Aka)</label><select id="f-aka-city">' + cityOptionsHtml("", "") + "</select></div>" +
        (isTeam
          ? '<label style="display:block;font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:6px;text-transform:uppercase;">Anggota Tim</label><div id="aka-members">' +
            akaMemberFields +
            "</div>"
          : "") +
        "</div>" +
        '<div class="corner-box ao"><div class="field"><label style="color:var(--ao-glow)">' +
        (isTeam ? "Nama Tim Putih (Shiro)" : "Nama Atlet Putih (Shiro)") +
        '</label><input type="text" id="f-ao-name" placeholder="' + (isTeam ? "Tim B" : "Nama atlet") + '"></div>' +
        '<div class="field"><label>Provinsi (Shiro)</label><select id="f-ao-province">' + provinceOptionsHtml("") + "</select></div>" +
        '<div class="field"><label>Kota/Kabupaten (Shiro)</label><select id="f-ao-city">' + cityOptionsHtml("", "") + "</select></div>" +
        "</div>" +
        (isTeam ? '<button class="small-btn" id="add-member" style="margin-top:10px;width:100%;">+ Tambah slot atlet</button>' : "") +
        '<button class="primary-btn" id="create-match" style="margin-top:16px;">Buat &amp; Buka Panel Kontrol</button>' +
        '<div class="hint">Panel kontrol untuk wasit/meja. Layar skor otomatis terbuka di jendela baru untuk TV/laptop lapangan. Skor tersinkron realtime antar-jendela.</div>' +
        (S.formErr ? '<div class="err-msg">' + escHtml(S.formErr) + "</div>" : "");
    } else {
      newForm =
        "" +
        '<div class="card"><div class="field"><label>Kode Pertandingan</label><input type="text" id="f-join-code" maxlength="6" placeholder="Contoh: T4K9" style="text-transform:uppercase; font-family:Bebas Neue; font-size:20px; letter-spacing:0.1em;"></div>' +
        '<div class="hint">Masukkan kode yang dibuat di panel kontrol wasit.</div>' +
        '<div class="join-role-grid">' +
        '<button class="join-role-btn" id="join-control"><div class="jr-title">Panel Kontrol</div><div class="jr-sub">Untuk wasit / meja skor</div></button>' +
        '<button class="join-role-btn" id="join-display"><div class="jr-title">Layar Skor</div><div class="jr-sub">Untuk monitor / TV lapangan</div></button>' +
        "</div>" +
        (S.formErr ? '<div class="err-msg">' + escHtml(S.formErr) + "</div>" : "") +
        "</div>";
    }

    return (
      '<div class="setup-wrap">' +
      '<div class="brand" style="justify-content:space-between;">' +
      '<div style="display:flex;align-items:center;gap:12px;"><div class="brand-mark"></div><div class="brand-text"><div class="eyebrow">Tatami Control</div><h1>Skor Karate Langsung</h1></div></div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<button class="small-btn" id="btn-go-bagan">← Bagan</button>' +
      headerRightHtml() +
      "</div></div>" +
      installBannerHtml() +
      '<div class="tab-row">' +
      '<button class="tab-btn ' + (S.setupTab === "new" ? "active" : "") + '" data-tab="new">Buat Pertandingan</button>' +
      '<button class="tab-btn ' + (S.setupTab === "join" ? "active" : "") + '" data-tab="join">Gabung Pertandingan</button>' +
      "</div>" +
      newForm +
      bannerCardHtml() +
      '<div class="setup-footer">Tatami Control · panel kontrol wasit &amp; layar skor realtime</div>' +
      "</div>"
    );
  }

  /* ================= BANNER TURNAMEN ================= */
  function bannerCardHtml() {
    var banner = TCDB.loadBanner();
    return (
      '<div class="card">' +
      '<h3 style="margin:0 0 4px;">Banner Turnamen</h3>' +
      '<p style="margin:0 0 12px;font-size:13px;color:var(--text-dim);">Ditampilkan di layar TV saat pertandingan selesai.</p>' +
      '<input type="file" id="banner-file" accept="image/*">' +
      (banner
        ? '<div class="banner-preview"><img src="' + banner + '" alt="Banner"><button class="small-btn danger" id="banner-clear">Hapus Banner</button></div>'
        : '<div class="hint">Belum ada banner. Unggah gambar (JPG/PNG) untuk tampil di TV saat pertandingan usai.</div>') +
      "</div>"
    );
  }

  /* ================= BAGAN (TURNAMEN) ================= */
  function shuffleArray(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /* Acak urutan peserta dengan aturan: tidak ada dua peserta dari KOTA yang
     sama bersebelahan — karena bagan memasangkan index berurutan di ronde 1
     (0 vs 1, 2 vs 3, dst), ini menjamin peserta sekota TIDAK bertemu di
     pertandingan pertama/ronde 1 selama jumlahnya memungkinkan. Peserta yang
     belum memilih kota dianggap netral (tidak pernah berbenturan). */
  function shuffleAvoidSameCity(players) {
    var buckets = {};
    players.forEach(function (p) {
      var city = (p && p.city) || "";
      (buckets[city] = buckets[city] || []).push(p);
    });
    Object.keys(buckets).forEach(function (k) { buckets[k] = shuffleArray(buckets[k]); });
    var keys = Object.keys(buckets);
    var out = [];
    var prev = null;
    while (keys.length) {
      keys.sort(function (a, b) { return buckets[b].length - buckets[a].length; });
      var pick = null;
      for (var i = 0; i < keys.length; i++) {
        if (buckets[keys[i]].length && keys[i] !== prev) { pick = keys[i]; break; }
      }
      if (pick === null) pick = keys[0]; // dipaksa (kotanya mayoritas > setengah)
      out.push(buckets[pick].shift());
      if (!buckets[pick].length) {
        delete buckets[pick];
        keys = Object.keys(buckets);
      }
      prev = pick;
    }
    return out;
  }

  function computeBracket(t) {
    var players = (t.players || []).map(function (p) {
      return typeof p === "string"
        ? { name: p, province: "", city: "" }
        : { name: p.name || "", province: p.province || "", city: p.city || "" };
    });
    var P = players.length;
    if (P < 2) return [];
    // Selalu padatkan ke pangkat dua penuh (N) supaya bagan seimbang dan
    // pemenang mengalir merata ke ronde berikutnya. Bye hanya ada di ronde 1.
    var R = Math.ceil(Math.log2(P));
    var N = Math.pow(2, R);
    var byes = N - P;
    var byeObj = function () { return { name: "Bye", province: "", city: "" }; };
    var level = [];
    var pi = 0;
    for (var m = 0; m < N / 2; m++) {
      if (pi < byes) {
        // Bye diberikan ke pemain teratas (posisi 1..byes) — jadi pemain di
        // urutan bawah SELALU bertanding di ronde 1 dan tidak ada yang
        // menunggu sampai final tanpa pernah bertanding.
        level.push({ key: "r0-m" + m, p1: players[pi++], p2: byeObj() });
      } else {
        level.push({ key: "r0-m" + m, p1: players[pi++], p2: players[pi++] });
      }
    }
    var rounds = [level];
    var r = 1;
    while (level.length > 1) {
      var next = [];
      level.forEach(function (m) {
        var wn = bracketWinner(t, m);
        if (wn && wn.name && wn.name !== "Bye") next.push({ name: wn.name, province: wn.province || "", city: wn.city || "" });
        else next.push({ name: "", province: "", city: "" }); // masih menunggu pemenang
      });
      var matches = [];
      for (var i = 0; i < next.length; i += 2) {
        matches.push({ key: "r" + r + "-m" + (i / 2), p1: next[i], p2: i + 1 < next.length ? next[i + 1] : byeObj() });
      }
      rounds.push(matches);
      level = matches;
      r++;
    }
    return rounds;
  }

  function bracketWinner(t, m) {
    var wn = t.winners[m.key];
    if (wn) {
      if (m.p1 && m.p1.name === wn) return m.p1;
      if (m.p2 && m.p2.name === wn) return m.p2;
      return null;
    }
    if (m.p1 && m.p1.name === "Bye") return m.p2;
    if (m.p2 && m.p2.name === "Bye") return m.p1;
    return null;
  }

  function bracketChampion(t, rounds) {
    if (!rounds.length) return null;
    var last = rounds[rounds.length - 1];
    if (!last.length) return null;
    var w = bracketWinner(t, last[0]);
    return w && w.name && w.name !== "Bye" ? w.name : null;
  }

  function roundLabel(ri, total) {
    if (total === 1) return "Finals";
    if (ri === total - 1) return "Finals";
    if (ri === total - 2) return "Semifinals";
    return "Round " + (ri + 1);
  }

  /* Halaman daftar SEMUA bagan/turnamen (bisa 10+ dalam satu hari) —
     titik masuk utama setelah login. Dari sini pengguna bisa membuat bagan
     baru atau membuka salah satu bagan yang sudah ada. */
  function renderBaganList() {
    var list = TCDB.listTournaments();
    S.currentEventId = null;
    var showForm = S.baganNew || !list.length;
    var body = "";
    if (showForm) body += tournamentFormHtml(null, list.length > 0);
    if (!showForm) {
      body +=
        '<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
        '<div><h3 style="margin:0 0 2px;">Semua Bagan</h3><div class="t-cat">' + list.length + " bagan/turnamen tersimpan di perangkat ini</div></div>" +
        '<button class="primary-btn" id="t-new-open">+ Buat Bagan Baru</button>' +
        "</div>";
    }
    body += baganListHtml(list);
    return (
      '<div class="setup-wrap">' +
      '<div class="brand" style="justify-content:space-between;">' +
      '<div style="display:flex;align-items:center;gap:12px;"><div class="brand-mark"></div><div class="brand-text"><div class="eyebrow">Tatami Control</div><h1>Bagan Pertandingan</h1></div></div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<button class="small-btn" id="btn-go-kejuaraan">← Kejuaraan</button>' +
      '<button class="small-btn" id="btn-go-setup">Buat Pertandingan</button>' +
      headerRightHtml() +
      "</div></div>" +
      body +
      '<div class="setup-footer">Tatami Control · kocok acak → pertandingan → semifinal → final</div>' +
      "</div>"
    );
  }

  function baganListHtml(list) {
    if (!list.length) return "";
    var html = '<div class="bagan-grid">';
    list.forEach(function (t) {
      var players = t.players || [];
      var rounds = computeBracket(t);
      var champion = bracketChampion(t, rounds);
      var statusHtml = champion
        ? '<div class="champion" style="margin-top:10px;">Juara: ' + escHtml(champion) + "</div>"
        : '<div class="hint" style="margin-top:10px;">' + (players.length ? "Sedang berlangsung" : "Belum ada peserta") + "</div>";
      html +=
        '<div class="card bagan-card">' +
        '<h3 style="margin:0 0 4px;cursor:pointer;" data-open-bagan="' + escHtml(t.id) + '">' + escHtml(t.name || "Turnamen tanpa nama") + "</h3>" +
        '<div class="t-cat"><span class="bagan-type-badge ' + (t.matchType === "kata_ind" ? "kata" : "kumite") + '">' + (t.matchType === "kata_ind" ? "Kata" : "Kumite") + "</span> · " +
        escHtml(t.category || "") + (t.category ? " · " : "") + players.length + " peserta</div>" +
        statusHtml +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">' +
        '<button class="small-btn" data-open-bagan="' + escHtml(t.id) + '">Buka Bagan</button>' +
        '<button class="small-btn danger" data-delete-bagan="' + escHtml(t.id) + '">Hapus</button>' +
        "</div></div>";
    });
    html += "</div>";
    return html;
  }

  /* ================= KEJUARAAN / EVENT =================
     Titik masuk utama setelah login: daftar kejuaraan. Admin mengetik nama
     kejuaraan dulu, lalu membuat 30+ bagan kategori di dalamnya. Bagan tanpa
     kejuaraan tetap tersedia di "Semua Bagan". */
  function renderKejuaraanList() {
    var events = TCDB.listEvents();
    var all = TCDB.listTournaments();

    var cards = "";
    events.forEach(function (ev) {
      var count = all.filter(function (t) { return t.eventId === ev.id; }).length;
      var meta = [ev.venue, ev.date].filter(Boolean).join(" · ");
      cards +=
        '<div class="card bagan-card kej-card">' +
        '<h3 style="margin:0 0 4px;cursor:pointer;" data-open-event="' + escHtml(ev.id) + '">' + escHtml(ev.name || "Kejuaraan tanpa nama") + "</h3>" +
        '<div class="t-cat">' + (meta ? escHtml(meta) : "Kejuaraan") + "</div>" +
        '<div class="kej-count"><span class="kej-num">' + count + "</span> bagan kategori</div>" +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">' +
        '<button class="small-btn" data-open-event="' + escHtml(ev.id) + '">Buka Kejuaraan</button>' +
        '<button class="small-btn danger" data-delete-event="' + escHtml(ev.id) + '">Hapus</button>' +
        "</div></div>";
    });

    var unassignedCount = all.filter(function (t) { return !t.eventId; }).length;

    var form =
      '<div class="card">' +
      '<h3 style="margin:0 0 4px;">Buat Kejuaraan</h3>' +
      '<p style="margin:0 0 16px;font-size:13px;color:var(--text-dim);">Masukkan nama kejuaraan dulu, lalu buat bagan untuk setiap kategori/kelas di dalamnya — bisa 30+ bagan dalam satu kejuaraan.</p>' +
      (S.formErr ? '<div class="err-msg">' + escHtml(S.formErr) + "</div>" : "") +
      '<div class="field"><label>Nama Kejuaraan</label><input type="text" id="ev-name" placeholder="cth. Kejuaraan Karate Open 2026"></div>' +
      '<div class="row2">' +
      '<div class="field"><label>Venue</label><input type="text" id="ev-venue" placeholder="cth. GOR KONI"></div>' +
      '<div class="field"><label>Tanggal</label><input type="date" id="ev-date"></div>' +
      "</div>" +
      '<button class="primary-btn" id="ev-create">Buat Kejuaraan</button>' +
      "</div>";

    return (
      '<div class="setup-wrap">' +
      '<div class="brand" style="justify-content:space-between;">' +
      '<div style="display:flex;align-items:center;gap:12px;"><div class="brand-mark"></div><div class="brand-text"><div class="eyebrow">Tatami Control</div><h1>Kejuaraan</h1></div></div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<button class="small-btn" id="btn-go-baganlist">Semua Bagan</button>' +
      '<button class="small-btn" id="btn-go-setup">Buat Pertandingan</button>' +
      headerRightHtml() +
      "</div></div>" +
      installBannerHtml() +
      form +
      (events.length
        ? '<div class="card"><h3 style="margin:0 0 12px;">Daftar Kejuaraan</h3><div class="bagan-grid">' + cards + "</div></div>"
        : '<div class="card"><div class="hint">Belum ada kejuaraan. Buat kejuaraan di atas untuk mulai menambahkan bagan kategori.</div></div>') +
      (unassignedCount
        ? '<div class="hint" style="text-align:center;">Ada ' + unassignedCount + " bagan tanpa kejuaraan → <button class=\"link-btn\" id=\"btn-go-baganlist\">lihat Semua Bagan</button></div>"
        : "") +
      '<div class="setup-footer">Tatami Control · kejuaraan → 30+ bagan kategori → live score multi-tatami</div>' +
      "</div>"
    );
  }

  /* Detail satu kejuaraan: daftar bagan kategori di dalamnya + tombol buat
     bagan baru (ditandai eventId supaya bagan masuk ke kejuaraan ini). */
  function renderKejuaraanDetail() {
    var ev = TCDB.loadEvent(S.currentEventId);
    if (!ev) {
      S.view = "kejuaraan";
      return renderKejuaraanList();
    }
    var all = TCDB.listTournaments();
    var list = all.filter(function (t) { return t.eventId === ev.id; });

    var body = "";
    if (S.baganNew) {
      body += tournamentFormHtml(null, true);
    } else {
      body +=
        '<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
        '<div><h3 style="margin:0 0 2px;">Kategori / Bagan</h3><div class="t-cat">' + list.length + " bagan dari 30+ kategori yang bisa dibuat</div></div>" +
        '<button class="primary-btn" id="ev-new-bagan">+ Buat Bagan Kategori</button>' +
        "</div>";
    }
    body += baganListHtml(list);

    return (
      '<div class="setup-wrap">' +
      '<div class="brand" style="justify-content:space-between;">' +
      '<div style="display:flex;align-items:center;gap:12px;"><div class="brand-mark"></div><div class="brand-text"><div class="eyebrow">Tatami Control</div><h1>' + escHtml(ev.name || "Kejuaraan") + "</h1></div></div>" +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<button class="small-btn" id="btn-go-kejuaraan">← Kejuaraan</button>' +
      '<button class="small-btn" id="btn-go-setup">Buat Pertandingan</button>' +
      headerRightHtml() +
      "</div></div>" +
      (ev.venue || ev.date
        ? '<div class="t-cat" style="margin-bottom:16px;">' + ([ev.venue, ev.date].filter(Boolean).join(" · ") || "") + "</div>"
        : "") +
      body +
      '<div class="setup-footer">Tatami Control · buat bagan per kategori sampai 30+</div>' +
      "</div>"
    );
  }

  function handleCreateEvent() {
    S.formErr = "";
    var name = document.getElementById("ev-name").value.trim();
    var venue = document.getElementById("ev-venue").value.trim();
    var date = document.getElementById("ev-date").value;
    if (!name) { S.formErr = "Isi nama kejuaraan."; render(); return; }
    var ev = {
      id: "ev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      name: name,
      venue: venue,
      date: date,
      createdAt: Date.now()
    };
    TCDB.saveEvent(ev);
    S.formErr = "";
    S.currentEventId = ev.id;
    S.view = "kejuaraanDetail";
    S.baganNew = true; // langsung tawarkan bagan pertama
    toast("Kejuaraan \"" + name + "\" dibuat.");
    render();
  }

  function handleDeleteEvent(id) {
    var ev = TCDB.loadEvent(id);
    if (!ev) return;
    var inside = TCDB.listTournaments().filter(function (t) { return t.eventId === id; });
    var msg =
      'Hapus kejuaraan "' + ev.name + '"?\n\n' +
      (inside.length
        ? inside.length + " bagan di dalamnya akan dipindah ke \u201cSemua Bagan\u201d (tidak dihapus)."
        : "Bagan di dalamnya (jika ada) akan dipindah ke \u201cSemua Bagan\u201d.");
    if (!confirm(msg)) return;
    inside.forEach(function (t) {
      t.eventId = null;
      TCDB.saveTournament(t);
    });
    TCDB.clearEvent(id);
    if (S.currentEventId === id) S.currentEventId = null;
    S.baganNew = false;
    S.view = "kejuaraan";
    toast("Kejuaraan dihapus.");
    render();
  }

  /* Halaman detail satu bagan (S.currentTournamentId) — kocok acak, edit
     peserta, buka live score tiap laga sampai final. */
  function renderBagan() {
    var t = TCDB.loadTournament(S.currentTournamentId);
    if (!t) {
      S.view = "kejuaraan";
      return renderKejuaraanList();
    }
    var ev = t.eventId ? TCDB.loadEvent(t.eventId) : null;
    var body = tournamentInfoHtml(t) + bracketHtml(t);
    var backLabel = ev ? "← " + escHtml(ev.name) : "← Semua Bagan";
    var backId = ev ? "btn-go-event" : "btn-go-baganlist";
    return (
      '<div class="setup-wrap bagan-page">' +
      '<div class="brand" style="justify-content:space-between;">' +
      '<div style="display:flex;align-items:center;gap:12px;"><div class="brand-mark"></div><div class="brand-text"><div class="eyebrow">Tatami Control</div><h1>Bagan Pertandingan</h1></div></div>' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<button class="small-btn" id="' + backId + '">' + backLabel + "</button>" +
      '<button class="small-btn" id="btn-go-setup">Buat Pertandingan</button>' +
      headerRightHtml() +
      "</div></div>" +
      '<div class="print-area">' +
      '<div class="bracket-title-block">' +
      (ev ? '<div class="bt-event">' + escHtml(ev.name) + "</div>" : "") +
      '<div class="bt-title">' + escHtml(t.name || "Bagan Pertandingan") + "</div>" +
      '<div class="bt-sub">' +
      (t.matchType === "kata_ind" ? "Kata" : "Kumite") +
      (t.matchType === "kata_ind" ? " · " + (t.judgesCount || 5) + " Juri" : "") +
      (t.category ? " · " + escHtml(t.category) : "") +
      " · " + t.players.length + " peserta" +
      "</div>" +
      "</div>" +
      body +
      "</div>" +
      '<div class="setup-footer">Tatami Control · kocok acak → pertandingan → semifinal → final</div>' +
      "</div>"
    );
  }

  function baganTypeOptsHtml() {
    return ["kumite_ind", "kata_ind"]
      .map(function (t) {
        var l = t === "kumite_ind" ? ["Kumite", "Poin, pelanggaran, Hantei"] : ["Kata", "Penilaian juri"];
        return (
          '<button type="button" class="type-opt ' + (S.baganMatchType === t ? "sel" : "") + '" data-bagan-type="' + t + '">' +
          '<div class="t-title">' + l[0] + '</div><div class="t-sub">' + l[1] + "</div></button>"
        );
      })
      .join("");
  }

  function tournamentFormHtml(t, allowCancel) {
    var isKata = S.baganMatchType === "kata_ind";
    var defaultName = "";
    if (!t && S.currentEventId) {
      var ev = TCDB.loadEvent(S.currentEventId);
      if (ev) defaultName = ev.name || "";
    }
    return (
      '<div class="card">' +
      '<h3 style="margin:0 0 4px;">Buat Turnamen &amp; Bagan' + (allowCancel ? " Baru" : "") + "</h3>" +
      '<p style="margin:0 0 16px;font-size:13px;color:var(--text-dim);">Masukkan nama peserta (satu per baris), lalu kocok acak untuk membuat bagan pertandingan sampai final. Setiap kategori/kelas bisa dibuatkan bagannya sendiri — buat sebanyak yang dibutuhkan (10 bagan atau lebih dalam satu hari).</p>' +
      '<div class="field"><label>Jenis Bagan</label><div class="type-grid">' + baganTypeOptsHtml() + "</div></div>" +
      '<div class="field"><label>Nama Turnamen</label><input type="text" id="t-name" placeholder="cth. Kejuaraan Karate Open 2026" value="' + escHtml(t ? t.name : defaultName) + '"></div>' +
      '<div class="field"><label>Kategori</label><input type="text" id="t-cat" placeholder="cth. Kumite -60kg Senior Putra" value="' + escHtml(t ? t.category : "") + '"></div>' +
      (isKata
        ? '<div class="field"><label>Jumlah Juri</label><select id="t-judges">' +
          [3, 4, 5, 7]
            .map(function (j) {
              return '<option value="' + j + '" ' + (j === S.baganJudges ? "selected" : "") + ">" + j + " Juri</option>";
            })
            .join("") +
          "</select></div>" +
          '<div class="field"><label>Metode Penilaian</label>' + kataModeOptionsHtml(t && t.kataMode) + "</div>"
        : '<div class="field"><label>Durasi Tiap Laga (menit)</label><input type="number" id="t-dur" min="1" max="10" value="2"></div>') +
      '<div class="field"><label>Peserta (nama + asal provinsi/kota)</label><div id="t-players">' + playerRowsHtml(t ? t.players : null) + "</div>" +
      '<button type="button" class="small-btn" id="t-add-player" style="margin-top:8px;">+ Tambah Peserta</button></div>' +
      '<div style="display:flex;gap:10px;margin-top:16px;">' +
      '<button class="primary-btn" id="t-create">Kocok Acak &amp; Buat Bagan</button>' +
      (allowCancel ? '<button class="ghost-btn" id="t-new-cancel">Batal</button>' : "") +
      "</div>" +
      (S.formErr ? '<div class="err-msg">' + escHtml(S.formErr) + "</div>" : "") +
      "</div>"
    );
  }

  function tournamentInfoHtml(t) {
    var form = "";
    if (S.editPlayers) {
      var isKataEdit = S.baganMatchType === "kata_ind";
      form =
        '<div class="card">' +
        '<h3 style="margin:0 0 4px;">Edit Peserta</h3>' +
        '<p style="margin:0 0 12px;font-size:13px;color:var(--text-dim);">Simpan akan mengocok ulang urutan bagan.</p>' +
        '<div class="field"><label>Jenis Bagan</label><div class="type-grid">' + baganTypeOptsHtml() + "</div></div>" +
        '<div class="field"><label>Nama Turnamen</label><input type="text" id="t-name" value="' + escHtml(t.name || "") + '"></div>' +
        '<div class="field"><label>Kategori</label><input type="text" id="t-cat" value="' + escHtml(t.category || "") + '"></div>' +
        (isKataEdit
          ? '<div class="field"><label>Jumlah Juri</label><select id="t-judges">' +
            [3, 4, 5, 7]
              .map(function (j) {
                return '<option value="' + j + '" ' + (j === S.baganJudges ? "selected" : "") + ">" + j + " Juri</option>";
              })
              .join("") +
            "</select></div>" +
            '<div class="field"><label>Metode Penilaian</label>' + kataModeOptionsHtml(t.kataMode) + "</div>"
          : '<div class="field"><label>Durasi Tiap Laga (menit)</label><input type="number" id="t-dur" min="1" max="10" value="' + Math.round((t.duration || 120) / 60) + '"></div>') +
        '<div class="field"><label>Peserta (nama + asal provinsi/kota)</label><div id="t-players">' + playerRowsHtml(t.players) + '</div>' +
        '<button type="button" class="small-btn" id="t-add-player" style="margin-top:8px;">+ Tambah Peserta</button></div>' +
        '<div style="display:flex;gap:10px;margin-top:16px;"><button class="primary-btn" id="t-save-edit">Simpan &amp; Kocok Ulang</button><button class="ghost-btn" id="t-cancel-edit">Batal</button></div>' +
        (S.formErr ? '<div class="err-msg">' + escHtml(S.formErr) + "</div>" : "") +
        "</div>";
    }
    var typeBadge = (t.matchType === "kata_ind" ? "Kata" : "Kumite") + (t.matchType === "kata_ind" ? " · " + (t.judgesCount || 5) + " Juri" : "");
    return (
      '<div class="card no-print">' +
      '<div class="t-head"><div><h3 style="margin:0 0 2px;">' + escHtml(t.name || "Turnamen") + '</h3>' +
      '<div class="t-cat"><span class="bagan-type-badge ' + (t.matchType === "kata_ind" ? "kata" : "kumite") + '">' + typeBadge + "</span> · " +
      escHtml(t.category || "") + (t.category ? " · " : "") + t.players.length + " peserta</div></div>" +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button class="small-btn" id="t-shuffle">Kocok Acak</button>' +
      '<button class="small-btn" id="t-edit">Edit Peserta</button>' +
      '<button class="small-btn" id="t-print">Cetak PDF</button>' +
      '<button class="small-btn" id="t-reset">Reset Bagan</button>' +
      '<button class="small-btn danger" id="t-clear">Hapus Turnamen</button>' +
      "</div></div>" +
      "</div>" +
      form
    );
  }

  /* ================= BRACKET GAYA CHALLONGE =================
     Single-elimination dengan tema terang: kolom ronde sejajar kiri→kanan,
     header ronde abu-abu muda, kotak laga berisi 2 baris peserta + nomor
     seed, garis siku abu-abu penghubung dengan nomor urut laga di tengah.
     Bisa di-scroll horizontal dan dicetak ke PDF. */
  var BRK = { matchW: 280, matchH: 76, gap: 20, gutter: 60, top: 60 };

  function bracketLayout(rounds) {
    var R = rounds.length;
    var N = Math.pow(2, R);
    var cellH = BRK.matchH + BRK.gap;
    var content = (N / 2) * cellH;
    var total = BRK.top + content;
    return {
      R: R,
      N: N,
      cellH: cellH,
      content: content,
      total: total,
      /* Posisi vertikal memakai grid pangkat dua penuh: ronde r selalu punya
         N/2^(r+1) slot; laga dengan bye (slot kosong di ujung) tetap duduk
         di posisi gridnya supaya garis siku antar-ronde sejajar. */
      center: function (r, i) {
        return BRK.top + cellH * Math.pow(2, r) * (i + 0.5);
      }
    };
  }

  function bracketHtml(t) {
    var rounds = computeBracket(t);
    if (!rounds.length) return '<div class="card"><div class="hint">Belum ada peserta.</div></div>';
    var lay = bracketLayout(rounds);

    // Nomor laga berurutan global dari Round 1 sampai Final (tidak reset per ronde).
    var num = 0;
    var mnum = [];
    for (var r = 0; r < lay.R; r++) {
      mnum[r] = [];
      for (var i = 0; i < rounds[r].length; i++) { num++; mnum[r][i] = num; }
    }

    var html = '<div class="challonge-wrap"><div class="challonge" style="height:' + lay.total + 'px;">';
    rounds.forEach(function (matches, r) {
      html += '<div class="c-col" style="height:' + lay.total + 'px;">';
      html += '<div class="c-round-title">' + roundLabel(r, lay.R) + "</div>";
      matches.forEach(function (m, i) {
        html += challongeMatchHtml(t, m, r, i, lay);
      });
      if (r < lay.R - 1) html += challongeConnector(r, rounds, lay, mnum);
      html += "</div>";
    });
    html += "</div></div>";
    var champion = bracketChampion(t, rounds);
    if (champion) html += '<div class="champion">Juara: ' + escHtml(champion) + "</div>";
    return html;
  }

  function challongeMatchHtml(t, m, r, i, lay) {
    var w = bracketWinner(t, m);
    var ready = m.p1.name && m.p2.name && m.p1.name !== "Bye" && m.p2.name !== "Bye";
    var top = lay.center(r, i) - BRK.matchH / 2;
    var seed1 = r === 0 ? i * 2 + 1 : null;
    var seed2 = r === 0 ? i * 2 + 2 : null;
    var isBye = m.p1.name === "Bye" || m.p2.name === "Bye";
    var footer;
    if (ready && !w) {
      footer = '<button class="c-live" data-live="' + escHtml(m.key) + '">Live Score</button>';
    } else if (isBye) {
      footer = '<div class="c-foot c-byetext">Bye</div>';
    } else if (w) {
      footer = '<div class="c-foot c-won">Selesai</div>';
    } else {
      footer = '<div class="c-foot c-wait">Menunggu</div>';
    }
    return (
      '<div class="c-match" style="top:' + top + 'px;">' +
      challongeRowHtml(m.p1, seed1, w === m.p1) +
      '<div class="c-divider"></div>' +
      challongeRowHtml(m.p2, seed2, w === m.p2) +
      footer +
      "</div>"
    );
  }

  function challongeRowHtml(p, seed, isWinner) {
    var empty = !p || !p.name || p.name === "Bye";
    var seedHtml = !empty && seed ? '<span class="c-seed">' + seed + "</span>" : '<span class="c-seed c-seed-empty"></span>';
    var nameHtml = empty ? '<span class="c-name c-name-empty">—</span>' : '<span class="c-name">' + escHtml(p.name) + "</span>";
    var badgeHtml = empty ? "" : orgBadgeHtml(p, "sm");
    return (
      '<div class="c-team' + (isWinner ? " win" : "") + (empty ? " empty" : "") + '">' +
      seedHtml + nameHtml + badgeHtml +
      "</div>"
    );
  }

  /* Garis siku penghubung antar ronde (SVG): dari tiap kotak ronde r keluar
     garis horizontal → bertemu garis vertikal → masuk ke kotak ronde r+1.
     Nomor urut laga tampil di tengah siku, sejajar garis vertikal. Pasangan
     memakai grid pangkat dua penuh supaya sejajar walau ada bye. */
  function challongeConnector(r, rounds, lay, mnum) {
    var GW = BRK.gutter;
    var fullCount = lay.N / Math.pow(2, r + 1);
    var nextCount = rounds[r + 1].length;
    var paths = "";
    for (var j = 0; j < fullCount / 2; j++) {
      if (j >= nextCount) continue;
      var y1 = lay.center(r, j * 2);
      var y2 = lay.center(r, j * 2 + 1);
      var ymid = (y1 + y2) / 2;
      paths +=
        '<path d="M 0 ' + y1 + " H " + GW / 2 + " V " + y2 + " M " + GW / 2 + " " + ymid + " H " + GW + '" />' +
        '<text x="' + GW / 2 + '" y="' + (ymid + 3.5) + '">' + mnum[r + 1][j] + "</text>";
    }
    return (
      '<svg class="c-connector" width="' + GW + '" height="' + lay.total + '" style="width:' + GW + "px; height:" + lay.total + 'px;">' +
      paths +
      "</svg>"
    );
  }

  function clearTournamentMatches(t) {
    var codes = (t && t.codes) || {};
    Object.keys(codes).forEach(function (k) { TCDB.deleteMatch(codes[k]); });
  }

  /* Satu baris peserta = input nama + dropdown provinsi + dropdown kota.
     Peserta tersimpan sebagai array objek {name, province, city} supaya asal
     daerah bisa ditampilkan di bagan & layar skor. */
  function playerRowHtml(p) {
    var name = String((p && p.name) || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    var prov = (p && p.province) || "";
    var city = (p && p.city) || "";
    return (
      '<div class="p-row">' +
      '<input type="text" class="p-name" placeholder="Nama peserta" value="' + name + '">' +
      '<select class="p-province">' + provinceOptionsHtml(prov) + "</select>" +
      '<select class="p-city">' + cityOptionsHtml(prov, city) + "</select>" +
      '<button type="button" class="p-remove" title="Hapus baris" aria-label="Hapus peserta">×</button>' +
      "</div>"
    );
  }
  function playerRowsHtml(players) {
    var list = (players || []).map(function (p) {
      return typeof p === "string"
        ? { name: p, province: "", city: "" }
        : { name: (p && p.name) || "", province: (p && p.province) || "", city: (p && p.city) || "" };
    });
    if (!list.length) list = [{ name: "", province: "", city: "" }, { name: "", province: "", city: "" }];
    return list.map(playerRowHtml).join("");
  }
  function parsePlayerRows() {
    var box = document.getElementById("t-players");
    if (!box) return [];
    return Array.prototype.slice.call(box.querySelectorAll(".p-row")).map(function (row) {
      var nameEl = row.querySelector(".p-name"), provEl = row.querySelector(".p-province"), cityEl = row.querySelector(".p-city");
      var name = (nameEl ? nameEl.value : "").trim();
      var province = (provEl ? provEl.value : "").trim();
      var city = (cityEl ? cityEl.value : "").trim();
      return { name: name, province: province, city: city };
    }).filter(function (p) { return p.name; });
  }

  function handleCreateTournament() {
    S.formErr = "";
    var name = document.getElementById("t-name").value.trim();
    var cat = document.getElementById("t-cat").value.trim();
    var isKata = S.baganMatchType === "kata_ind";
    var durEl = document.getElementById("t-dur");
    var dur = Math.max(1, Number((durEl && durEl.value) || 2)) * 60;
    var judgesEl = document.getElementById("t-judges");
    var judges = Math.max(1, Number((judgesEl && judgesEl.value) || 5));
    var players = parsePlayerRows();
    if (players.length < 2) { S.formErr = "Minimal 2 peserta."; render(); return; }
    // Selalu buat bagan BARU dengan id unik — jadi satu turnamen bisa punya
    // banyak bagan/kategori (10+) sekaligus, tanpa menimpa bagan yang lain.
    var t = { id: "t_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7), codes: {}, winners: {}, createdAt: Date.now() };
    t.name = name; t.category = cat;
    if (S.currentEventId) t.eventId = S.currentEventId; // bagan milik kejuaraan ini
    t.matchType = isKata ? "kata_ind" : "kumite_ind";
    if (isKata) {
      t.judgesCount = judges;
      var kmEl = document.getElementById("t-kata-mode");
      t.kataMode = (kmEl && kmEl.value) || "scores";
    } else {
      t.duration = dur;
    }
    t.players = shuffleAvoidSameCity(players);
    TCDB.saveTournament(t);
    S.editPlayers = false;
    S.baganNew = false;
    S.currentTournamentId = t.id;
    S.view = "bagan";
    toast("Bagan " + (isKata ? "Kata" : "Kumite") + " dibuat. Urutan dikocok acak (peserta sekota tidak bertemu di ronde 1).");
    render();
  }

  function handleShuffle() {
    var t = TCDB.loadTournament(S.currentTournamentId);
    if (!t || !t.players || t.players.length < 2) { toast("Minimal 2 peserta.", true); return; }
    clearTournamentMatches(t);
    t.players = shuffleAvoidSameCity(t.players);
    t.winners = {};
    t.codes = {};
    TCDB.saveTournament(t);
    toast("Urutan bagan dikocok ulang (peserta sekota tidak bertemu di ronde 1).");
    render();
  }

  function handleSaveEdit() {
    var t = TCDB.loadTournament(S.currentTournamentId);
    if (!t) return;
    S.formErr = "";
    var name = document.getElementById("t-name").value.trim();
    var cat = document.getElementById("t-cat").value.trim();
    var isKata = S.baganMatchType === "kata_ind";
    var durEl = document.getElementById("t-dur");
    var dur = Math.max(1, Number((durEl && durEl.value) || 2)) * 60;
    var judgesEl = document.getElementById("t-judges");
    var judges = Math.max(1, Number((judgesEl && judgesEl.value) || 5));
    var players = parsePlayerRows();
    if (players.length < 2) { S.formErr = "Minimal 2 peserta."; render(); return; }
    clearTournamentMatches(t);
    t.name = name; t.category = cat;
    t.matchType = isKata ? "kata_ind" : "kumite_ind";
    if (isKata) {
      t.judgesCount = judges;
      var kmEdit = document.getElementById("t-kata-mode");
      t.kataMode = (kmEdit && kmEdit.value) || "scores";
    } else {
      t.duration = dur;
    }
    t.players = shuffleAvoidSameCity(players);
    t.winners = {};
    t.codes = {};
    TCDB.saveTournament(t);
    S.editPlayers = false;
    toast("Peserta diperbarui & bagan dikocok ulang.");
    render();
  }

  function handleResetBagan() {
    var t = TCDB.loadTournament(S.currentTournamentId);
    if (!t) return;
    if (!confirm("Reset bagan? Semua pemenang & live score akan dikosongkan.")) return;
    clearTournamentMatches(t);
    t.winners = {};
    t.codes = {};
    TCDB.saveTournament(t);
    toast("Bagan direset.");
    render();
  }

  function handleClearTournament() {
    var t = TCDB.loadTournament(S.currentTournamentId);
    if (!t) return;
    if (!confirm("Hapus bagan ini? Semua bagan & live score terkait akan dihapus.")) return;
    clearTournamentMatches(t);
    TCDB.clearTournament(t.id);
    S.editPlayers = false;
    S.currentTournamentId = null;
    backFromBagan();
    toast("Bagan dihapus.");
    render();
  }

  /* Kembali dari halaman bagan ke tempat asalnya: kejuaraan (kalau bagan ini
     dibuat di dalam kejuaraan) atau "Semua Bagan" (bagan mandiri). */
  function backFromBagan() {
    var t = TCDB.loadTournament(S.currentTournamentId);
    if (t && t.eventId && TCDB.loadEvent(t.eventId)) {
      S.currentEventId = t.eventId;
      S.view = "kejuaraanDetail";
    } else {
      S.view = "baganList";
    }
    S.currentTournamentId = null;
    S.editPlayers = false;
    S.baganNew = false;
  }

  /* Hapus bagan langsung dari kartu di daftar "Semua Bagan", tanpa perlu
     membukanya dulu. */
  function handleDeleteBaganFromList(id) {
    var t = TCDB.loadTournament(id);
    if (!t) return;
    if (!confirm('Hapus bagan "' + (t.name || "ini") + '"? Semua live score terkait akan dihapus.')) return;
    clearTournamentMatches(t);
    TCDB.clearTournament(id);
    toast("Bagan dihapus.");
    render();
  }

  /* Tombol "Live Score" di bagan: tanya dulu tatami/layar TV mana yang
     dipakai, lalu buka panel kontrol + layar TV untuk laga itu. Karena tiap
     tatami punya layar TV sendiri, tiap laga dibuka di jendela tersendiri
     (multi-tatami) dan layarnya terkunci ke laga itu. */
  function handleLiveScore(key) {
    var t = TCDB.loadTournament(S.currentTournamentId);
    if (!t) return;
    showTatamiModal(key);
  }

  function tatamiPickerModalHtml() {
    var btns = "";
    for (var i = 1; i <= 8; i++) {
      btns += '<button type="button" class="tatami-opt" data-tatami="' + i + '"><span class="t-num">' + i + "</span>Tatami</button>";
    }
    return (
      '<h3>Buka Live Score</h3>' +
      '<p style="font-size:13px;color:var(--text-dim);line-height:1.6;">Pilih tatami / layar TV untuk laga ini. Setiap tatami punya layar TV-nya sendiri — buka laga lain dengan nomor tatami yang berbeda supaya layarnya tidak bertukar.</p>' +
      '<div class="tatami-grid">' + btns + "</div>" +
      '<div style="display:flex;gap:10px;margin-top:14px;">' +
      '<button type="button" class="ghost-btn" style="margin-top:0;" id="modal-cancel">Batal</button>' +
      '<button type="button" class="ghost-btn" style="margin-top:0;" id="tatami-none">Tanpa Label</button>' +
      "</div>"
    );
  }

  function showTatamiModal(key) {
    var bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = '<div class="modal-box">' + tatamiPickerModalHtml() + "</div>";
    document.body.appendChild(bg);
    bg.querySelectorAll("[data-tatami]").forEach(function (b) {
      b.onclick = function () { bg.remove(); openLiveScore(key, Number(b.dataset.tatami)); };
    });
    var none = bg.querySelector("#tatami-none");
    if (none) none.onclick = function () { bg.remove(); openLiveScore(key, null); };
    var cancel = bg.querySelector("#modal-cancel");
    if (cancel) cancel.onclick = function () { bg.remove(); };
    bg.onclick = function (e) { if (e.target === bg) bg.remove(); };
  }

  function openLiveScore(key, tatami) {
    var t = TCDB.loadTournament(S.currentTournamentId);
    if (!t) return;
    if (!t.codes[key]) t.codes[key] = genCode();
    var code = t.codes[key];
    var rounds = computeBracket(t);
    var bm = null;
    rounds.forEach(function (matches) {
      matches.forEach(function (mm) { if (mm.key === key) bm = mm; });
    });
    if (!bm) return;

    // Buka 2 layar SEKARANG dalam gesture klik supaya tidak diblokir pop-up:
    // (1) panel kontrol wasit/juri/admin, (2) layar skor TV. Nama jendela
    // unik per kode → beberapa tatami bisa berjalan bersamaan.
    var cw = openWindow("tatami-control", code);
    var dw = openWindow("tatami-display", code);

    (async function () {
      TCDB.saveTournament(t);
      var existing = await TCDB.loadMatch(code);
      var isKataBagan = t.matchType === "kata_ind";
      var bout = existing || newMatch(
        isKataBagan
          ? {
              type: "kata_ind",
              code: code,
              category: t.category || "",
              court: t.name || "",
              tatami: tatami,
              judgesCount: t.judgesCount || 5,
              kataMode: t.kataMode || "scores",
              akaName: bm.p1.name,
              akaProvince: bm.p1.province,
              akaCity: bm.p1.city,
              aoName: bm.p2.name,
              aoProvince: bm.p2.province,
              aoCity: bm.p2.city
            }
          : {
              type: "kumite_ind",
              code: code,
              category: t.category || "",
              court: t.name || "",
              tatami: tatami,
              duration: t.duration || 120,
              akaName: bm.p1.name,
              akaProvince: bm.p1.province,
              akaCity: bm.p1.city,
              aoName: bm.p2.name,
              aoProvince: bm.p2.province,
              aoCity: bm.p2.city
            }
      );
      bout.bracket = { key: key, tournamentId: t.id };
      var ok = await TCDB.saveMatch(bout);
      if (!ok) {
        if (cw && !cw.closed) cw.close();
        if (dw && !dw.closed) dw.close();
        forgetWin("tatami-control", code);
        forgetWin("tatami-display", code);
        toast("Gagal membuat pertandingan. Muat ulang halaman & coba lagi.", true);
        return;
      }
      // Tandai sebagai pertandingan aktif di perangkat ini — layar display
      // yang TIDAK terkunci akan otomatis pindah ke pertandingan ini.
      TCDB.saveActiveMatch(code);
      if (cw && !cw.closed) {
        cw.location.href = controlUrl(code);
        try { cw.focus(); } catch (e) {}
      } else {
        toast("Layar kontrol diblokir. Buka manual lewat Gabung Pertandingan.", true);
      }
      if (dw && !dw.closed) {
        dw.location.href = displayUrl(code, { lock: true });
        try { dw.focus(); } catch (e) {}
      } else {
        toast("Layar skor diblokir. Buka manual lewat Gabung Pertandingan.", true);
      }
    })();
  }

  /* ================= CONTROL VIEW ================= */
  function renderControl() {
    var m = S.match;
    if (!m) return '<div class="setup-wrap"><p>Memuat pertandingan…</p></div>';
    var isKata = m.type === "kata_ind" || m.type === "kata_team";
    var isTeam = m.type === "kumite_team" || m.type === "kata_team";
    var rem = getRemaining(m);

    var html =
      '<div class="ctrl-topbar">' +
      '<div class="meta"><div class="code code-copy" id="copy-code" title="Klik untuk salin kode">' +
      m.code +
      '</div><div class="cat">' +
      escHtml(m.category || "Tanpa kategori") +
      (m.court ? " · " + escHtml(m.court) : "") +
      "</div></div>" +
      '<div class="topbar-actions">' +
      connPillHtml() +
      '<button class="icon-btn" id="btn-share-display">Buka Layar Skor</button>' +
      '<button class="icon-btn" id="btn-reset-match">Reset Skor</button>' +
      '<button class="icon-btn" id="btn-back-setup">Selesai</button>' +
      "</div>" +
      "</div>";

    html += '<div class="ctrl-body">';

    if (!isKata) {
      var low = rem <= 10 && rem > 0;
      html +=
        '<div class="timer-block"><div class="timer-digit ' +
        (m.timer.running ? "running" : "") +
        " " +
        (low ? "low" : "") +
        '">' +
        fmtTime(rem) +
        '</div><div class="timer-btns">' +
        '<button class="go" id="t-start" ' + (m.timer.running ? "disabled" : "") + ">Mulai</button>" +
        '<button id="t-pause" ' + (!m.timer.running ? "disabled" : "") + ">Jeda</button>" +
        '<button class="stop" id="t-reset">Reset</button>' +
        "</div></div>";
    }

    if (isTeam) {
      var akaWins = m.teamAka.wins || 0,
        aoWins = m.teamAo.wins || 0;
      html +=
        '<div class="team-tally"><span class="side-name aka-side">' +
        escHtml(m.teamAka.name || "Tim Merah") +
        '</span><span class="vs-num">' +
        akaWins +
        " — " +
        aoWins +
        '</span><span class="side-name ao-side">' +
        escHtml(m.teamAo.name || "Tim Putih") +
        '</span><span class="idx-pill">Laga ' +
        ((m.matchIndex || 0) + 1) +
        " / " +
        m.teamAka.members.length +
        "</span></div>";
    }

    html += !isKata ? renderKumitePanels(m) : renderKataPanels(m);

    if (m.winner) {
      var wname = winnerName(m);
      html += '<div class="win-banner ' + (m.winner === "draw" ? "" : m.winner) + '">Pemenang: ' + escHtml(wname || "-") + "</div>";
    }

    if (!m.winner && !isKata && rem <= 0 && m.aka.score === m.ao.score) {
      html +=
        '<div class="winner-block"><button class="primary-btn" id="open-hantei" style="width:100%;">⚖ Buka Hantei (Skor Sama — Waktu Habis)</button></div>';
    }

    if (!m.winner) {
      html +=
        '<div class="winner-block"><button class="win-aka" id="win-aka">AKA MENANG</button>' +
        (!isKata ? '<button class="win-draw" id="win-draw">HIKIWAKE / SERI</button>' : "") +
        '<button class="win-ao" id="win-ao">SHIRO MENANG</button></div>';
    } else if (isTeam) {
      html += '<button class="next-match-btn" id="next-bout">Lanjut ke Atlet Berikutnya →</button>';
    } else {
      html += '<div class="winner-block"><button class="ghost-btn" id="clear-winner" style="max-width:220px;margin:14px auto 0;">Ubah Keputusan</button></div>';
    }

    if (isTeam) {
      html +=
        '<div class="team-section"><h3>Susunan Tim</h3><div class="roster-grid">' +
        '<ul class="roster-list">' +
        m.teamAka.members
          .map(function (nm, i) {
            var cls = i === m.matchIndex ? "current" : i < m.matchIndex ? "done" : "";
            return '<li class="' + cls + '">' + (i + 1) + ". " + escHtml(nm || "Atlet " + (i + 1)) + "</li>";
          })
          .join("") +
        '</ul><ul class="roster-list">' +
        m.teamAo.members
          .map(function (nm, i) {
            var cls = i === m.matchIndex ? "current" : i < m.matchIndex ? "done" : "";
            return '<li class="' + cls + '">' + (i + 1) + ". " + escHtml(nm || "Atlet " + (i + 1)) + "</li>";
          })
          .join("") +
        "</ul></div></div>";
    }

    html += "</div>";
    html += '<button class="fs-btn fs-back" id="ctrl-back">Kembali ke Bagan</button>';
    return html;
  }

  /* Label pelanggaran gaya JKA. Key data tetap C1/C2/C3/HC/H (kompatibel data lama),
     ditampilkan sebagai istilah resmi JKA:
     Kategori Jogai (keluar tatami): C1=Jogai, C2=Jogai Chui
     Kategori Kontak/Teknik: C3=Atsu-i/Keikoku, HC=Chui, H=Hansoku (diskualifikasi) */
  var PEN_LABELS = { C1: "Jogai", C2: "Jogai Chui", C3: "Keikoku", HC: "Chui", H: "Hansoku" };
  var PEN_FULL = {
    C1: "Jogai — keluar tatami (peringatan 1)",
    C2: "Jogai Chui — keluar tatami ke-2",
    C3: "Keikoku / Atsu-i — peringatan kontak ringan",
    HC: "Chui — peringatan keras, lawan diuntungkan",
    H: "Hansoku — diskualifikasi, lawan menang"
  };

  function renderKumitePanels(m) {
    function penCell(side, key) {
      var val = m[side].penalties[key];
      return (
        '<div class="pen-cell ' + (val > 0 ? "hot" : "") + '" title="' + PEN_FULL[key] + '"><div class="pc-label">' + PEN_LABELS[key] + '</div><div class="pc-val">' + val + "</div>" +
        '<div class="pc-btns"><button data-pen-dec data-side="' + side + '" data-pen="' + key + '">–</button><button data-pen-inc data-side="' + side + '" data-pen="' + key + '">+</button></div></div>'
      );
    }
    function panel(side, colorClass) {
      var s = m[side];
      var other = side === "aka" ? "ao" : "aka";
      var hansoku = s.penalties.H > 0;
      return (
        '<div class="side-panel ' + colorClass + '">' +
        '<div class="side-head"><div class="side-id">' + orgBadgeHtml(s, "md") +
        '<div class="side-id-txt"><div class="side-name">' +
        escHtml(s.name || (colorClass === "aka" ? "Merah (Aka)" : "Putih (Shiro)")) +
        '</div><div class="side-country">' + escHtml(orgText(s)) + "</div></div></div>" +
        '<div class="senshu-chip ' + (s.senshu ? "on" : "") + '">Senshu</div></div>' +
        '<div class="score-num"><div class="num">' + s.score + "</div></div>" +
        '<div class="score-btn-row">' +
        '<button class="score-btn" data-score data-side="' + side + '" data-pts="1">+1<span class="sb-sub">Ippon</span></button>' +
        '<button class="score-btn" data-score data-side="' + side + '" data-pts="2">+2<span class="sb-sub">Nihon</span></button>' +
        '<button class="score-btn" data-score data-side="' + side + '" data-pts="3">+3<span class="sb-sub">Sanbon</span></button>' +
        "</div>" +
        '<div class="minus-row"><button data-score data-side="' + side + '" data-pts="-1">Koreksi -1</button></div>' +
        '<div class="penalty-label">Pelanggaran (JKA)</div><div class="penalty-row">' +
        penCell(side, "C1") + penCell(side, "C2") + penCell(side, "C3") + penCell(side, "HC") + penCell(side, "H") +
        "</div>" +
        (hansoku && !m.winner
          ? '<button class="win-banner-btn" data-hansoku-win data-side="' + other + '" style="width:100%;margin-top:10px;background:#c0392b;color:#fff;border:none;border-radius:8px;padding:10px;font-weight:700;">⚠ Hansoku! Menangkan lawan sekarang</button>'
          : "") +
        '<button class="senshu-toggle ' + (s.senshu ? "on" : "") + '" data-senshu data-side="' + side + '">' +
        (s.senshu ? "Senshu aktif — klik untuk hapus" : "Tandai Senshu (poin pertama, cadangan Hantei)") +
        "</button></div>"
      );
    }
    return '<div class="panels">' + panel("aka", "aka") + panel("ao", "ao") + "</div>";
  }

  function computeKataTotal(scores) {
    var filled = scores.filter(function (v) { return v !== null && v !== undefined && v !== ""; }).map(Number);
    if (filled.length !== scores.length) return null;
    // Total = jumlah SEMUA nilai juri (tidak ada nilai yang dibuang).
    return filled.reduce(function (a, b) { return a + b; }, 0);
  }

  function kataFlagDecision(m) {
    var votes = m.flagVotes || [];
    var aka = 0, ao = 0;
    votes.forEach(function (v) { if (v === "aka") aka++; else if (v === "ao") ao++; });
    var needed = Math.floor(votes.length / 2) + 1;
    if (aka >= needed) return "aka";
    if (ao >= needed) return "ao";
    return null;
  }

  /* Ikon bendera kecil (merah/putih) untuk tombol vote juri di panel kontrol */
  function flagMark(side) {
    return '<span class="flag-mark ' + side + '"></span>';
  }

  function renderKataFlagPanel(m) {
    var votes = m.flagVotes || [];
    var akaVotes = votes.filter(function (v) { return v === "aka"; }).length;
    var aoVotes = votes.filter(function (v) { return v === "ao"; }).length;
    var dec = kataFlagDecision(m);
    var cells = votes
      .map(function (v, i) {
        return (
          '<div class="jflag">' +
          '<div class="jflag-label">J' + (i + 1) + "</div>" +
          '<div class="jflag-btns">' +
          '<button class="jflag-btn aka' + (v === "aka" ? " on" : "") + '" data-kata-flag data-idx="' + i + '" data-side="aka" title="Bendera merah (Aka)">' + flagMark("aka") + "</button>" +
          '<button class="jflag-btn ao' + (v === "ao" ? " on" : "") + '" data-kata-flag data-idx="' + i + '" data-side="ao" title="Bendera putih (Shiro)">' + flagMark("ao") + "</button>" +
          "</div></div>"
        );
      })
      .join("");
    var decHtml = dec
      ? '<div class="kata-flag-dec ' + dec + '"><span class="flag-mark ' + dec + '"></span> ' + (dec === "aka" ? escHtml(m.aka.name || "AKA") : escHtml(m.ao.name || "SHIRO")) + " MENANG</div>"
      : '<div class="kata-flag-dec wait">Menunggu mayoritas juri…</div>';
    return (
      '<div class="kata-side kata-flag-card">' +
      '<div class="kata-flag-names">' +
      '<input type="text" class="kata-name-input" placeholder="Nama Kata Aka" data-kata-name data-side="aka" value="' + escHtml(m.aka.kataName || "") + '">' +
      '<input type="text" class="kata-name-input" placeholder="Nama Kata Shiro" data-kata-name data-side="ao" value="' + escHtml(m.ao.kataName || "") + '">' +
      "</div>" +
      '<div class="kata-vote-tally">' +
      '<div class="kv-side aka"><div class="kv-name">' + escHtml(m.aka.name || "AKA") + '</div><div class="kv-count">' + akaVotes + "</div></div>" +
      '<div class="kv-vs">Keputusan Bendera</div>' +
      '<div class="kv-side ao"><div class="kv-name">' + escHtml(m.ao.name || "SHIRO") + '</div><div class="kv-count">' + aoVotes + "</div></div>" +
      "</div>" +
      '<div class="judge-grid flag">' + cells + "</div>" +
      '<div class="kata-total">' + decHtml + '<div class="label">Tiap juri angkat 1 bendera — hanya bendera pemenang (merah/putih) yang tampil di layar</div></div>' +
      "</div>"
    );
  }

  function renderKataPanels(m) {
    if (m.kataMode === "flags") return '<div class="panels">' + renderKataFlagPanel(m) + "</div>";
    function panel(side, colorClass) {
      var s = m[side];
      var total = computeKataTotal(s.scores);
      var judgesHtml = s.scores
        .map(function (v, i) {
          return (
            '<div class="judge-cell"><label>J' + (i + 1) + "</label>" +
            '<input type="number" step="0.1" min="0" max="10" data-kata-score data-side="' + side + '" data-idx="' + i + '" value="' + (v === null ? "" : v) + '"></div>'
          );
        })
        .join("");
      return (
        '<div class="kata-side ' + colorClass + '"><div class="side-head"><div class="side-id">' + orgBadgeHtml(s, "md") +
        '<div class="side-id-txt"><div class="side-name">' +
        escHtml(s.name || (colorClass === "aka" ? "Aka" : "Shiro")) +
        '</div><div class="side-country">' + escHtml(orgText(s)) + "</div></div></div></div>" +
        '<input type="text" class="kata-name-input" placeholder="Nama Kata (mis. Kanku Dai)" data-kata-name data-side="' + side + '" value="' + escHtml(s.kataName || "") + '">' +
        '<div class="judge-grid">' + judgesHtml + "</div>" +
        '<div class="kata-total"><div class="num">' + (total === null ? "—" : total.toFixed(1)) + '</div><div class="label">Total (jumlah seluruh juri)</div></div>' +
        "</div>"
      );
    }
    return '<div class="panels">' + panel("aka", "aka") + panel("ao", "ao") + "</div>";
  }

  /* ================= DISPLAY VIEW ================= */
  function renderDisplay() {
    var m = S.match;
    if (!m) return '<div class="disp-wrap"><div class="disp-footer">Memuat pertandingan…</div></div>';

    // Pertandingan selesai → tampilkan banner turnamen di layar TV.
    if (m.winner) return renderBannerScreen(m);

    var isKata = m.type === "kata_ind" || m.type === "kata_team";
    var rem = getRemaining(m);
    var low = rem <= 10 && rem > 0;

    var akaName = escHtml((m.aka && m.aka.name) || "AKA");
    var shiroName = escHtml((m.ao && m.ao.name) || "SHIRO");

    var html = '<div class="disp-wrap">';
    html +=
      '<div class="disp-topbar"><div class="cat">' +
      escHtml(m.category || "") +
      '</div><div style="display:flex;align-items:center;gap:14px;"><span class="live-badge"><span class="dot"></span>Live</span><div class="court">' +
      escHtml(m.court || "") +
      "</div></div></div>";

    // Header row: nama sisi Aka (merah) & Shiro (putih) + asal daerah
    html +=
      '<div class="disp-heads">' +
      '<div class="disp-head aka">' + orgBadgeHtml(m.aka, "md") +
      '<div class="dh-name">' + akaName + '</div>' +
      '<div class="dh-sub">' + escHtml(orgText(m.aka) || "Kontestan Aka") + '</div><div class="dh-rule"></div></div>' +
      '<div class="disp-head shiro">' + orgBadgeHtml(m.ao, "md") +
      '<div class="dh-name">' + shiroName + '</div>' +
      '<div class="dh-sub">' + escHtml(orgText(m.ao) || "Kontestan Shiro") + '</div><div class="dh-rule"></div></div>' +
      "</div>";

    if (m.type === "kumite_team") {
      html += '<div class="disp-team-tally">';
      html +=
        '<span class="aka-t">' + escHtml(m.teamAka.name || "Merah") + "</span> &nbsp;" + (m.teamAka.wins || 0) + " — " + (m.teamAo.wins || 0) + "&nbsp; <span class=\"ao-t\">" +
        escHtml(m.teamAo.name || "Putih") + "</span>";
      html += "</div>";
    }

    // Mode penilaian kata BENDERA: layar hanya menampilkan SATU bendera hasil
    // mayoritas juri (merah = Aka menang, putih = Shiro menang).
    if (isKata && m.kataMode === "flags") {
      html += kataFlagStageHtml(m);
    } else {
      html += '<div class="disp-split">';
      html += dispSide(m, "aka", isKata);
      html += dispSide(m, "ao", isKata);
      html += "</div>";
    }

    // Bottom bar: timer di tengah saja (label Tatami & Kode dihapus dari layar live)
    html += '<div class="disp-bottombar">';
    if (!isKata) {
      html += '<div class="disp-timer-wrap"><div class="disp-timer ' + (low ? "low" : "") + '">' + fmtTime(rem) + "</div></div>";
    } else {
      html += '<div class="disp-timer-wrap"><div class="disp-timer" style="font-size:clamp(18px,2.6vw,28px);">Penilaian Kata</div></div>';
    }
    html += "</div>";

    html += '<button class="fs-btn fs-back" id="fs-back">Kembali</button>';
    html += '<button class="fs-btn" id="fs-toggle">Layar Penuh</button>';
    html += "</div>";
    return html;
  }

  /* Layar TV untuk kata mode bendera: hanya satu bendera (merah/putih) yang
     ditampilkan, sesuai mayoritas suara juri. */
  function kataFlagStageHtml(m) {
    var dec = kataFlagDecision(m);
    var aka = escHtml((m.aka && m.aka.name) || "AKA");
    var ao = escHtml((m.ao && m.ao.name) || "SHIRO");
    var kataName = (m.aka && m.aka.kataName) || (m.ao && m.ao.kataName) || "";
    var html = '<div class="disp-flag-stage">';
    html +=
      '<div class="df-heads">' +
      '<div class="dfh aka">' + aka + "</div>" +
      '<div class="dfh-vs">VS</div>' +
      '<div class="dfh ao">' + ao + "</div>" +
      "</div>";
    html += '<div class="df-stage">';
    if (dec) {
      html +=
        '<div class="disp-flag-wrap"><div class="disp-flag ' + dec + '"></div></div>' +
        '<div class="df-result ' + dec + '">' + (dec === "aka" ? aka : ao) + " MENANG</div>";
    } else {
      html += '<div class="df-wait">Menunggu keputusan juri…</div>';
    }
    html += "</div>";
    if (kataName) html += '<div class="df-kata">Kata: ' + escHtml(kataName) + "</div>";
    html += "</div>";
    return html;
  }

  function renderBannerScreen(m) {
    var banner = TCDB.loadBanner();
    var html = '<div class="disp-wrap disp-banner-wrap">';
    if (banner) {
      html += '<img class="disp-banner-img" src="' + banner + '" alt="Banner turnamen">';
    } else {
      var wname = winnerName(m);
      html +=
        '<div class="disp-banner-fallback">' +
        '<div class="disp-banner-title">Pertandingan Selesai</div>' +
        (wname ? '<div class="disp-banner-winner">Pemenang: ' + escHtml(wname) + "</div>" : "") +
        '<div class="disp-banner-hint">Unggah banner turnamen di halaman utama agar tampil di layar ini.</div>' +
        "</div>";
    }
    html += '<button class="fs-btn fs-back" id="fs-back">Kembali</button>';
    html += '<button class="fs-btn" id="fs-toggle">Layar Penuh</button>';
    html += "</div>";
    return html;
  }

  function dispSide(m, side, isKata) {
    var s = m[side];
    var isWinner = m.winner === side;
    var sideClass = side === "ao" ? "shiro" : side; // tampilan: Aka (merah) vs Shiro (putih)
    var cls = "disp-side " + sideClass + (isWinner ? " winner" : "");
    var body = '<div class="disp-senshu-bar ' + (!isKata && s.senshu ? "on" : "") + '"></div>';
    if (isWinner) body += '<div class="d-winner-tag">MENANG</div>';
    body += '<div class="d-name">' + escHtml(s.name || (side === "aka" ? "AKA" : "SHIRO")) + "</div>";
    if (!isKata) {
      body += '<div class="d-score">' + s.score + "</div>";
      var pens = ["C1", "C2", "C3", "HC", "H"]
        .filter(function (k) { return s.penalties[k] > 0; })
        .map(function (k) { return '<div class="disp-pen">' + PEN_LABELS[k] + ' <span class="dp-count">×' + s.penalties[k] + "</span></div>"; })
        .join("");
      if (pens) body += '<div class="disp-penalties">' + pens + "</div>";
    } else {
      var total = computeKataTotal(s.scores);
      body += '<div class="d-score" style="font-size:clamp(60px,12vw,150px);">' + (total === null ? "—" : total.toFixed(1)) + "</div>";
      var kj = s.scores
        .map(function (v) { return '<div class="disp-kj">' + (v === null ? "–" : Number(v).toFixed(1)) + "</div>"; })
        .join("");
      body += '<div class="disp-kata-scores">' + kj + "</div>";
      if (s.kataName) body += '<div class="disp-kata-total">' + escHtml(s.kataName) + "</div>";
    }
    return '<div class="' + cls + '">' + body + "</div>";
  }

  /* ================= MUTATIONS (control only) ================= */
  function mutate(fn) {
    if (!S.match) return;
    fn(S.match);
    TCDB.saveMatch(S.match).then(function (ok) {
      if (!ok) toast("Gagal menyimpan perubahan — cek koneksi internet.", true);
    });
    render();
  }

  function addScore(side, pts) {
    mutate(function (m) { m[side].score = Math.max(0, m[side].score + pts); });
  }
  function changePenalty(side, key, delta) {
    mutate(function (m) { m[side].penalties[key] = Math.max(0, (m[side].penalties[key] || 0) + delta); });
  }
  function toggleSenshu(side) {
    mutate(function (m) {
      var other = side === "aka" ? "ao" : "aka";
      var newVal = !m[side].senshu;
      m[side].senshu = newVal;
      if (newVal) m[other].senshu = false;
    });
  }
  function setWinner(w) {
    mutate(function (m) {
      m.winner = w;
      m.timer.running = false;
      m.timer.remaining = getRemaining(m);
      if (m.type === "kumite_team" && w !== "draw") {
        var teamKey = w === "aka" ? "teamAka" : "teamAo";
        m[teamKey].wins = (m[teamKey].wins || 0) + 1;
        m.teamLog.push({ index: m.matchIndex, winner: w, akaScore: m.aka.score, aoScore: m.ao.score });
      }
    });
    syncBracketWinner();
  }
  function clearWinner() {
    mutate(function (m) { m.winner = null; });
    var m = S.match;
    if (m && m.bracket && m.bracket.tournamentId) {
      var t = TCDB.loadTournament(m.bracket.tournamentId);
      if (t && t.winners[m.bracket.key]) {
        delete t.winners[m.bracket.key];
        TCDB.saveTournament(t);
      }
    }
  }
  function syncBracketWinner() {
    var m = S.match;
    if (!m || !m.bracket || !m.winner || !m.bracket.tournamentId) return;
    var t = TCDB.loadTournament(m.bracket.tournamentId);
    if (!t) return;
    var name = m.winner === "draw" ? "" : (m.winner === "aka" ? m.aka.name : m.ao.name);
    if (name) {
      t.winners[m.bracket.key] = name;
      TCDB.saveTournament(t);
    }
  }
  function nextBout() {
    mutate(function (m) {
      m.matchIndex = (m.matchIndex || 0) + 1;
      var idx = m.matchIndex;
      m.aka = blankSide(m.teamAka.members[idx] || "Atlet " + (idx + 1), m.teamAka.province, m.teamAka.city);
      m.ao = blankSide(m.teamAo.members[idx] || "Atlet " + (idx + 1), m.teamAo.province, m.teamAo.city);
      m.winner = null;
      m.timer.remaining = m.duration;
      m.timer.running = false;
      m.timer.endAt = null;
    });
  }
  function resetMatchScores() {
    mutate(function (m) {
      if (m.type === "kumite_ind" || m.type === "kumite_team") {
        m.aka.score = 0; m.aka.penalties = defaultPenalties(); m.aka.senshu = false;
        m.ao.score = 0; m.ao.penalties = defaultPenalties(); m.ao.senshu = false;
      } else {
        m.aka.scores = new Array(m.judgesCount).fill(null);
        m.ao.scores = new Array(m.judgesCount).fill(null);
        if (m.kataMode === "flags") m.flagVotes = new Array(m.judgesCount).fill(null);
      }
      m.winner = null;
      m.timer.remaining = m.duration;
      m.timer.running = false;
      m.timer.endAt = null;
    });
    buzzedForZero = false;
  }
  function timerStart() {
    mutate(function (m) {
      var rem = getRemaining(m);
      if (rem <= 0) rem = m.duration;
      m.timer.endAt = Date.now() + rem * 1000;
      m.timer.running = true;
    });
    buzzedForZero = false;
  }
  function timerPause() {
    mutate(function (m) {
      m.timer.remaining = getRemaining(m);
      m.timer.running = false;
      m.timer.endAt = null;
    });
  }
  function timerReset() {
    mutate(function (m) {
      m.timer.remaining = m.duration;
      m.timer.running = false;
      m.timer.endAt = null;
    });
    buzzedForZero = false;
  }
  function setKataScore(side, idx, val) {
    mutate(function (m) { m[side].scores[idx] = val === "" ? null : Math.max(0, Math.min(10, Number(val))); });
  }
  function setKataFlag(idx, side) {
    mutate(function (m) {
      if (!m.flagVotes) m.flagVotes = new Array(m.judgesCount || 5).fill(null);
      // Klik lagi bendera yang sama → batal (kembali netral).
      m.flagVotes[idx] = m.flagVotes[idx] === side ? null : side;
    });
  }
  function setKataName(side, val) {
    mutate(function (m) { m[side].kataName = val; });
  }

  /* ================= HANTEI (keputusan juri saat skor sama) ================= */
  function hanteiModalHtml() {
    var m = S.match;
    var akaName = escHtml(m.aka.name || "Aka"),
      aoName = escHtml(m.ao.name || "Shiro");
    var voters = ["Wasit (Shushin)", "Juri 1", "Juri 2", "Juri 3", "Juri 4"];
    var rows = voters
      .map(function (label, i) {
        return (
          '<div class="hantei-row" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">' +
          '<span style="font-size:13px;color:var(--text-dim);">' + label + "</span>" +
          '<select id="hv-' + i + '" style="padding:6px 10px;border-radius:8px;">' +
          '<option value="aka">' + akaName + " (Aka)</option>" +
          '<option value="ao">' + aoName + " (Shiro)</option>" +
          "</select></div>"
        );
      })
      .join("");
    return (
      "<h3>Hantei — Keputusan Juri</h3>" +
      '<p style="font-size:13px;color:var(--text-dim);line-height:1.5;">Skor sama saat waktu habis. Masukkan suara 4 Juri (Fukushin) + 1 Wasit (Shushin). Suara terbanyak menang.</p>' +
      '<div style="margin:14px 0;">' + rows + "</div>" +
      '<div style="display:flex;gap:10px;"><button class="ghost-btn" id="modal-cancel">Batal</button><button class="primary-btn" id="modal-confirm-hantei">Tentukan Pemenang</button></div>'
    );
  }
  function runHanteiDecision(bg) {
    var votes = { aka: 0, ao: 0 };
    for (var i = 0; i < 5; i++) {
      var sel = bg.querySelector("#hv-" + i);
      if (sel) votes[sel.value] = (votes[sel.value] || 0) + 1;
    }
    if (votes.aka === votes.ao) {
      // Masih seri mutlak → Encho-sen (perpanjangan waktu 1 menit, sudden death)
      mutate(function (m) {
        m.duration = 60;
        m.timer.remaining = 60;
        m.timer.running = false;
        m.timer.endAt = null;
      });
      buzzedForZero = false;
      toast("Hantei seri — Encho-sen (perpanjangan 1 menit, sudden death) dimulai.");
    } else {
      setWinner(votes.aka > votes.ao ? "aka" : "ao");
      toast("Pemenang ditentukan lewat Hantei.");
    }
  }

  /* ================= MODAL ================= */
  function showModal(innerHtml) {
    var bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = '<div class="modal-box">' + innerHtml + "</div>";
    document.body.appendChild(bg);
    var close = bg.querySelector("#modal-close");
    if (close) close.onclick = function () { bg.remove(); };
    var cancel = bg.querySelector("#modal-cancel");
    if (cancel) cancel.onclick = function () { bg.remove(); };
    var confirmReset = bg.querySelector("#modal-confirm-reset");
    if (confirmReset) confirmReset.onclick = function () { resetMatchScores(); bg.remove(); };
    var confirmHantei = bg.querySelector("#modal-confirm-hantei");
    if (confirmHantei) confirmHantei.onclick = function () { runHanteiDecision(bg); bg.remove(); };
    bg.onclick = function (e) { if (e.target === bg) bg.remove(); };
  }

  /* ================= AUTH HANDLERS ================= */
  function handleLogin() {
    S.authErr = "";
    var role = S.loginRole || "pengguna";
    var username = document.getElementById("lg-user").value.trim();
    var password = document.getElementById("lg-pass").value;
    if (!username || !password) { S.authErr = "Isi username & password."; render(); return; }
    var btn = document.getElementById("lg-submit");
    if (btn) { btn.disabled = true; btn.textContent = "Memeriksa…"; }
    TCAuth.login(username, password)
      .then(function (res) {
        if (!res.ok) {
          S.authErr = res.error || "Username atau password salah.";
          render();
          return;
        }
        var u = res.user;
        if (role === "admin" && u.role !== "admin") {
          S.authErr = "Akun \"" + username + "\" bukan admin. Gunakan tombol \"Pengguna\".";
          render();
          return;
        }
        S.user = u;
        TCDB.bindAccount(u.username);
        enterDashboard();
      })
      .catch(function () {
        S.authErr = "Gagal menghubungi server. Periksa koneksi internet.";
        render();
      });
  }

  function enterDashboard() {
    stopSubscription();
    S.match = null;
    S.matchCode = "";
    var isAdminRole = !!(S.user && S.user.role === "admin" && S.loginRole === "admin");
    S.view = isAdminRole ? "admin" : "kejuaraan";
    if (S.view === "admin") {
      S.users = null;
      refreshUsers();
    }
    render();
  }

  function handleLogout() {
    TCAuth.logout();
    TCDB.bindAccount("");
    stopSubscription();
    TCDB.clearLastSession();
    S.user = null;
    S.match = null;
    S.matchCode = "";
    S.users = null;
    S.view = "landing";
    S.authErr = "";
    S.adminErr = "";
    S.adminOk = "";
    S.loginRole = "pengguna";
    render();
  }

  function handleCreateUser() {
    S.adminErr = ""; S.adminOk = "";
    var uname = document.getElementById("nu-user").value.trim();
    var pass = document.getElementById("nu-pass").value;
    var btn = document.getElementById("nu-create");
    if (btn) { btn.disabled = true; btn.textContent = "Menyimpan…"; }
    TCAuth.createUser(uname, pass)
      .then(function (r) {
        if (!r.ok) S.adminErr = r.error;
        else S.adminOk = "Akun \"" + uname + "\" berhasil dibuat.";
        refreshUsers();
        render();
      })
      .catch(function () {
        S.adminErr = "Gagal menghubungi server. Periksa koneksi internet.";
        render();
      });
  }

  function handleDeleteUser(username) {
    if (!confirm("Hapus akun \"" + username + "\"? Aksi tidak bisa dibatalkan.")) return;
    S.adminErr = ""; S.adminOk = "";
    TCAuth.deleteUser(username)
      .then(function (r) {
        if (!r.ok) S.adminErr = r.error; else S.adminOk = "Akun \"" + username + "\" dihapus.";
        refreshUsers();
        render();
      })
      .catch(function () {
        S.adminErr = "Gagal menghubungi server. Periksa koneksi internet.";
        render();
      });
  }

  function handleResetPassword(username) {
    var np = prompt("Password baru untuk \"" + username + "\" (min. 4 karakter):");
    if (np === null || np === "") return;
    S.adminErr = ""; S.adminOk = "";
    TCAuth.resetPassword(username, np)
      .then(function (r) {
        if (!r.ok) S.adminErr = r.error; else S.adminOk = "Password \"" + username + "\" direset.";
        refreshUsers();
        render();
      })
      .catch(function () {
        S.adminErr = "Gagal menghubungi server. Periksa koneksi internet.";
        render();
      });
  }

  /* ================= BANNER HANDLERS ================= */
  function handleBannerFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast("File harus berupa gambar.", true); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var maxW = 1920, maxH = 1080;
        var scale = Math.min(1, maxW / img.width, maxH / img.height);
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        var dataUrl = cv.toDataURL("image/jpeg", 0.82);
        if (TCDB.saveBanner(dataUrl)) {
          toast("Banner turnamen disimpan.");
          render();
        } else {
          toast("Gagal menyimpan banner (ukuran terlalu besar).", true);
        }
      };
      img.onerror = function () { toast("Gagal memuat gambar.", true); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function handleClearBanner() {
    TCDB.clearBanner();
    toast("Banner dihapus.");
    render();
  }

  /* ================= HANDLERS ================= */
  async function handleCreateMatch() {
    S.formErr = "";
    var isTeam = S.matchType === "kumite_team" || S.matchType === "kata_team";
    var isKata = S.matchType === "kata_ind" || S.matchType === "kata_team";
    var code = (document.getElementById("f-code").value || genCodeCached()).trim().toUpperCase();
    var court = document.getElementById("f-court").value.trim();
    var category = document.getElementById("f-category").value.trim();
    var akaName = document.getElementById("f-aka-name").value.trim();
    var aoName = document.getElementById("f-ao-name").value.trim();

    if (!akaName || !aoName) {
      S.formErr = "Isi nama kedua sisi (Aka & Shiro) terlebih dulu.";
      render();
      return;
    }
    if (!/^[A-Z0-9]{3,8}$/.test(code)) {
      S.formErr = "Kode harus 3–8 huruf/angka (A-Z, 0-9).";
      render();
      return;
    }

    var cfg = { type: S.matchType, code: code, court: court, category: category, akaName: akaName, aoName: aoName };
    var tatamiEl = document.getElementById("f-tatami");
    cfg.tatami = tatamiEl && tatamiEl.value ? Number(tatamiEl.value) : null;
    var akaProvEl = document.getElementById("f-aka-province");
    var akaCityEl = document.getElementById("f-aka-city");
    var aoProvEl = document.getElementById("f-ao-province");
    var aoCityEl = document.getElementById("f-ao-city");
    cfg.akaProvince = akaProvEl ? akaProvEl.value.trim() : "";
    cfg.akaCity = akaCityEl ? akaCityEl.value.trim() : "";
    cfg.aoProvince = aoProvEl ? aoProvEl.value.trim() : "";
    cfg.aoCity = aoCityEl ? aoCityEl.value.trim() : "";
    if (isKata) {
      cfg.judgesCount = Number(document.getElementById("f-judges").value);
      var kmSetup = document.getElementById("f-kata-mode");
      cfg.kataMode = (kmSetup && kmSetup.value) || "scores";
    } else {
      var mins = Number(document.getElementById("f-min").value || 0);
      var secs = Number(document.getElementById("f-sec").value || 0);
      cfg.duration = mins * 60 + secs;
    }
    if (isTeam) {
      cfg.akaMembers = Array.from(document.querySelectorAll(".ak-member")).map(function (i) { return i.value.trim(); });
      cfg.aoMembers = Array.from(document.querySelectorAll(".ao-member")).map(function (i) { return i.value.trim(); });
    }

    // Buka jendela layar skor sekarang (masih dalam gesture klik supaya
    // tidak diblokir pop-up); isinya diarahkan setelah match tersimpan.
    var dispWin = openWindow("tatami-display", code);

    var existing = await TCDB.loadMatch(code);
    if (existing) {
      if (dispWin && !dispWin.closed) dispWin.close();
      forgetWin("tatami-display", code);
      S.formErr = 'Kode "' + code + '" sudah dipakai. Gunakan kode lain.';
      render();
      return;
    }

    var m = newMatch(cfg);
    var ok = await TCDB.saveMatch(m);
    if (!ok) {
      if (dispWin && !dispWin.closed) dispWin.close();
      forgetWin("tatami-display", code);
      S.formErr = "Gagal membuat pertandingan. Coba muat ulang halaman & pastikan penyimpanan browser aktif.";
      render();
      return;
    }
    _cachedCode = null;
    TCDB.saveActiveMatch(code);
    enterMatch(m, "control");
    openDisplayWindow(code, { lock: true });
  }

  async function handleJoin(role) {
    S.formErr = "";
    var code = document.getElementById("f-join-code").value.trim().toUpperCase();
    if (!code) { S.formErr = "Masukkan kode pertandingan."; render(); return; }
    var m = await TCDB.loadMatch(code);
    if (!m) { S.formErr = 'Kode "' + code + '" tidak ditemukan.'; render(); return; }
    enterMatch(m, role, code);
  }

  function enterMatch(m, role, code, lock) {
    stopSubscription();
    S.match = m;
    S.matchCode = code || m.code;
    S.view = role;
    S.lockedDisplay = !!(lock && role === "display");
    TCDB.saveLastSession({ code: S.matchCode, role: role, lock: S.lockedDisplay });
    // Judul tab/jendela supaya mudah dikenali saat banyak jendela terbuka
    // (multi-tatami) — tidak mengubah tampilan layar TV itu sendiri.
    try {
      document.title =
        role === "display"
          ? "Layar Skor" + (S.lockedDisplay && m.tatami ? " Tatami " + m.tatami : " " + S.matchCode)
          : "Kontrol " + S.matchCode;
    } catch (e) {}
    S.unsub = TCDB.subscribeMatch(S.matchCode, function (fresh) {
      if (!fresh) return;
      S.match = fresh;
      render();
    });
    // Layar skor yang TIDAK terkunci ikut "mendengarkan" pertandingan aktif —
    // begitu wasit/juri/admin membuka pertandingan lain, layar ini otomatis
    // pindah tanpa perlu kode dimasukkan ulang. Layar yang TERKUNCI (dipakai
    // sebagai layar TV per-tatami) tetap diam di laganya sendiri.
    if (role === "display" && !S.lockedDisplay) {
      S.activeUnsub = TCDB.subscribeActiveMatch(function (newCode) {
        if (newCode && newCode !== S.matchCode) followActiveMatch(newCode);
      });
    }
    render();
  }

  /* Dipanggil saat kode pertandingan aktif berubah (broadcast dari tab lain)
     supaya layar skor pindah mengikuti tanpa memasukkan kode manual. */
  function followActiveMatch(newCode) {
    if (S.unsub) { S.unsub(); S.unsub = null; }
    S.matchCode = newCode;
    TCDB.saveLastSession({ code: newCode, role: "display", lock: false });
    try { document.title = "Layar Skor " + newCode; } catch (e) {}
    TCDB.loadMatch(newCode).then(function (m) {
      if (!m) return;
      S.match = m;
      render();
    });
    S.unsub = TCDB.subscribeMatch(newCode, function (fresh) {
      if (!fresh) return;
      S.match = fresh;
      render();
    });
  }

  function goHome() {
    stopSubscription();
    TCDB.clearLastSession();
    S.view = "kejuaraan";
    S.currentTournamentId = null;
    S.currentEventId = null;
    S.match = null;
    S.matchCode = "";
    render();
  }

  function stopSubscription() {
    if (S.unsub) { S.unsub(); S.unsub = null; }
    if (S.activeUnsub) { S.activeUnsub(); S.activeUnsub = null; }
  }

  /* ================= EVENT BINDING ================= */
  function bindEvents() {
    var app = document.getElementById("app");

    // ---- LOGIN ----
    var lgBtn = document.getElementById("lg-submit");
    if (lgBtn) lgBtn.onclick = handleLogin;

    // ---- LANDING / PAYMENT ----
    var payNow = document.getElementById("pay-now");
    if (payNow) payNow.onclick = startPayment;
    var waSend = document.getElementById("wa-send");
    if (waSend) waSend.onclick = sendWhatsApp;
    var payCheck = document.getElementById("pay-check");
    if (payCheck) payCheck.onclick = checkPayment;
    var regSubmit = document.getElementById("reg-submit");
    if (regSubmit) regSubmit.onclick = handleRegister;
    var regUser = document.getElementById("reg-user");
    var regPass = document.getElementById("reg-pass");
    if (regPass) regPass.onkeydown = function (e) { if (e.key === "Enter") handleRegister(); };
    if (regUser) regUser.onkeydown = function (e) { if (e.key === "Enter") handleRegister(); };
    var landingLogin = document.getElementById("landing-login");
    if (landingLogin) {
      landingLogin.onclick = function () {
        S.view = "login";
        S.authErr = "";
        render();
      };
    }
    app.querySelectorAll("[data-login-role]").forEach(function (b) {
      b.onclick = function () {
        S.loginRole = b.dataset.loginRole;
        S.authErr = "";
        render();
      };
    });
    var lgUser = document.getElementById("lg-user");
    var lgPass = document.getElementById("lg-pass");
    if (lgPass) lgPass.onkeydown = function (e) { if (e.key === "Enter") handleLogin(); };
    if (lgUser) lgUser.onkeydown = function (e) { if (e.key === "Enter") handleLogin(); };

    // ---- ADMIN ----
    var btnToApp = document.getElementById("btn-to-app");
    if (btnToApp) btnToApp.onclick = function () { S.view = "setup"; S.adminErr = ""; S.adminOk = ""; render(); };    var nuCreate = document.getElementById("nu-create");
    if (nuCreate) nuCreate.onclick = handleCreateUser;
    app.querySelectorAll("[data-del-user]").forEach(function (b) {
      b.onclick = function () { handleDeleteUser(b.dataset.delUser); };
    });
    app.querySelectorAll("[data-reset-pass]").forEach(function (b) {
      b.onclick = function () { handleResetPassword(b.dataset.resetPass); };
    });

    // ---- SHARED HEADER (setup/admin) ----
    var btnAdmin = document.getElementById("btn-admin");
    if (btnAdmin) btnAdmin.onclick = function () { S.view = "admin"; S.users = null; S.adminErr = ""; S.adminOk = ""; refreshUsers(); render(); };
    var btnLogout = document.getElementById("btn-logout");
    if (btnLogout) btnLogout.onclick = handleLogout;

    // ---- SETUP ----
    app.querySelectorAll(".tab-btn").forEach(function (b) {
      b.onclick = function () { S.setupTab = b.dataset.tab; S.formErr = ""; render(); };
    });
    app.querySelectorAll(".type-opt").forEach(function (b) {
      b.onclick = function () { S.matchType = b.dataset.type; render(); };
    });
    app.querySelectorAll("[data-duration-preset]").forEach(function (b) {
      b.onclick = function () {
        var total = Number(b.dataset.durationPreset);
        var fmin = document.getElementById("f-min"), fsec = document.getElementById("f-sec");
        if (fmin) fmin.value = Math.floor(total / 60);
        if (fsec) fsec.value = total % 60;
      };
    });
    var addMemberBtn = document.getElementById("add-member");
    if (addMemberBtn) addMemberBtn.onclick = function () { S.teamSize = (S.teamSize || 3) + 1; render(); };

    var createBtn = document.getElementById("create-match");
    if (createBtn) createBtn.onclick = function () { handleCreateMatch(); };

    var fAkaProv = document.getElementById("f-aka-province");
    if (fAkaProv) fAkaProv.onchange = function () {
      var cityEl = document.getElementById("f-aka-city");
      if (cityEl) cityEl.innerHTML = cityOptionsHtml(fAkaProv.value, "");
    };
    var fAoProv = document.getElementById("f-ao-province");
    if (fAoProv) fAoProv.onchange = function () {
      var cityEl = document.getElementById("f-ao-city");
      if (cityEl) cityEl.innerHTML = cityOptionsHtml(fAoProv.value, "");
    };

    var joinControlBtn = document.getElementById("join-control");
    if (joinControlBtn) joinControlBtn.onclick = function () { handleJoin("control"); };
    var joinDisplayBtn = document.getElementById("join-display");
    if (joinDisplayBtn) joinDisplayBtn.onclick = function () { handleJoin("display"); };

    // ---- BANNER ----
    var bannerFile = document.getElementById("banner-file");
    if (bannerFile) bannerFile.onchange = function () { if (bannerFile.files && bannerFile.files[0]) handleBannerFile(bannerFile.files[0]); };
    var bannerClear = document.getElementById("banner-clear");
    if (bannerClear) bannerClear.onclick = handleClearBanner;

    // ---- BAGAN ----
    var goSetupBtn = document.getElementById("btn-go-setup");
    if (goSetupBtn) goSetupBtn.onclick = function () { S.view = "setup"; render(); };
    var goBaganBtn = document.getElementById("btn-go-bagan");
    if (goBaganBtn) goBaganBtn.onclick = goHome;
    var goBaganListBtn = document.getElementById("btn-go-baganlist");
    if (goBaganListBtn) goBaganListBtn.onclick = function () {
      S.view = "baganList";
      S.currentTournamentId = null;
      S.editPlayers = false;
      render();
    };

    // ---- KEJUARAAN / EVENT ----
    var evCreate = document.getElementById("ev-create");
    if (evCreate) evCreate.onclick = handleCreateEvent;
    var evName = document.getElementById("ev-name");
    var evDate = document.getElementById("ev-date");
    if (evName && evName.onkeydown) evName.onkeydown = function (e) { if (e.key === "Enter") handleCreateEvent(); };
    if (evDate && evDate.onkeydown) evDate.onkeydown = function (e) { if (e.key === "Enter") handleCreateEvent(); };
    app.querySelectorAll("[data-delete-event]").forEach(function (b) {
      b.onclick = function () { handleDeleteEvent(b.dataset.deleteEvent); };
    });
    var evNewBagan = document.getElementById("ev-new-bagan");
    if (evNewBagan) evNewBagan.onclick = function () { S.baganNew = true; S.formErr = ""; render(); };
    var goKejuaraanBtn = document.getElementById("btn-go-kejuaraan");
    if (goKejuaraanBtn) goKejuaraanBtn.onclick = function () {
      S.view = "kejuaraan";
      S.currentEventId = null;
      S.baganNew = false;
      S.formErr = "";
      render();
    };

    // ---- DAFTAR SEMUA BAGAN ----
    var tNewOpen = document.getElementById("t-new-open");
    if (tNewOpen) tNewOpen.onclick = function () {
      S.formErr = "";
      S.baganMatchType = "kumite_ind";
      S.baganJudges = 5;
      S.baganNew = true;
      render();
    };
    var tNewCancel = document.getElementById("t-new-cancel");
    if (tNewCancel) tNewCancel.onclick = function () { S.formErr = ""; S.baganNew = false; render(); };
    app.querySelectorAll("[data-open-bagan]").forEach(function (b) {
      b.onclick = function () {
        S.currentTournamentId = b.dataset.openBagan;
        S.editPlayers = false;
        S.view = "bagan";
        render();
      };
    });
    var goEventBtn = document.getElementById("btn-go-event");
    if (goEventBtn) goEventBtn.onclick = function () { S.view = "kejuaraanDetail"; render(); };
    app.querySelectorAll("[data-open-event]").forEach(function (b) {
      b.onclick = function () {
        S.currentEventId = b.dataset.openEvent;
        S.view = "kejuaraanDetail";
        render();
      };
    });
    app.querySelectorAll("[data-delete-bagan]").forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        handleDeleteBaganFromList(b.dataset.deleteBagan);
      };
    });
    app.querySelectorAll("[data-bagan-type]").forEach(function (b) {
      b.onclick = function () { S.baganMatchType = b.dataset.baganType; render(); };
    });

    var tCreate = document.getElementById("t-create");
    if (tCreate) tCreate.onclick = handleCreateTournament;
    var tShuffle = document.getElementById("t-shuffle");
    if (tShuffle) tShuffle.onclick = handleShuffle;
    var tEdit = document.getElementById("t-edit");
    if (tEdit) tEdit.onclick = function () {
      var t = TCDB.loadTournament(S.currentTournamentId);
      S.formErr = "";
      S.baganMatchType = (t && t.matchType) || "kumite_ind";
      S.baganJudges = (t && t.judgesCount) || 5;
      S.editPlayers = true;
      render();
    };
    var tPrint = document.getElementById("t-print");
    if (tPrint) tPrint.onclick = function () { window.print(); };
    var tCancelEdit = document.getElementById("t-cancel-edit");
    if (tCancelEdit) tCancelEdit.onclick = function () { S.formErr = ""; S.editPlayers = false; render(); };
    var tSaveEdit = document.getElementById("t-save-edit");
    if (tSaveEdit) tSaveEdit.onclick = handleSaveEdit;
    var tReset = document.getElementById("t-reset");
    if (tReset) tReset.onclick = handleResetBagan;
    var tClear = document.getElementById("t-clear");
    if (tClear) tClear.onclick = handleClearTournament;
    app.querySelectorAll("[data-live]").forEach(function (b) {
      b.onclick = function () { handleLiveScore(b.dataset.live); };
    });

    // ---- FORM PESERTA BAGAN (nama + provinsi + kota) ----
    var tAddPlayer = document.getElementById("t-add-player");
    if (tAddPlayer) tAddPlayer.onclick = function () {
      var box = document.getElementById("t-players");
      if (box) box.insertAdjacentHTML("beforeend", playerRowHtml({ name: "", province: "", city: "" }));
    };
    var playersBox = document.getElementById("t-players");
    if (playersBox) playersBox.onclick = function (e) {
      var rm = e.target.closest(".p-remove");
      if (rm && rm.closest(".p-row")) rm.closest(".p-row").remove();
    };
    if (playersBox) playersBox.onchange = function (e) {
      if (e.target.classList.contains("p-province")) {
        var row = e.target.closest(".p-row");
        var cityEl = row ? row.querySelector(".p-city") : null;
        if (cityEl) cityEl.innerHTML = cityOptionsHtml(e.target.value, "");
      }
    };

    var installNow = document.getElementById("install-now");
    if (installNow) installNow.onclick = function () { TCPWA.promptInstall().then(function () { S.installAvailable = false; render(); }); };
    var installDismiss = document.getElementById("install-dismiss");
    if (installDismiss) installDismiss.onclick = function () { TCPWA.dismiss(); S.installAvailable = false; render(); };

    // ---- CONTROL ----
    var copyCode = document.getElementById("copy-code");
    if (copyCode) copyCode.onclick = function () {
      var code = S.match.code;
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { toast("Kode " + code + " disalin."); });
    };
    var shareBtn = document.getElementById("btn-share-display");
    if (shareBtn) shareBtn.onclick = function () {
      showModal(shareModalHtml());
    };
    var resetBtn = document.getElementById("btn-reset-match");
    if (resetBtn) resetBtn.onclick = function () {
      showModal(
        '<h3>Reset Skor?</h3><p style="font-size:14px;color:var(--text-dim);">Semua poin, pelanggaran, dan pemenang untuk laga saat ini akan dikembalikan ke nol.</p><div style="display:flex;gap:10px;margin-top:16px;"><button class="ghost-btn" id="modal-cancel">Batal</button><button class="primary-btn" id="modal-confirm-reset">Reset</button></div>'
      );
    };
    var backBtn = document.getElementById("btn-back-setup");
    if (backBtn) backBtn.onclick = goHome;
    var ctrlBack = document.getElementById("ctrl-back");
    if (ctrlBack) ctrlBack.onclick = goHome;

    app.querySelectorAll("[data-score]").forEach(function (b) { b.onclick = function () { addScore(b.dataset.side, Number(b.dataset.pts)); }; });
    app.querySelectorAll("[data-pen-inc]").forEach(function (b) { b.onclick = function () { changePenalty(b.dataset.side, b.dataset.pen, 1); }; });
    app.querySelectorAll("[data-pen-dec]").forEach(function (b) { b.onclick = function () { changePenalty(b.dataset.side, b.dataset.pen, -1); }; });
    app.querySelectorAll("[data-senshu]").forEach(function (b) { b.onclick = function () { toggleSenshu(b.dataset.side); }; });
    app.querySelectorAll("[data-hansoku-win]").forEach(function (b) { b.onclick = function () { setWinner(b.dataset.side); }; });
    app.querySelectorAll("[data-kata-score]").forEach(function (inp) { inp.onchange = function () { setKataScore(inp.dataset.side, Number(inp.dataset.idx), inp.value); }; });
    app.querySelectorAll("[data-kata-name]").forEach(function (inp) { inp.onchange = function () { setKataName(inp.dataset.side, inp.value); }; });
    app.querySelectorAll("[data-kata-flag]").forEach(function (b) { b.onclick = function () { setKataFlag(Number(b.dataset.idx), b.dataset.side); }; });

    var t1 = document.getElementById("t-start"); if (t1) t1.onclick = timerStart;
    var t2 = document.getElementById("t-pause"); if (t2) t2.onclick = timerPause;
    var t3 = document.getElementById("t-reset"); if (t3) t3.onclick = timerReset;

    var openHantei = document.getElementById("open-hantei");
    if (openHantei) openHantei.onclick = function () { showModal(hanteiModalHtml()); };
    var wa = document.getElementById("win-aka"); if (wa) wa.onclick = function () { setWinner("aka"); };
    var wo = document.getElementById("win-ao"); if (wo) wo.onclick = function () { setWinner("ao"); };
    var wd = document.getElementById("win-draw"); if (wd) wd.onclick = function () { setWinner("draw"); };
    var cw = document.getElementById("clear-winner"); if (cw) cw.onclick = clearWinner;
    var nb = document.getElementById("next-bout"); if (nb) nb.onclick = nextBout;

    // ---- DISPLAY ----
    var fsBack = document.getElementById("fs-back");
    if (fsBack) fsBack.onclick = goHome;
    var fsBtn = document.getElementById("fs-toggle");
    if (fsBtn) fsBtn.onclick = function () {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {});
      else document.exitFullscreen();
    };
  }

  /* smooth timer tick (hindari full re-render tiap 250ms) */
  setInterval(function () {
    if (S.view === "display" && S.match && S.match.timer && S.match.timer.running) {
      var el = document.querySelector(".disp-timer");
      if (el) {
        var rem = getRemaining(S.match);
        el.textContent = fmtTime(rem);
        el.className = "disp-timer " + (rem <= 10 && rem > 0 ? "low" : "");
      }
    }
    if (S.view === "control" && S.match && S.match.timer && S.match.timer.running) {
      var el2 = document.querySelector(".timer-digit");
      if (el2) {
        var rem2 = getRemaining(S.match);
        el2.textContent = fmtTime(rem2);
        el2.className = "timer-digit running " + (rem2 <= 10 && rem2 > 0 ? "low" : "");
        if (rem2 <= 0 && !buzzedForZero) {
          buzzedForZero = true;
          beep();
          timerPause();
        }
      }
    }
  }, 250);

  /* ================= CONNECTION ================= */
  TCDB.watchConnection(function (isOnline) {
    S.online = isOnline;
    var pills = document.querySelectorAll(".conn-pill");
    if (pills.length) render();
  });

  /* ================= PWA ================= */
  TCPWA.registerServiceWorker();
  TCPWA.onCanInstall(function (available) {
    S.installAvailable = available;
    render();
  });

  /* ================= INIT ================= */
  function showVersionTag() {
    var el = document.getElementById("tc-ver");
    if (!el) {
      el = document.createElement("div");
      el.id = "tc-ver";
      el.className = "tc-ver-chip";
      document.body.appendChild(el);
    }
    el.textContent = "v" + APP_VERSION;
  }

  async function boot() {
    showVersionTag();
    S.user = TCAuth.currentUser();
    TCDB.bindAccount(S.user ? S.user.username : "");
    if (!S.user) {
      S.view = "landing";
      render();
      finishBoot();
      return;
    }

    // Validasi sesi ke server (kalau server tidak terjangkau, sesi cache
    // tetap dipakai untuk mode offline di venue).
    var check = await TCAuth.refresh();
    if (!check.ok && !check.offline) {
      TCAuth.logout();
      TCDB.bindAccount("");
      S.user = null;
      S.view = "landing";
      render();
      finishBoot();
      return;
    }
    S.user = check.user;

    // Jendela layar skor otomatis dibuka dengan ?code=...&role=display&lock=1
    var params = new URLSearchParams(location.search);
    var qCode = (params.get("code") || "").trim().toUpperCase();
    var qRole = params.get("role");
    var qLock = params.get("lock") === "1";
    if (qCode && (qRole === "control" || qRole === "display")) {
      var qm = await TCDB.loadMatch(qCode);
      if (qm) {
        enterMatch(qm, qRole, qCode, qLock);
        finishBoot();
        return;
      }
    }
    var last = TCDB.loadLastSession();
    if (last && last.code && (last.role === "control" || last.role === "display")) {
      var m = await TCDB.loadMatch(last.code);
      if (m) {
        enterMatch(m, last.role, last.code, !!last.lock);
        finishBoot();
        return;
      }
    }
    S.view = S.user && S.user.role === "admin" ? "admin" : "kejuaraan";
    if (S.view === "admin") {
      S.users = null;
      refreshUsers();
    }
    render();
    finishBoot();
  }
  function finishBoot() {
    var splash = document.getElementById("splash");
    if (splash) {
      splash.classList.add("hide");
      setTimeout(function () { splash.remove(); }, 400);
    }
  }
  boot();
})();
