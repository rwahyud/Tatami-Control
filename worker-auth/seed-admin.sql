-- Seed admin accounts
-- 1. admin / Ciooren123
-- 2. Ypok1 / Ypok123
-- GANTI password setelah deployment pertama!

INSERT OR IGNORE INTO users (username, password_hash, role, payment_order_id, created_at)
VALUES ('admin', 'pbkdf2$16d3caba0dc059b16d4d8f7605f44d0f$0654f26bec04cc32e0cad8a75730c5e30a7861322a93e4b6ae73cffdc3607bd6', 'admin', NULL, 1755200000000);

INSERT OR IGNORE INTO users (username, password_hash, role, payment_order_id, created_at)
VALUES ('ypok1', 'pbkdf2$7560b064abd41277619b959515a67a9a$7d0ecb215635b449a6d9af3732f4e3b33c2f464db3bd6e2b41d759247ac8eed2', 'admin', NULL, 1755200000001);
