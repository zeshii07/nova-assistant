BEGIN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_idempotency_idx ON orders(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_tenant_idempotency_idx ON bookings(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
INSERT INTO nova_schema_migrations(version) VALUES('002_v72_consistency') ON CONFLICT DO NOTHING;
COMMIT;
