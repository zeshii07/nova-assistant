#!/usr/bin/env bash
# v74.0 Express migration smoke test — hits a live server on :3199 and
# verifies Phase 1 (security middleware) + Phase 2 (business router) +
# legacy fallback behavior.
set -u
BASE=http://localhost:3199
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1"; }
check() { # name, expected, actual
  if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1 — expected $2, got $3"; fi
}

echo "── Phase 1: legacy routes through the Express front ──"
check "GET /health" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/health)"
check "GET /api/health" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/health)"
check "GET /business (dashboard html)" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/business)"
check "GET /admin (dashboard html)" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/admin)"
check "GET /api/chat/poll (legacy GET)" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/chat/poll?customerId=smoke1")"

echo "── Phase 1: security headers ──"
H=$(curl -s -D - -o /dev/null $BASE/health)
echo "$H" | grep -qi "x-powered-by" && bad "X-Powered-By header leaked" || ok "no X-Powered-By header"
echo "$H" | grep -qi "x-request-id" && ok "X-Request-Id present" || bad "X-Request-Id missing"
echo "$H" | grep -qi "x-content-type-options: nosniff" && ok "nosniff present" || bad "nosniff missing"
echo "$H" | grep -qi "x-frame-options" && ok "X-Frame-Options present" || bad "X-Frame-Options missing"
echo "$H" | grep -qi "referrer-policy" && ok "Referrer-Policy present" || bad "Referrer-Policy missing"
W=$(curl -s -D - -o /dev/null $BASE/widget.js)
echo "$W" | grep -qi "access-control-allow-origin: \*" && ok "widget.js ACAO *" || bad "widget.js ACAO missing"
echo "$W" | grep -qi "cross-origin-resource-policy: cross-origin" && ok "widget.js CORP cross-origin" || bad "widget.js CORP wrong/missing"

echo "── Phase 1: CORS preflight everywhere ──"
P=$(curl -s -D - -o /dev/null -X OPTIONS $BASE/api/business/login -H "Origin: https://example.com" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type,authorization")
check "preflight status" 204 "$(echo "$P" | head -1 | grep -o '[0-9][0-9][0-9]')"
echo "$P" | grep -qi "access-control-allow-origin: https://example.com" && ok "origin reflected" || bad "origin not reflected"

echo "── Phase 1: rate limit headers on /api ──"
R=$(curl -s -D - -o /dev/null $BASE/api/health)
echo "$R" | grep -qi "ratelimit" && ok "rate limit headers present" || bad "rate limit headers missing"

echo "── Phase 2: auth enforcement on the business router ──"
check "GET /me without token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/business/me)"
check "GET unknown business path, no token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/business/nope)"
check "GET /me with bogus token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer bogus' $BASE/api/business/me)"
B=$(curl -s -X POST $BASE/api/business/login -H 'content-type: application/json' -d '{}')
echo "$B" | grep -q "tenantId, email, and password are required" && ok "login validation message" || bad "login validation: $B"
J=$(curl -s -X POST $BASE/api/business/login -H 'content-type: application/json' -d '{bad json')
echo "$J" | grep -q "Invalid JSON body." && ok "invalid JSON → 400 w/ legacy message" || bad "invalid JSON mapping: $J"

echo "── Phase 2: end-to-end owner flow (register → login → auth) ──"
REG=$(curl -s -X POST $BASE/api/business/register -H 'content-type: application/json' \
  -d '{"tenantId":"express-test","email":"owner@expresstest.local","password":"secret123","name":"Smoke Owner"}')
echo "$REG" | grep -q '"ok":true' && ok "first-owner register" || bad "register: $REG"
LOGIN=$(curl -s -X POST $BASE/api/business/login -H 'content-type: application/json' \
  -d '{"tenantId":"express-test","email":"owner@expresstest.local","password":"secret123"}')
TOKEN=$(echo "$LOGIN" | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
[ -n "$TOKEN" ] && ok "login returns JWT" || bad "login: $LOGIN"
AUTH="Authorization: Bearer $TOKEN"

ME=$(curl -s -H "$AUTH" $BASE/api/business/me)
echo "$ME" | grep -q '"email":"owner@expresstest.local"' && ok "GET /me with token" || bad "me: $ME"
check "GET /overview (authed, aggregate)" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" $BASE/api/business/overview)"
check "GET /conversations/grouped (authed)" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" $BASE/api/business/conversations/grouped)"
check "GET /leads (authed)" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" $BASE/api/business/leads)"
check "GET /voice/sample (authed)" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" $BASE/api/business/voice/sample)"
check "GET /billing/status (authed)" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" $BASE/api/business/billing/status)"
check "GET /onboarding (authed)" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" $BASE/api/business/onboarding)"
check "unknown business path, valid token → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" $BASE/api/business/nope)"
check "POST /reply no-conversation → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'content-type: application/json' -d '{"customerId":"nobody","text":"hi"}' $BASE/api/business/reply)"
check "GET /api/business/me cross-origin w/ token (CORS+auth)" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -H 'Origin: https://example.com' $BASE/api/business/me)"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
