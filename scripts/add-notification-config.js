/**
 * v30.0 — Adds `notifications` block to each tenant's profile.json.
 * Idempotent: skips tenants that already have notifications config.
 */
const fs = require('fs');
const path = require('path');

const TENANTS_DIR = path.resolve(__dirname, '../nova-assistant/tenants');

// Each tenant gets a placeholder owner email — business owner replaces it in the dashboard
const DEFAULT_PREFS = {
  enabled: true,
  recipientEmails: [],  // business owner fills this in via dashboard
  events: {
    booking_confirmed: true,
    order_placed: true,
    lead_captured: true,
    handoff_requested: true,
    nova_failed: true
  },
  quietHours: { enabled: false, start: '22:00', end: '07:00', timezone: 'UTC' },
  dailyDigest: { enabled: false, sendAt: '09:00' }
};

let modified = 0;
for (const tenantId of fs.readdirSync(TENANTS_DIR).sort()) {
  const profilePath = path.join(TENANTS_DIR, tenantId, 'profile.json');
  if (!fs.existsSync(profilePath)) continue;
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  if (profile.notifications && profile.notifications.enabled !== undefined) continue;

  profile.notifications = { ...DEFAULT_PREFS };
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
  modified += 1;
  console.log(`✓ ${tenantId}: notifications block added (recipients=[])`);
}
console.log(`\n${modified} tenant profiles updated.`);
