#!/usr/bin/env bash
# v74.2 Phase 4 smoke test — dev console, widget chat, webhooks, assets, site.
# Requires a live server on :3199 started with NOVA_DEV_TOKEN=devtok321.
set -u
BASE=http://localhost:3199
DEV="x-nova-dev-token: devtok321"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1"; }
check() { if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1 — expected $2, got $3"; fi }
body_has() { if echo "$2" | grep -q "$3"; then ok "$1"; else bad "$1 — body: $(echo "$2" | head -c 200)"; fi }

echo "── Phase 4: dev console router (dev-token gated) ──"
check "GET /api/dev/tenants no token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/dev/tenants)"
N=$(curl -s $BASE/api/dev/tenants); body_has "401 message matches v73.x" "$N" "Developer Console token is required"
for ep in tenants capabilities replays "data/inspect" "leads?tenantId=default" "knowledge/default" "knowledge/default/analytics"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "$DEV" "$BASE/api/dev/$ep")
  check "GET /api/dev/$ep (token)" 200 "$code"
done
# control-plane requires the x-nova-tenant-id scope header when NOVA_DEV_TOKEN
# is set (legacy controlPlaneActor behavior — a missing header 400s).
CPH="x-nova-tenant-id: default"
for ep in control-plane/default control-plane/default/drafts control-plane/default/calendar; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "$DEV" -H "$CPH" "$BASE/api/dev/$ep")
  check "GET /api/dev/$ep (token+scope)" 200 "$code"
done
check "control-plane without scope → 400 (legacy)" 400 "$(curl -s -o /dev/null -w '%{http_code}' -H "$DEV" $BASE/api/dev/control-plane/default)"
check "control-plane wrong scope → 403 (legacy)" 403 "$(curl -s -o /dev/null -w '%{http_code}' -H "$DEV" -H "x-nova-tenant-id: other" $BASE/api/dev/control-plane/default)"
check "unknown /api/dev path, token → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -H "$DEV" $BASE/api/dev/nope)"
C=$(curl -s -X POST $BASE/api/dev/chat -H "$DEV" -H 'content-type: application/json' -d '{"text":"hello","tenantId":"default","customerId":"smoke-v742"}')
body_has "POST /api/dev/chat answers" "$C" '"ok":true'
R=$(curl -s -X POST $BASE/api/dev/reset -H "$DEV" -H 'content-type: application/json' -d '{"tenantId":"default","customerId":"smoke-v742"}')
body_has "POST /api/dev/reset" "$R" "conversationReset"
K=$(curl -s -X POST $BASE/api/dev/knowledge/default/search -H "$DEV" -H 'content-type: application/json' -d '{"query":"hours"}')
body_has "POST /api/dev/knowledge/default/search" "$K" '"ok":true'
P=$(curl -s -H "$DEV" "$BASE/api/dev/operations/default/pricing")
check "GET operations pricing → 410 sunset" 410 "$(curl -s -o /dev/null -w '%{http_code}' -H "$DEV" $BASE/api/dev/operations/default/pricing)"
check "POST /api/dev/datasets/run no token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/dev/datasets/run)"
D=$(curl -s -H "$DEV" "$BASE/api/dev/tenants"); body_has "dev tenants lists default" "$D" '"id":"default"'
CRM=$(curl -s -H "$DEV" "$BASE/api/crm/customer?customerId=c1")
body_has "GET /api/crm/customer (gated)" "$CRM" '"ok":'
check "GET /api/crm/customer no token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/crm/customer)"
check "GET /api/crm/unknownpath no token → 404 (no gate)" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/crm/unknownpath)"

echo "── Phase 4: widget chat router ──"
W=$(curl -s -X POST $BASE/api/chat -H 'content-type: application/json' -d '{"text":"hi","tenantId":"default","customerId":"smoke-v742"}')
body_has "POST /api/chat answers" "$W" '"ok":'
curl -s -i -X POST $BASE/api/chat -H 'content-type: application/json' -H 'Origin: https://shop.example' -d '{"text":"hi","tenantId":"default","customerId":"smoke-v742"}' | grep -qi "access-control-allow-origin: https://shop.example" && ok "chat reflects origin (CORS)" || bad "chat CORS missing"
check "POST /api/chat unknown tenant → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/chat -H 'content-type: application/json' -d '{"text":"hi","tenantId":"nope"}')"
check "POST /api/chat bad customerId → 400" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/chat -H 'content-type: application/json' -d '{"text":"hi","tenantId":"default","customerId":"bad id!!"}')"
POL=$(curl -s "$BASE/api/chat/poll?tenantId=default&customerId=smoke-v742")
body_has "GET /api/chat/poll" "$POL" '"ok":true'
A=$(curl -s -X POST $BASE/api/assistant/chat -H 'content-type: application/json' -d '{"text":"what can you do"}')
body_has "POST /api/assistant/chat (unified)" "$A" '"reply":'
WC=$(curl -s "$BASE/api/widget/config/default")
body_has "GET /api/widget/config/default" "$WC" '"assistantName":'
curl -s -i "$BASE/api/widget/config/default" | grep -qi "cache-control: public, max-age=300" && ok "widget config cache header" || bad "widget config cache header missing"
check "GET /api/widget/config/unknown → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/widget/config/nope)"
check "GET /api/voice/sample/default → 404 (no sample)" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/voice/sample/default)"

echo "── Phase 4: webhooks (raw-body) ──"
check "WH verify wrong token → 403" 403 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/webhooks/whatsapp/default?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=x")"
check "WH POST no signature → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/webhooks/whatsapp/default -H 'content-type: application/json' -d '{}')"
BW=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/billing/webhook -H 'content-type: application/json' -d '{}')
check "billing webhook responds (mock mode acks)" 200 "$BW"

echo "── Phase 4: assets + site router ──"
CP=$(curl -s "$BASE/api/catalog/products?tenantId=default"); body_has "GET /api/catalog/products" "$CP" '"ok":'
check "GET /api/catalog/images/default/P001 → 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/catalog/images/default/P001)"
check "GET /api/qr/default.png" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/qr/default.png)"
check "GET /api/qr/default.svg" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/qr/default.svg)"
QRCT=$(curl -s -o /dev/null -w '%{content_type}' $BASE/api/qr/default.png); [ "$QRCT" = "image/png" ] && ok "QR png content-type" || bad "QR content-type: $QRCT"
check "GET /api/qr/default.txt → 404 (fall-through)" 404 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/qr/default.txt)"
for p in /developer /admin /business /public-admin /assistant /chat /widget.js /widget-test /kiosk/default /kiosk-manifest.json /kiosk-sw.js /manifest.json /sw.js /favicon.ico; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")
  if [ "$code" = "200" ] || [ "$code" = "404" ]; then ok "GET $p ($code)"; else bad "GET $p — $code"; fi
done
check "GET /health" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/health)"
check "GET /metrics" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/metrics)"
check "GET /api/health?deep=1" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health?deep=1")"
H=$(curl -s $BASE/health); body_has "health reports version" "$H" '"version":"74.2.0"'
K404=$(curl -s $BASE/does-not-exist); body_has "unknown path → JSON 404" "$K404" '"error":"Not found"'
check "GET /admin/app.js asset" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/admin/app.js)"
TRAV=$(curl -s -o /dev/null -w '%{http_code}' --path-as-is "$BASE/admin/../../package.json"); check "path traversal blocked" 404 "$TRAV"

echo "── Phase 2+3 regression (already-converted routers) ──"
check "business me no token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/business/me)"
check "admin metrics no token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/admin/metrics)"
check "admin metrics token → 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -H "$DEV" $BASE/api/admin/metrics)"
check "public-admin leads no token → 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/public-admin/leads)"
check "public tenants → 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/public/tenants)"
PC=$(curl -s -X POST $BASE/api/public/chat -H 'content-type: application/json' -d '{"message":"hi"}'); body_has "public chat answers" "$PC" '"ok":'

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
