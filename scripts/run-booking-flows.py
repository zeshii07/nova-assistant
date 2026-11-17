#!/usr/bin/env python3
"""Drive 10 diverse BYT Cleaners booking flows through /api/chat and report results."""
import json, urllib.request, sys, time

BASE = "http://127.0.0.1:3000"
TENANT = "byt-cleaners-dubai"

def send(conv_id, msg, customer="testcust"):
    body = json.dumps({
        "tenantId": TENANT,
        "customerId": customer,
        "conversationId": conv_id,
        "text": msg,
        "channel": "web"
    }).encode()
    req = urllib.request.Request(f"{BASE}/api/chat", data=body,
        headers={"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read())
            return d
    except Exception as e:
        return {"error": str(e)}

# 10 diverse flows: each is a list of (user_message, expectation_substring)
FLOWS = [
    ("FLOW 1: Deep cleaning apartment 4BR", [
        ("i want a deep cleaning", "deep"),
        ("apartment has 4 bedrooms", None),   # THE reported bug
        ("tomorrow", None),
        ("10 am", None),
        ("Dubai Marina", None),
        ("John Smith", None),
        ("0551234567", None),
        ("confirm", None),
    ]),
    ("FLOW 2: Direct 4 bedroom apartment booking", [
        ("book a 4 bedroom apartment cleaning", None),  # pure property+count
        ("tomorrow", None),
        ("2 pm", None),
        ("Business Bay", None),
        ("Sarah", None),
        ("0559876543", None),
        ("confirm", None),
    ]),
    ("FLOW 3: Villa deep cleaning 5 bedrooms", [
        ("deep clean my 5 bedroom villa", None),
        ("next monday", None),
        ("9 am", None),
        ("Palm Jumeirah", None),
        ("Ahmed", None),
        ("0551112233", None),
        ("confirm", None),
    ]),
    ("FLOW 4: Studio apartment", [
        ("i need cleaning for my studio apartment", None),
        ("tomorrow", None),
        ("11 am", None),
        ("JLT", None),
        ("Priya", None),
        ("0554445566", None),
        ("confirm", None),
    ]),
    ("FLOW 5: Sofa cleaning", [
        ("i want sofa cleaning", None),
        ("5 seater", None),
        ("tomorrow", None),
        ("3 pm", None),
        ("Marina", None),
        ("Mike", None),
        ("0557778899", None),
        ("confirm", None),
    ]),
    ("FLOW 6: Carpet cleaning", [
        ("carpet cleaning for 3 carpets", None),
        ("tomorrow", None),
        ("1 pm", None),
        ("Downtown", None),
        ("Fatima", None),
        ("0552223344", None),
        ("confirm", None),
    ]),
    ("FLOW 7: Move-in cleaning 3BR apartment", [
        ("move in cleaning for 3 bedroom apartment", None),
        ("tomorrow", None),
        ("8 am", None),
        ("Deira", None),
        ("Rashid", None),
        ("0556667788", None),
        ("confirm", None),
    ]),
    ("FLOW 8: Standard hourly cleaning", [
        ("i want standard cleaning", None),
        ("4 hours", None),
        ("2 cleaners", None),
        ("tomorrow", None),
        ("12 pm", None),
        ("Karama", None),
        ("Ali", None),
        ("0553334455", None),
        ("confirm", None),
    ]),
    ("FLOW 9: Bedroom count edit (4 instead of 3)", [
        ("deep cleaning", None),
        ("3 bedroom apartment", None),
        ("actually 4 bedrooms instead of 3", None),  # edit
        ("tomorrow", None),
        ("10 am", None),
        ("Mirdif", None),
        ("Hassan", None),
        ("0558889900", None),
        ("confirm", None),
    ]),
    ("FLOW 10: Roman Urdu greeting + booking", [
        ("salam, cleaning chahiye", None),
        ("deep cleaning chahiye", None),
        ("apartment hai 2 bedroom", None),
        ("kal", None),
        ("subah 10 baje", None),
        ("Bur Dubai", None),
        ("Bilal", None),
        ("0559990011", None),
        ("confirm", None),
    ]),
]

results = []
import time as _time, re as _re
for fi, (name, turns) in enumerate(FLOWS):
    conv_id = f"flow{fi+1}-{int(_time.time())}"
    cust = f"cust{fi+1}"  # unique customer per flow to avoid state contamination
    print(f"\n{'='*70}\n{name}\n{'='*70}", flush=True)
    flow_ok = True
    captured = {"bedrooms": None, "propertyType": None, "price": None, "confirmed": False, "requestId": None}
    for i, (msg, expect) in enumerate(turns):
        d = send(conv_id, msg, customer=cust)
        if "error" in d:
            print(f"  T{i+1} [{msg!r}] -> ERROR: {d['error']}"); flow_ok = False; break
        reply = d.get("reply", "")
        if _re.search(r'(\d+)\s*bedroom', reply.lower()): captured["bedrooms"] = _re.search(r'(\d+)\s*bedroom', reply.lower()).group(1)
        if "apartment" in reply.lower(): captured["propertyType"] = "apartment"
        elif "villa" in reply.lower(): captured["propertyType"] = "villa"
        if "aed" in reply.lower() or "price" in reply.lower() or "rs" in reply.lower(): captured["price"] = True
        if "confirm" in msg.lower() and ("CLN-" in reply or "received" in reply.lower() or "confirmed" in reply.lower()): captured["confirmed"] = True
        m = _re.search(r'(CLN-?[A-Z0-9]+)', reply)
        if m: captured["requestId"] = m.group(1)
        print(f"  T{i+1} [{msg!r}]\n      -> {reply.replace(chr(10),' ')[:115]}", flush=True)
        if expect and expect.lower() not in reply.lower(): print(f"      !! expected {expect!r} not found")
        _time.sleep(2.2)  # stay under 30 req/min rate limit
    print(f"  CAPTURED: {captured}", flush=True)
    results.append((name, flow_ok, captured))
    _time.sleep(5)  # inter-flow pause

print("\n" + "="*70)
print("SUMMARY")
print("="*70)
for name, ok, cap in results:
    status = "OK" if ok else "FAIL"
    print(f"  [{status}] {name}: bedrooms={cap['bedrooms']} propType={cap['propertyType']} price={'Y' if cap['price'] else 'N'} confirmed={'Y' if cap['confirmed'] else 'N'} req={cap['requestId']}")
