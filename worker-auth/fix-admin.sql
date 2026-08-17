-- WARNING: Password hash ini sudah di-expose di repository.
-- Setelah deployment pertama, SEGERA ganti password admin melalui panel admin.
UPDATE users SET password_hash = 'pbkdf2$100000$28302199a4c09b503c44fef5ede0a6fb$e620f0412a9435478d7cfaf6b7473211250c8b644e99537df69bd8bfa69e3671' WHERE username = 'admin';
