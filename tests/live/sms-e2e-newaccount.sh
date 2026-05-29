#!/bin/bash
# NEW account SMS end-to-end: provision a fresh practice via API → trial-route
# a fictional patient to it → multi-turn simulated SMS → verify webhook +
# ai-reply + persistence all work for a brand-new account.
set +e
SUPABASE_TOKEN=$(cat ~/.supabase/access-token)
SUPA_URL="https://amxcposgqlmgapzoopze.supabase.co"
PATIENT="+447700900202"
WEBHOOK="$SUPA_URL/functions/v1/textmagic-webhook"

q() {
  curl -sS -X POST -H "Authorization: Bearer $SUPABASE_TOKEN" -H "Content-Type: application/json" \
    "https://api.supabase.com/v1/projects/amxcposgqlmgapzoopze/database/query" \
    --data-raw "{\"query\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$1")}"
}

ANON=$(curl -sS -H "Authorization: Bearer $SUPABASE_TOKEN" "https://api.supabase.com/v1/projects/amxcposgqlmgapzoopze/api-keys?reveal=true" | python3 -c "import json,sys; [print(k['api_key']) for k in json.load(sys.stdin) if k.get('name')=='service_role']")

echo "=== create test user + practice (via admin API) ==="
EMAIL="sms-e2e-$(date +%s)@test.pathir.dev"
PW="TestPathir-2026!"
USERID=$(curl -sS -X POST -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" "$SUPA_URL/auth/v1/admin/users" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"email_confirm\":true}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
echo "user: $USERID"
PRACTICE_NAME="SMS E2E Test $(date +%s)"
PID=$(q "INSERT INTO practices (name, industry, owner_id, integrations, opening_hours) VALUES ('$PRACTICE_NAME', 'dental', '$USERID', '{\"sms_enabled\":true}'::jsonb, '[{\"day\":\"Monday\",\"is_open\":true,\"open_time\":\"09:00\",\"close_time\":\"17:00\"},{\"day\":\"Tuesday\",\"is_open\":true,\"open_time\":\"09:00\",\"close_time\":\"17:00\"},{\"day\":\"Wednesday\",\"is_open\":true,\"open_time\":\"09:00\",\"close_time\":\"17:00\"},{\"day\":\"Thursday\",\"is_open\":true,\"open_time\":\"09:00\",\"close_time\":\"17:00\"},{\"day\":\"Friday\",\"is_open\":true,\"open_time\":\"09:00\",\"close_time\":\"17:00\"}]'::jsonb) RETURNING id" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['id'] if isinstance(d,list) and d else '')")
echo "practice: $PID"
if [ -z "$PID" ]; then echo "FAILED to create practice"; exit 1; fi

echo ""
echo "=== provision agent via provision-practice ==="
USERJWT=$(curl -sS -X POST -H "apikey: $ANON" -H "Content-Type: application/json" "$SUPA_URL/auth/v1/token?grant_type=password" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))")
curl -sS -X POST "$SUPA_URL/functions/v1/provision-practice" -H "apikey: $ANON" -H "Authorization: Bearer $USERJWT" -H "Content-Type: application/json" -d "{\"practiceId\":\"$PID\"}" | python3 -c "import json,sys; d=json.load(sys.stdin); print('  agent_id:', d.get('agent_id','(none)'), '| ok:', d.get('ok'))"

echo ""
echo "=== set trial route $PATIENT → new practice ==="
q "INSERT INTO sms_trial_routes (user_phone, practice_id, expires_at) VALUES ('$PATIENT', '$PID', now() + interval '1 day') ON CONFLICT (user_phone) DO UPDATE SET practice_id=EXCLUDED.practice_id, expires_at=EXCLUDED.expires_at" >/dev/null

START_TS=$(date -u -d "1 second ago" +"%Y-%m-%dT%H:%M:%S+00:00")
LAST_SEEN_TS="$START_TS"

echo ""
LIVE_ROOT="/home/ubuntu/Paltir/demo/live"
BRAIN_SCRIPT="$LIVE_ROOT/tests/live/patient-brain.ts"
HISTORY_JSON='[]'
PERSONA='You are Sam Rivers, a patient texting a brand-new dental clinic to book a routine check-up. Name Sam Rivers, DOB 3rd March 1990. Reply with ONE short SMS sentence per turn — no quotes, no labels. When a specific time slot is offered, accept it ("Yes, please book that one"). Once the clinic confirms it is booked, say "Thank you, goodbye!" and stop.'
push_hist() { HISTORY_JSON=$(python3 -c "import json,sys; h=json.loads(sys.argv[1]); h.append({'role':sys.argv[2],'text':sys.argv[3]}); print(json.dumps(h))" "$HISTORY_JSON" "$1" "$2"); }
brain() {
  local out
  out=$(cd "$LIVE_ROOT" && echo "$HISTORY_JSON" | PATIENT_PERSONA="$PERSONA" DOTENV_CONFIG_QUIET=true npx --silent tsx "$BRAIN_SCRIPT" 2>/dev/null | grep -v "^\[dotenv" | tail -1)
  if [ -z "$out" ]; then echo "Yes please.|"; return; fi
  local t="$(echo "$out" | tr '[:upper:]' '[:lower:]')"
  local done=""
  if echo "$t" | grep -qE "goodbye|^thank you[!.]*$|^thanks[!.]*$"; then done="DONE"; fi
  echo "$out|$done"
}

echo "=== TURN 1 — patient opens (NEW account inbound) ==="
cd "$LIVE_ROOT" && npx --silent tsx "$BRAIN_SCRIPT" --cleanup 2>/dev/null || true
OPEN="Hi, I'd like to book a dental check-up next Friday at 10am. Name Sam Rivers, DOB 3rd March 1990."
echo "  → $OPEN"
push_hist "patient" "$OPEN"
curl -sS -o /dev/null -X POST "$WEBHOOK" -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "sender=$PATIENT" --data-urlencode "receiver=+447418341716" --data-urlencode "text=$OPEN" --data-urlencode "messageId=na_$RANDOM"

for turn in 2 3 4 5 6 7 8; do
  echo ""
  echo "(turn $turn — waiting up to 30s for AI reply…)"
  for i in 1 2 3 4 5 6; do
    sleep 5
    R=$(q "SELECT m.message FROM enquiry_messages m JOIN enquiries e ON e.id=m.enquiry_id JOIN contacts c ON c.id=e.contact_id WHERE c.phone='$PATIENT' AND c.practice_id='$PID' AND m.role='clinic' AND m.created_at > '$LAST_SEEN_TS' ORDER BY m.created_at DESC LIMIT 1" | python3 -c "import json,sys
try:
  d=json.load(sys.stdin)
  if isinstance(d,list) and d: print(d[0].get('message',''))
  else: print('')
except: print('')")
    if [ -n "$R" ]; then break; fi
  done
  if [ -z "$R" ]; then echo "  (no reply — ending)"; break; fi
  echo "  ← agent: ${R:0:90}"
  LAST_SEEN_TS=$(date -u +"%Y-%m-%dT%H:%M:%S+00:00")
  push_hist "clinic" "$R"
  RESULT=$(brain)
  NEXT="${RESULT%|*}"
  DONE="${RESULT##*|}"
  echo "  → patient [elevenlabs]: $NEXT"
  push_hist "patient" "$NEXT"
  curl -sS -o /dev/null -X POST "$WEBHOOK" -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "sender=$PATIENT" --data-urlencode "receiver=+447418341716" --data-urlencode "text=$NEXT" --data-urlencode "messageId=na${turn}_$RANDOM"
  [ "$DONE" = "DONE" ] && sleep 4 && break
done

cd "$LIVE_ROOT" && npx --silent tsx "$BRAIN_SCRIPT" --cleanup 2>/dev/null || true

sleep 5
echo ""
echo "=== FULL CONVERSATION on the NEW practice (DB truth) ==="
q "SELECT m.role, left(m.message, 90) text FROM enquiry_messages m JOIN enquiries e ON e.id=m.enquiry_id JOIN contacts c ON c.id=e.contact_id WHERE c.phone='$PATIENT' AND c.practice_id='$PID' AND m.created_at >= '$START_TS' ORDER BY m.created_at" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if isinstance(d,list):
  print(f'turns persisted: {len(d)}')
  for r in d:
    arrow='→ patient' if r['role']=='patient' else '← clinic '
    print(f'  {arrow} | {r[\"text\"]}')
"

echo ""
echo "=== appointment(s) committed (London local time) ==="
q "SELECT to_char(starts_at AT TIME ZONE 'Europe/London','YYYY-MM-DD HH24:MI') london, source, status FROM appointments WHERE practice_id='$PID'" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if isinstance(d,list):
  print(f'appts: {len(d)}')
  for r in d: print('  -', r)
"

echo ""
echo "=== CLEANUP: delete test practice + user ==="
q "DELETE FROM enquiry_messages WHERE enquiry_id IN (SELECT id FROM enquiries WHERE practice_id='$PID')" >/dev/null
q "DELETE FROM enquiries WHERE practice_id='$PID'" >/dev/null
q "DELETE FROM conversations WHERE practice_id='$PID'" >/dev/null
q "DELETE FROM appointments WHERE practice_id='$PID'" >/dev/null
q "DELETE FROM contacts WHERE practice_id='$PID'" >/dev/null
q "DELETE FROM practitioner_services WHERE service_id IN (SELECT id FROM services WHERE practice_id='$PID')" >/dev/null
q "DELETE FROM services WHERE practice_id='$PID'" >/dev/null
q "DELETE FROM practitioners WHERE practice_id='$PID'" >/dev/null
q "DELETE FROM sms_trial_routes WHERE user_phone='$PATIENT'" >/dev/null
q "DELETE FROM practices WHERE id='$PID'" >/dev/null
curl -sS -X DELETE -H "apikey: $ANON" -H "Authorization: Bearer $ANON" "$SUPA_URL/auth/v1/admin/users/$USERID" >/dev/null
echo "cleaned up"
