#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Part-by-Part Test Suite
# Run a specific part:  bash scripts/test-parts.sh 1
# Run all parts:        bash scripts/test-parts.sh all
# ─────────────────────────────────────────────────────────────

BASE="https://amxcposgqlmgapzoopze.supabase.co/functions/v1"
PRACTICE_ID="7a2d6e46-5941-46a7-b858-88c0483b1e12"
TWILIO_NUM="+441325796015"
TEST_PHONE="+447700900999"
JOHANNES_PHONE="+447787567871"
JOHANNES_CONTACT="2d7af6b9-ec55-4ae4-b993-33b64cabb126"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
PASS=0; FAIL=0

check() {
  if [ "$1" = "true" ]; then echo -e "  ${GREEN}✓ $2${NC}"; PASS=$((PASS+1))
  else echo -e "  ${RED}✗ $2${NC}"; FAIL=$((FAIL+1)); fi
}
info() { echo -e "  ${CYAN}→ $1${NC}"; }

dbquery() { npx supabase db query --linked "$1" 2>&1 | grep -v '^Initialising'; }

PART=${1:-help}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PART 1: Phone — new caller lookup
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
part1() {
  echo -e "\n${YELLOW}PART 1: Phone — New Caller Lookup${NC}"
  echo -e "${CYAN}Simulates: call connects → lookup phone → get practice context${NC}\n"

  R=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=lookup_caller_phone" \
    -H "Content-Type: application/json" \
    -d "{\"caller_phone\":\"$TEST_PHONE\",\"twilio_number\":\"$TWILIO_NUM\",\"conversation_id\":\"test-part1-$(date +%s)\"}")

  check "$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('success') else 'false')" 2>/dev/null)" "Function returns success (no 401)"

  ENQUIRY_ID=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('enquiry_id',''))" 2>/dev/null)
  CONV_ID=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('conversation_db_id',''))" 2>/dev/null)

  check "$([ -n "$ENQUIRY_ID" ] && echo true || echo false)" "Enquiry created → shows in dashboard ($ENQUIRY_ID)"
  check "$([ -n "$CONV_ID" ] && echo true || echo false)" "Conversation created ($CONV_ID)"
  check "$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('agent_instructions') else 'false')" 2>/dev/null)" "agent_instructions: never deflect to humans"
  check "$(echo "$R" | python3 -c "import json,sys; print('true' if len(json.load(sys.stdin).get('practitioners',[])) > 0 else 'false')" 2>/dev/null)" "Practitioners with bios loaded"
  check "$(echo "$R" | python3 -c "import json,sys; print('true' if len(json.load(sys.stdin).get('prices',[])) > 0 else 'false')" 2>/dev/null)" "Price list loaded"
  check "$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('practice_hours') else 'false')" 2>/dev/null)" "Practice hours loaded"
  check "$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('found') == False else 'false')" 2>/dev/null)" "New caller — no account found (correct)"

  info "Practice: $(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('practice_name',''))" 2>/dev/null)"
  info "Practitioners: $(echo "$R" | python3 -c "import json,sys; print(', '.join([p['name'] for p in json.load(sys.stdin).get('practitioners',[])]))" 2>/dev/null)"

  # DB verify
  echo ""
  ENQ=$(dbquery "SELECT id, source, patient_name FROM enquiries WHERE id = '$ENQUIRY_ID'")
  check "$(echo "$ENQ" | python3 -c "import json,sys; r=json.load(sys.stdin).get('rows',[]); print('true' if r else 'false')" 2>/dev/null)" "Enquiry exists in DB (dashboard will show it)"

  CONV=$(dbquery "SELECT id, enquiry_id FROM conversations WHERE id = '$CONV_ID'")
  check "$(echo "$CONV" | python3 -c "import json,sys; r=json.load(sys.stdin).get('rows',[]); print('true' if r and r[0].get('enquiry_id')=='$ENQUIRY_ID' else 'false')" 2>/dev/null)" "Conversation linked to enquiry"

  # Cleanup
  dbquery "DELETE FROM conversations WHERE id = '$CONV_ID'" > /dev/null 2>&1
  dbquery "DELETE FROM enquiries WHERE id = '$ENQUIRY_ID'" > /dev/null 2>&1
  info "Test data cleaned up"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PART 2: Phone — returning patient lookup
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
part2() {
  echo -e "\n${YELLOW}PART 2: Phone — Returning Patient (Johannes)${NC}"
  echo -e "${CYAN}Simulates: known patient calls → recognised → gets last practitioner${NC}\n"

  R=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=lookup_caller_phone" \
    -H "Content-Type: application/json" \
    -d "{\"caller_phone\":\"$JOHANNES_PHONE\",\"twilio_number\":\"$TWILIO_NUM\",\"conversation_id\":\"test-part2-$(date +%s)\"}")

  check "$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('found') else 'false')" 2>/dev/null)" "Patient found"

  NAME=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('contact_name',''))" 2>/dev/null)
  check "$([ -n "$NAME" ] && echo true || echo false)" "Patient name: $NAME"

  LAST_PRAC=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('last_practitioner','') or 'none')" 2>/dev/null)
  check "$([ "$LAST_PRAC" != "none" ] && echo true || echo false)" "Last practitioner: $LAST_PRAC"

  HAS_HISTORY=$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('conversation_history') else 'false')" 2>/dev/null)
  check "$HAS_HISTORY" "Conversation history (RAG) loaded"

  ENQUIRY_ID=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('enquiry_id',''))" 2>/dev/null)
  CONV_ID=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('conversation_db_id',''))" 2>/dev/null)
  check "$([ -n "$ENQUIRY_ID" ] && echo true || echo false)" "Enquiry created for dashboard"

  info "Message: $(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message','')[:150])" 2>/dev/null)"

  # Cleanup
  dbquery "DELETE FROM conversations WHERE id = '$CONV_ID'" > /dev/null 2>&1
  dbquery "DELETE FROM enquiries WHERE id = '$ENQUIRY_ID'" > /dev/null 2>&1
  info "Test data cleaned up"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PART 3: Availability — known service + slot ranking
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
part3() {
  echo -e "\n${YELLOW}PART 3: Availability — Known Service (Check-up)${NC}"
  echo -e "${CYAN}Simulates: patient asks for a check-up → slots ranked → recommendation${NC}\n"

  R=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=search_availability" \
    -H "Content-Type: application/json" \
    -d "{\"practice_id\":\"$PRACTICE_ID\",\"service_name\":\"Check-up\"}")

  SLOTS=$(echo "$R" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('slots',[])))" 2>/dev/null)
  check "$([ "$SLOTS" -gt 0 ] && echo true || echo false)" "Slots found: $SLOTS"

  REC=$(echo "$R" | python3 -c "import json,sys; r=json.load(sys.stdin).get('recommended_slot'); print(r['display'] if r else 'none')" 2>/dev/null)
  check "$([ "$REC" != "none" ] && echo true || echo false)" "Recommended slot: $REC"

  REASON=$(echo "$R" | python3 -c "import json,sys; r=json.load(sys.stdin).get('recommended_slot'); print(r['reason'] if r else 'none')" 2>/dev/null)
  check "$([ "$REASON" != "none" ] && echo true || echo false)" "Reason: $REASON"

  PRICE=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('service_price',''))" 2>/dev/null)
  check "$([ -n "$PRICE" ] && echo true || echo false)" "Price: $PRICE"

  DUR=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('service_duration',''))" 2>/dev/null)
  check "$([ -n "$DUR" ] && echo true || echo false)" "Duration: $DUR"

  check "$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('booking_instruction') else 'false')" 2>/dev/null)" "booking_instruction: always book, never deflect"

  info "All slots:"
  echo "$R" | python3 -c "
import json,sys
for s in json.load(sys.stdin).get('slots',[]):
    print(f'    {s[\"display\"]}')
" 2>/dev/null
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PART 4: Availability — returning patient (practitioner ranking)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
part4() {
  echo -e "\n${YELLOW}PART 4: Availability — Returning Patient Ranking${NC}"
  echo -e "${CYAN}Simulates: Johannes asks for check-up → last practitioner prioritised${NC}\n"

  R=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=search_availability" \
    -H "Content-Type: application/json" \
    -d "{\"practice_id\":\"$PRACTICE_ID\",\"service_name\":\"Check-up\",\"contact_id\":\"$JOHANNES_CONTACT\"}")

  REC=$(echo "$R" | python3 -c "import json,sys; r=json.load(sys.stdin).get('recommended_slot'); print(r['display'] if r else 'none')" 2>/dev/null)
  REASON=$(echo "$R" | python3 -c "import json,sys; r=json.load(sys.stdin).get('recommended_slot'); print(r['reason'] if r else 'none')" 2>/dev/null)

  check "$([ "$REC" != "none" ] && echo true || echo false)" "Recommended: $REC"
  check "$(echo "$REASON" | grep -qi 'last time\|continuity' && echo true || echo false)" "Reason references previous practitioner: $REASON"

  info "Top 3 slots:"
  echo "$R" | python3 -c "
import json,sys
for s in json.load(sys.stdin).get('slots',[])[:3]:
    print(f'    {s[\"display\"]}')
" 2>/dev/null
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PART 5: Availability — unknown service (Invisalign)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
part5() {
  echo -e "\n${YELLOW}PART 5: Unknown Service — Invisalign${NC}"
  echo -e "${CYAN}Simulates: patient asks for a service we don't offer${NC}\n"

  R=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=search_availability" \
    -H "Content-Type: application/json" \
    -d "{\"practice_id\":\"$PRACTICE_ID\",\"service_name\":\"Invisalign\"}")

  check "$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('service_not_found') else 'false')" 2>/dev/null)" "service_not_found flag set"

  ALT=$(echo "$R" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('available_services',[])))" 2>/dev/null)
  check "$([ "$ALT" -gt 0 ] && echo true || echo false)" "Alternative services listed: $ALT"

  MSG=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message',''))" 2>/dev/null)
  check "$(echo "$MSG" | grep -qi 'consultation' && echo true || echo false)" "Suggests booking a consultation"
  check "$(echo "$MSG" | grep -qi 'call\|team\|reception\|speak to' && echo false || echo true)" "No human handoff in message"

  info "Message: ${MSG:0:200}"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PART 6: Booking — full flow
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
part6() {
  echo -e "\n${YELLOW}PART 6: Booking — Full Flow${NC}"
  echo -e "${CYAN}Simulates: search → pick slot → book → verify in DB${NC}\n"

  # Step 1: Search
  AVAIL=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=search_availability" \
    -H "Content-Type: application/json" \
    -d "{\"practice_id\":\"$PRACTICE_ID\",\"service_name\":\"Check-up\"}")

  SERVICE_ID=$(echo "$AVAIL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('service_id',''))" 2>/dev/null)
  SLOT=$(echo "$AVAIL" | python3 -c "
import json,sys
s=json.load(sys.stdin).get('slots',[{}])[0]
print(json.dumps({'practitioner_id':s.get('practitioner_id',''),'date':s.get('date',''),'start_time':s.get('start_time',''),'end_time':s.get('end_time','')}))" 2>/dev/null)
  DISPLAY=$(echo "$AVAIL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('slots',[{}])[0].get('display',''))" 2>/dev/null)

  info "Picked slot: $DISPLAY"

  # Step 2: Book
  BOOK=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=request_appointment" \
    -H "Content-Type: application/json" \
    -d "{
      \"practice_id\":\"$PRACTICE_ID\",
      \"service_id\":\"$SERVICE_ID\",
      \"chosen_slot\":$SLOT,
      \"notes\":\"E2E test booking — safe to delete\"
    }")

  BOOK_OK=$(echo "$BOOK" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('success') else 'false')" 2>/dev/null)
  REQUEST_ID=$(echo "$BOOK" | python3 -c "import json,sys; print(json.load(sys.stdin).get('request_id',''))" 2>/dev/null)
  STATUS=$(echo "$BOOK" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  MSG=$(echo "$BOOK" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message',''))" 2>/dev/null)

  check "$BOOK_OK" "Booking success"
  check "$([ -n "$REQUEST_ID" ] && echo true || echo false)" "Request ID: $REQUEST_ID"
  check "$([ "$STATUS" = "confirmed" ] && echo true || echo false)" "Status: $STATUS"
  check "$(echo "$MSG" | grep -qi 'transfer\|team\|reception\|call' && echo false || echo true)" "No handoff: \"$MSG\""

  # Step 3: Verify in DB
  echo ""
  APPT=$(dbquery "SELECT id, status, chosen_slot FROM appointment_requests WHERE id = '$REQUEST_ID'")
  check "$(echo "$APPT" | python3 -c "import json,sys; r=json.load(sys.stdin).get('rows',[]); print('true' if r else 'false')" 2>/dev/null)" "Appointment request in DB"

  DIARY=$(dbquery "SELECT id, status, starts_at, practitioner_id FROM appointments WHERE source = 'phone' AND notes LIKE '%E2E test%' ORDER BY created_at DESC LIMIT 1")
  DIARY_EXISTS=$(echo "$DIARY" | python3 -c "import json,sys; r=json.load(sys.stdin).get('rows',[]); print('true' if r else 'false')" 2>/dev/null)
  check "$DIARY_EXISTS" "Appointment in diary table"

  if [ "$DIARY_EXISTS" = "true" ]; then
    STARTS=$(echo "$DIARY" | python3 -c "import json,sys; print(json.load(sys.stdin)['rows'][0]['starts_at'])" 2>/dev/null)
    info "Diary entry starts_at: $STARTS"
  fi

  # Cleanup
  dbquery "DELETE FROM appointments WHERE source = 'phone' AND notes LIKE '%E2E test%'" > /dev/null 2>&1
  dbquery "DELETE FROM appointment_requests WHERE id = '$REQUEST_ID'" > /dev/null 2>&1
  info "Test data cleaned up"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PART 7: Web chat — Chatbase context
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
part7() {
  echo -e "\n${YELLOW}PART 7: Web Chat — Chatbase Context${NC}"
  echo -e "${CYAN}Simulates: Poppy loads on website → gets full practice knowledge${NC}\n"

  R=$(curl -s -X GET "$BASE/chatbase-action?practiceId=$PRACTICE_ID")

  check "$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('practice_name') else 'false')" 2>/dev/null)" "Practice name loaded"
  check "$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('team') else 'false')" 2>/dev/null)" "Team with bios"
  check "$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('prices') else 'false')" 2>/dev/null)" "Price list"
  check "$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('opening_hours') else 'false')" 2>/dev/null)" "Opening hours"
  check "$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('about') else 'false')" 2>/dev/null)" "USPs / About"

  GUIDE=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('clinic_guidelines') or '(empty — set in DB to enrich AI)')" 2>/dev/null)
  TONE=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('agent_tone') or '(empty — set in DB to enrich AI)')" 2>/dev/null)
  info "clinic_guidelines: $GUIDE"
  info "agent_tone: $TONE"

  echo ""
  info "Team details:"
  echo "$R" | python3 -c "
import json,sys
for line in json.load(sys.stdin).get('team','').split('\n'):
    print(f'    {line[:120]}')
" 2>/dev/null

  echo ""
  info "Prices (first 5):"
  echo "$R" | python3 -c "
import json,sys
for line in json.load(sys.stdin).get('prices','').split('\n')[:5]:
    print(f'    {line}')
" 2>/dev/null
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PART 8: Web chat — returning patient RAG
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
part8() {
  echo -e "\n${YELLOW}PART 8: Web Chat — Returning Patient RAG${NC}"
  echo -e "${CYAN}Simulates: patient gives phone number → Poppy recognises them${NC}\n"

  R=$(curl -s -X GET "$BASE/chatbase-action?practiceId=$PRACTICE_ID&phone=07787567871")

  RETURNING=$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('returning_patient') else 'false')" 2>/dev/null)
  check "$RETURNING" "Returning patient detected"

  NAME=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('patient_name',''))" 2>/dev/null)
  check "$([ -n "$NAME" ] && echo true || echo false)" "Patient name: $NAME"

  HAS_INSTRUCTIONS=$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('instructions_for_poppy') else 'false')" 2>/dev/null)
  check "$HAS_INSTRUCTIONS" "Poppy instructions (step-by-step re-identification)"

  HAS_HISTORY=$(echo "$R" | python3 -c "import json,sys; print('true' if json.load(sys.stdin).get('previous_interactions') else 'false')" 2>/dev/null)
  check "$HAS_HISTORY" "Previous interactions loaded"

  CONV_COUNT=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('previous_interactions','').count('['))" 2>/dev/null)
  info "Conversations in history: $CONV_COUNT"

  echo ""
  info "Poppy instructions:"
  echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('instructions_for_poppy',{})
for k,v in d.items():
    print(f'    {k}: {v[:120]}...')
" 2>/dev/null
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PART 9: Dashboard sync — verify enquiries show up
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
part9() {
  echo -e "\n${YELLOW}PART 9: Dashboard Sync — Enquiries + Conversations${NC}"
  echo -e "${CYAN}Creates a phone call + booking, verifies all records link correctly${NC}\n"

  # Create call
  CALL=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=lookup_caller_phone" \
    -H "Content-Type: application/json" \
    -d "{\"caller_phone\":\"$TEST_PHONE\",\"twilio_number\":\"$TWILIO_NUM\",\"conversation_id\":\"test-part9-$(date +%s)\"}")

  ENQUIRY_ID=$(echo "$CALL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('enquiry_id',''))" 2>/dev/null)
  CONV_ID=$(echo "$CALL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('conversation_db_id',''))" 2>/dev/null)

  # Book appointment
  AVAIL=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=search_availability" \
    -H "Content-Type: application/json" \
    -d "{\"practice_id\":\"$PRACTICE_ID\",\"service_name\":\"Hygiene Appointment\"}")

  SERVICE_ID=$(echo "$AVAIL" | python3 -c "import json,sys; print(json.load(sys.stdin).get('service_id',''))" 2>/dev/null)
  SLOT=$(echo "$AVAIL" | python3 -c "
import json,sys
s=json.load(sys.stdin).get('slots',[{}])[0]
print(json.dumps({'practitioner_id':s.get('practitioner_id',''),'date':s.get('date',''),'start_time':s.get('start_time',''),'end_time':s.get('end_time','')}))" 2>/dev/null)

  BOOK=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=request_appointment" \
    -H "Content-Type: application/json" \
    -d "{\"practice_id\":\"$PRACTICE_ID\",\"service_id\":\"$SERVICE_ID\",\"enquiry_id\":\"$ENQUIRY_ID\",\"chosen_slot\":$SLOT,\"notes\":\"E2E test — safe to delete\"}")
  REQUEST_ID=$(echo "$BOOK" | python3 -c "import json,sys; print(json.load(sys.stdin).get('request_id',''))" 2>/dev/null)

  echo -e "  ${CYAN}Created: enquiry=$ENQUIRY_ID conv=$CONV_ID booking=$REQUEST_ID${NC}\n"

  # Verify chain
  ENQ=$(dbquery "SELECT id, source, patient_name, is_completed FROM enquiries WHERE id = '$ENQUIRY_ID'")
  check "$(echo "$ENQ" | python3 -c "import json,sys; r=json.load(sys.stdin).get('rows',[]); print('true' if r else 'false')" 2>/dev/null)" "Enquiry in enquiries table"
  check "$(echo "$ENQ" | python3 -c "import json,sys; r=json.load(sys.stdin).get('rows',[]); print('true' if r and r[0].get('source')=='phone' else 'false')" 2>/dev/null)" "Source = phone"

  CONV=$(dbquery "SELECT id, channel, enquiry_id, status FROM conversations WHERE id = '$CONV_ID'")
  check "$(echo "$CONV" | python3 -c "import json,sys; r=json.load(sys.stdin).get('rows',[]); print('true' if r else 'false')" 2>/dev/null)" "Conversation in conversations table"
  check "$(echo "$CONV" | python3 -c "import json,sys; r=json.load(sys.stdin).get('rows',[]); print('true' if r and r[0].get('enquiry_id')=='$ENQUIRY_ID' else 'false')" 2>/dev/null)" "Conversation → enquiry linked"
  check "$(echo "$CONV" | python3 -c "import json,sys; r=json.load(sys.stdin).get('rows',[]); print('true' if r and r[0].get('channel')=='phone' else 'false')" 2>/dev/null)" "Channel = phone"

  APPT=$(dbquery "SELECT id, status FROM appointment_requests WHERE id = '$REQUEST_ID'")
  check "$(echo "$APPT" | python3 -c "import json,sys; r=json.load(sys.stdin).get('rows',[]); print('true' if r else 'false')" 2>/dev/null)" "Appointment request in DB"
  check "$(echo "$APPT" | python3 -c "import json,sys; r=json.load(sys.stdin).get('rows',[]); print('true' if r and r[0].get('status')=='confirmed' else 'false')" 2>/dev/null)" "Booking status = confirmed"

  DIARY=$(dbquery "SELECT id FROM appointments WHERE source = 'phone' AND notes LIKE '%E2E test%' ORDER BY created_at DESC LIMIT 1")
  check "$(echo "$DIARY" | python3 -c "import json,sys; r=json.load(sys.stdin).get('rows',[]); print('true' if r else 'false')" 2>/dev/null)" "Appointment in diary (appointments table)"

  # Cleanup
  dbquery "DELETE FROM appointments WHERE source = 'phone' AND notes LIKE '%E2E test%'" > /dev/null 2>&1
  dbquery "DELETE FROM appointment_requests WHERE id = '$REQUEST_ID'" > /dev/null 2>&1
  dbquery "DELETE FROM conversations WHERE id = '$CONV_ID'" > /dev/null 2>&1
  dbquery "DELETE FROM enquiries WHERE id = '$ENQUIRY_ID'" > /dev/null 2>&1
  info "Test data cleaned up"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# RUNNER
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

run_summary() {
  echo ""
  echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
  TOTAL=$((PASS+FAIL))
  if [ "$FAIL" -eq 0 ]; then echo -e "${GREEN}  ALL $TOTAL CHECKS PASSED${NC}"
  else echo -e "${RED}  $FAIL FAILED${NC} / ${GREEN}$PASS PASSED${NC} / $TOTAL TOTAL"; fi
  echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
}

case "$PART" in
  1) part1; run_summary ;;
  2) part2; run_summary ;;
  3) part3; run_summary ;;
  4) part4; run_summary ;;
  5) part5; run_summary ;;
  6) part6; run_summary ;;
  7) part7; run_summary ;;
  8) part8; run_summary ;;
  9) part9; run_summary ;;
  all)
    for i in 1 2 3 4 5 6 7 8 9; do
      eval "part$i"
    done
    run_summary
    ;;
  *)
    echo ""
    echo -e "${CYAN}Usage: bash scripts/test-parts.sh <part>${NC}"
    echo ""
    echo "  1  Phone — new caller lookup"
    echo "  2  Phone — returning patient (Johannes)"
    echo "  3  Availability — known service + recommendation"
    echo "  4  Availability — returning patient ranking"
    echo "  5  Availability — unknown service (Invisalign)"
    echo "  6  Booking — full flow (search → book → verify DB)"
    echo "  7  Web chat — Chatbase context"
    echo "  8  Web chat — returning patient RAG"
    echo "  9  Dashboard sync — full chain verification"
    echo "  all  Run all parts"
    echo ""
    ;;
esac
