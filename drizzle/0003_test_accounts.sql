INSERT OR IGNORE INTO accounts (id, contact, phone, email, password_hash, created_at) VALUES
  ('test-account-01', '测试账号 01', '10000000001', 'test01@xingjian.ai', 'pbkdf2$100000$gcD5EEPQb5M28g90T8+xpw==$tOVjzMJHr5I5bqAYa05jQzdpUGPAG/X4LC1OHOZdJac=', '2026-08-31T00:00:00.000Z');

INSERT OR IGNORE INTO accounts (id, contact, phone, email, password_hash, created_at) VALUES
  ('test-account-02', '测试账号 02', '10000000002', 'test02@xingjian.ai', 'pbkdf2$100000$5+uYI2rPTz+vX13iQ+m+8g==$mLz+bWfoJ/DAhkiaVnKG1TE3MiBSTfrZjRsihk836G0=', '2026-08-31T00:00:00.000Z');

INSERT OR IGNORE INTO accounts (id, contact, phone, email, password_hash, created_at) VALUES
  ('test-account-03', '测试账号 03', '10000000003', 'test03@xingjian.ai', 'pbkdf2$100000$DfTZ2Mu75x61HYirESmK5w==$GGCO1jTRqG2BVYFhMPZMmT/n1jy5S74IoOZqqJyeeYk=', '2026-08-31T00:00:00.000Z');

INSERT OR IGNORE INTO accounts (id, contact, phone, email, password_hash, created_at) VALUES
  ('test-account-04', '测试账号 04', '10000000004', 'test04@xingjian.ai', 'pbkdf2$100000$2ti+224owAONvkA1xzWsQA==$/Z+DGFdNoVatlnvESN3t5JCj+sPKnbf2b141o5VLbIM=', '2026-08-31T00:00:00.000Z');

INSERT OR IGNORE INTO accounts (id, contact, phone, email, password_hash, created_at) VALUES
  ('test-account-05', '测试账号 05', '10000000005', 'test05@xingjian.ai', 'pbkdf2$100000$bV7maY+JSQK3CrMCM/kzhA==$SIZT8I45x7/A5PBPRicI7i5BWAHad8MVW2FLTXhMjiU=', '2026-08-31T00:00:00.000Z');

PRAGMA optimize;
