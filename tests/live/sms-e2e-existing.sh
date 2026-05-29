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

# ─── LLM-driven patient brain (ElevenLabs ConvAI → Claude/GPT under the hood) ───
LIVE_ROOT="/home/ubuntu/Paltir/demo/live"
BRAIN_SCRIPT="$LIVE_ROOT/tests/live/patient-brain.ts"
HISTORY_JSON='[]'
PERSONA='You are Alex Carter, a patient texting Berkeley Hair Clinic for an FUE hair-transplant consultation. Preferred location: Knightsbridge. DOB 5th May 1990. Reply with ONE short SMS sentence per turn — no quotes, no labels. When a specific time slot is offered, accept it. Once the clinic confirms it is booked, say "Thank you, goodbye!" and stop.'

push_hist() {
  HISTORY_JSON=$(python3 -c "import json,sys; h=json.loads(sys.argv[1]); h.append({'role':sys.argv[2],'text':sys.argv[3]}); print(json.dumps(h))" "$HISTORY_JSON" "$1" "$2")
}

brain() {
  # dotenv writes a "[dotenv@17.x] injecting env..." tip to STDOUT — strip it.
  local out
  out=$(cd "$LIVE_ROOT" && echo "$HISTORY_JSON" | PATIENT_PERSONA="$PERSONA" DOTENV_CONFIG_QUIET=true npx --silent tsx "$BRAIN_SCRIPT" 2>/dev/null | grep -v "^\[dotenv" | tail -1)
  if [ -z "$out" ]; then echo "Yes please.|"; return; fi
  local t="$(echo "$out" | tr '[:upper:]' '[:lower:]')"
  local done=""
  if echo "$t" | grep -qE "goodbye|^thank you[!.]*$|^thanks[!.]*$"; then done="DONE"; fi
  echo "$out|$done"
}

echo "=== setup: trial route $PATIENT → Berkeley ==="
q "INSERT INTO sms_trial_routes (user_phone, practice_id, expires_at) VALUES ('$PATIENT', '$BERK', now() + interval '1 day') ON CONFLICT (user_phone) DO UPDATE SET practice_id=EXCLUDED.practice_id, expires_at=EXCLUDED.expires_at" >/dev/null
echo "=== cleanup any prior brain agent ==="; cd "$LIVE_ROOT" && npx --silent tsx "$BRAIN_SCRIPT" --cleanup 2>/dev/null || true

START_TS=$(date -u -d "1 second ago" +"%Y-%m-%dT%H:%M:%S+00:00")
LAST_SEEN_TS="$START_TS"

echo ""
echo "=== TURN 1 — patient opens ==="
OPEN="Hi, I'd like to book a hair consultation. I'm Alex Carter, DOB 5th May 1990. Anything Friday morning works."
echo "  → $OPEN"
push_hist "patient" "$OPEN"
send "$OPEN"

for turn in 2 3 4 5 6 7 8; do
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
  push_hist "clinic" "$R"
  PARTS=$(brain)
  NEXT="${PARTS%|*}"
  DONE="${PARTS##*|}"
  echo "  → patient [elevenlabs]: $NEXT"
  push_hist "patient" "$NEXT"
  send "$NEXT"
  if [ "$DONE" = "DONE" ]; then sleep 4; break; fi
done

cd "$LIVE_ROOT" && npx --silent tsx "$BRAIN_SCRIPT" --cleanup 2>/dev/null || true

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
