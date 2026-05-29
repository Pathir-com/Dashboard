#!/bin/bash
# Multi-turn SMS conversation: existing account (Berkeley) using fictional patient.
set +e
SUPABASE_TOKEN=$(cat ~/.supabase/access-token)
BERK=b1eb1eb1-bee5-4b00-b2ee-bee5b00b1e00
PATIENT="+447700900201"
WEBHOOK="https://amxcposgqlmgapzoopze.supabase.co/functions/v1/textmagic-webhook"

q() {
  curl -sS -X POST -H "Authorization: Bearer $SUPABASE_TOKEN" -H "Content-Type: application/json" \
    "https://api.supabase.com/v1/projects/amxcposgqlmgapzoopze/database/query" \
    --data-raw "{\"query\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$1")}" 2>&1
}

send() {
  local txt="$1"
  curl -sS -o /dev/null -X POST "$WEBHOOK" -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "sender=$PATIENT" \
    --data-urlencode "receiver=+447418341716" \
    --data-urlencode "text=$txt" \
    --data-urlencode "messageId=tm_$(date +%s)_$RANDOM"
}

# Pull the latest CLINIC reply since a given timestamp, JSON-safe (returns "" if none yet).
last_clinic() {
  local since="$1"
  q "SELECT m.message FROM enquiry_messages m JOIN enquiries e ON e.id=m.enquiry_id JOIN contacts c ON c.id=e.contact_id WHERE c.phone='$PATIENT' AND c.practice_id='$BERK' AND m.role='clinic' AND m.created_at > '$since' ORDER BY m.created_at DESC LIMIT 1" | python3 -c "
import json,sys
try:
  d=json.load(sys.stdin)
  if isinstance(d,list) and d: print(d[0].get('message',''))
  else: print('')
except: print('')
"
}

scripted() {
  local t="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  # Most specific (terminations) first, then info-asks (clinic before consultation),
  # then slot offers, then generic. Pattern order is what tripped the loop before.
  if echo "$t" | grep -qE "booked|confirmed|all set|all booked"; then echo "Thank you, goodbye!|DONE"; return; fi
  if echo "$t" | grep -qE "which clinic|clinic location|location.*prefer"; then echo "Knightsbridge please.|"; return; fi
  if echo "$t" | grep -qE "name|date of birth|dob|details"; then echo "Alex Carter, 5th May 1990.|"; return; fi
  if echo "$t" | grep -qE "which service|service you|service.*book"; then echo "FUE Hair Transplant consultation please.|"; return; fi
  if echo "$t" | grep -qE "slot|available|how about|works for you|at [0-9]|noon|morning|afternoon"; then echo "Yes, please book that one.|"; return; fi
  echo "Yes please go ahead.|"
}

echo "=== setup: trial route $PATIENT → Berkeley ==="
q "INSERT INTO sms_trial_routes (user_phone, practice_id, expires_at) VALUES ('$PATIENT', '$BERK', now() + interval '1 day') ON CONFLICT (user_phone) DO UPDATE SET practice_id=EXCLUDED.practice_id, expires_at=EXCLUDED.expires_at" >/dev/null

START_TS=$(date -u -d "1 second ago" +"%Y-%m-%dT%H:%M:%S+00:00")
LAST_SEEN_TS="$START_TS"

echo ""
echo "=== TURN 1 — patient opens ==="
OPEN="Hi, I'd like to book a hair consultation. I'm Alex Carter, DOB 5th May 1990. Anything Friday morning works."
echo "  → $OPEN"
send "$OPEN"

for turn in 2 3 4 5 6; do
  echo ""
  echo "(turn $turn — waiting up to 30s for a new clinic reply…)"
  for i in 1 2 3 4 5 6; do
    sleep 5
    R=$(last_clinic "$LAST_SEEN_TS")
    if [ -n "$R" ]; then break; fi
  done
  if [ -z "$R" ]; then echo "  (no clinic reply landed — ending)"; break; fi
  echo "  ← agent: ${R:0:100}"
  LAST_SEEN_TS=$(date -u +"%Y-%m-%dT%H:%M:%S+00:00")
  PARTS=$(scripted "$R")
  NEXT="${PARTS%|*}"
  DONE="${PARTS##*|}"
  echo "  → patient: $NEXT"
  send "$NEXT"
  if [ "$DONE" = "DONE" ]; then sleep 4; break; fi
done

sleep 5
echo ""
echo "=== FULL CONVERSATION (DB truth) ==="
q "SELECT m.role, left(m.message, 95) text, m.channel, m.created_at FROM enquiry_messages m JOIN enquiries e ON e.id=m.enquiry_id JOIN contacts c ON c.id=e.contact_id WHERE c.phone='$PATIENT' AND c.practice_id='$BERK' AND m.created_at >= '$START_TS' ORDER BY m.created_at" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if isinstance(d,list):
  print(f'turns: {len(d)}')
  for r in d:
    arrow='→ patient' if r['role']=='patient' else '← clinic '
    print(f'  {arrow} | {r[\"text\"]}')
else:
  print('error:', d)
"
echo ""
echo "=== appointments created in this run ==="
q "SELECT to_char(a.starts_at AT TIME ZONE 'Europe/London','YYYY-MM-DD HH24:MI') local, a.status, a.source FROM appointments a JOIN contacts c ON c.id=a.contact_id WHERE c.phone='$PATIENT' AND a.practice_id='$BERK' AND a.created_at >= '$START_TS'" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if isinstance(d,list):
  print(f'appts: {len(d)}')
  for r in d: print('  -', r)
else: print(d)
"
