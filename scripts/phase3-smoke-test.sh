#!/usr/bin/env bash
# v74.1 Phase 3 smoke test — admin/public/public-admin routers + legacy fallback.
# Requires a live server on :3199 started with NOVA_DEV_TOKEN=devtok321.
set -u
BASE=http://localhost:3199
DEV="-H 'x-nova-dev-token: devtok321'"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1"; }
check() { if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1 — expected $2, got $3"; fi }
body_has() { if echo "$2" | grep -q "$3"; then ok "$1"; else bad "$1 — body: $(echo "$2" | head -c 200)"; fi }

echo "── Phase 2 regression: business router still intact ──"
check "GET /api/business/me without token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/business/me)"

echo "── Phase 3: public router (no auth) ──"
P=$(curl -s $BASE/api/public/tenants)
body_has "GET /api/public/tenants lists tenants" "$P" '"ok":true'
body_has "  ... includes default tenant" "$P" '"id":"default"'
check "GET /api/public/starters" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/public/starters)"
check "GET /api/public/feature-registry" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/public/feature-registry)"
S=$(curl -s -H 'Origin: https://example.com' $BASE/api/public/signup/templates)
body_has "GET /api/public/signup/templates (CORS)" "$S" '"ok":true'
A=$(curl -s -i -H 'Origin: https://example.com' $BASE/api/public/signup/templates)
echo "$A" | grep -qi "access-control-allow-origin: https://example.com" && ok "signup templates reflects origin" || bad "signup templates CORS missing"
C=$(curl -s -X POST $BASE/api/public/chat -H 'content-type: application/json' -d '{"message":"hi"}')
body_has "POST /api/public/chat answers" "$C" '"ok":'
check "POST /api/public/chat bad JSON → 400" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/public/chat -H 'content-type: application/json' -d '{nope')"

echo "── Phase 3: public-admin router (dev-token gated) ──"
check "GET /api/public-admin/leads no token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/public-admin/leads)"
B=$(curl -s -o /dev/null -w '%{http_code}' -H 'x-nova-dev-token: devtok321' $BASE/api/public-admin/leads)
check "GET /api/public-admin/leads with token" 200 "$B"
check "GET /api/public-admin/leads/summary with token" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H 'x-nova-dev-token: devtok321' $BASE/api/public-admin/leads/summary)"
check "GET /api/public-admin/unanswered with token" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H 'x-nova-dev-token: devtok321' $BASE/api/public-admin/unanswered)"
check "GET /api/public-admin/demo-requests with token" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H 'x-nova-dev-token: devtok321' $BASE/api/public-admin/demo-requests)"
check "wrong dev token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'x-nova-dev-token: WRONG' $BASE/api/public-admin/leads)"

echo "── Phase 3: admin router (dev-token gated) ──"
for ep in metrics overview tenants templates replays ml/status datasets "notifications/email/test" "owners/default" "voice-profile/default" "leads/default" "feedback/default" "tenants/default/qr-code" "calendar/status/default" "catalog/default/products"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'x-nova-dev-token: devtok321' "$BASE/api/admin/$ep")
  check "GET /api/admin/$ep (with token)" 200 "$code"
done
check "GET /api/admin/metrics no token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/admin/metrics)"
N401=$(curl -s $BASE/api/admin/metrics)
body_has "401 body has legacy message" "$N401" "Admin token is required"
check "unknown admin path, no token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/admin/nope)"
check "unknown admin path, token → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -H 'x-nova-dev-token: devtok321' $BASE/api/admin/nope)"
check "POST /api/admin/datasets/run no token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/admin/datasets/run)"

echo "── Phase 3: OAuth callbacks stay public (browser redirect, no token) ──"
R=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/calendar/callback")
check "GET /api/admin/calendar/callback (no code) → 400" 400 "$R"
R=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/calendar/callback?state=bogus&code=x")
check "GET callback with bad state → 400" 400 "$R"
check "GET microsoft callback (no code) → 400" 400 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/calendar/microsoft/callback")"

echo "── Phase 3: admin write flows (with token) ──"
V=$(curl -s -X POST $BASE/api/admin/voice-profile/default -H 'x-nova-dev-token: devtok321' -H 'content-type: application/json' -d '{"enabled":true,"voiceName":"Nova","rate":1.0}')
body_has "POST voice-profile saves" "$V" "Voice profile saved"
VP=$(curl -s -H 'x-nova-dev-token: devtok321' $BASE/api/admin/voice-profile/default)
body_has "GET voice-profile round-trips" "$VP" '"voiceName":"Nova"'
O=$(curl -s -X POST $BASE/api/admin/owners/default -H 'x-nova-dev-token: devtok321' -H 'content-type: application/json' -d '{"email":"coowner@test.local","password":"secret123","name":"Co"}')
body_has "POST add owner" "$O" '"ok":true'
OL=$(curl -s -H 'x-nova-dev-token: devtok321' $BASE/api/admin/owners/default)
body_has "GET owners lists co-owner" "$OL" "coowner@test.local"
TA=$(curl -s -X POST $BASE/api/admin/tenants/default/export -H 'x-nova-dev-token: devtok321')
body_has "POST tenant export returns manifest" "$TA" '"files":'

echo "── Legacy fallback regression (unconverted routes) ──"
check "GET /health" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/health)"
check "GET /business dashboard" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/business)"
check "GET /admin dashboard" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/admin)"
check "GET /api/chat/poll (legacy)" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/chat/poll?customerId=x")"
check "GET /api/qr/default.png (legacy, QR suite)" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/qr/default.png)"
check "GET /kiosk/default (legacy)" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/kiosk/default)"
D=$(curl -s -H 'x-nova-dev-token: devtok321' "$BASE/api/dev/replays?limit=1")
body_has "GET /api/dev/replays (legacy dev-gated)" "$D" '"ok":true'

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
