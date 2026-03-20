#!/bin/bash
# ─────────────────────────────────────────────────────────────
# End-to-End Test: Phone + Chat → Enquiries + Booking
# Run: bash scripts/test-e2e.sh
# ─────────────────────────────────────────────────────────────

BASE="https://amxcposgqlmgapzoopze.supabase.co/functions/v1"
PRACTICE_ID="7a2d6e46-5941-46a7-b858-88c0483b1e12"
TWILIO_NUM="+441325796015"
TEST_PHONE="+447700900999"  # Fake test number

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
PASS=0
FAIL=0

check() {
  if [ "$1" = "true" ]; then
    echo -e "  ${GREEN}✓ $2${NC}"
    PASS=$((PASS+1))
  else
    echo -e "  ${RED}✗ $2${NC}"
    FAIL=$((FAIL+1))
  fi
}

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
echo -e "${CYAN}  PALTIR E2E TEST — $(date '+%Y-%m-%d %H:%M')${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════${NC}"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST 1: Phone call — lookup (simulates call start)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${YELLOW}TEST 1: Phone call — lookup_caller_phone${NC}"
LOOKUP=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=lookup_caller_phone" \
  -H "Content-Type: application/json" \
  -d "{\"caller_phone\":\"$TEST_PHONE\",\"twilio_number\":\"$TWILIO_NUM\",\"conversation_id\":\"test-e2e-phone-$(date +%s)\"}")

LOOKUP_OK=$(echo "$LOOKUP" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if d.get('success') else 'false')" 2>/dev/null)
PRACTICE_NAME=$(echo "$LOOKUP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('practice_name',''))" 2>/dev/null)
ENQUIRY_ID=$(echo "$LOOKUP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('enquiry_id',''))" 2>/dev/null)
CONV_ID=$(echo "$LOOKUP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('conversation_db_id',''))" 2>/dev/null)
HAS_INSTRUCTIONS=$(echo "$LOOKUP" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if d.get('agent_instructions') else 'false')" 2>/dev/null)
HAS_PRACTITIONERS=$(echo "$LOOKUP" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if len(d.get('practitioners',[])) > 0 else 'false')" 2>/dev/null)
HAS_PRICES=$(echo "$LOOKUP" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if len(d.get('prices',[])) > 0 else 'false')" 2>/dev/null)

check "$LOOKUP_OK" "Lookup returned success"
check "$([ -n "$PRACTICE_NAME" ] && echo true || echo false)" "Practice name: $PRACTICE_NAME"
check "$([ -n "$ENQUIRY_ID" ] && echo true || echo false)" "Enquiry created: $ENQUIRY_ID"
check "$([ -n "$CONV_ID" ] && echo true || echo false)" "Conversation created: $CONV_ID"
check "$HAS_INSTRUCTIONS" "agent_instructions injected"
check "$HAS_PRACTITIONERS" "Practitioners with bios loaded"
check "$HAS_PRICES" "Price list loaded"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST 2: Search availability — known service
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${YELLOW}TEST 2: Search availability — Check-up${NC}"
AVAIL=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=search_availability" \
  -H "Content-Type: application/json" \
  -d "{\"practice_id\":\"$PRACTICE_ID\",\"service_name\":\"Check-up\"}")

SLOTS=$(echo "$AVAIL" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('slots',[])))" 2>/dev/null)
REC_SLOT=$(echo "$AVAIL" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('recommended_slot'); print(r['display'] if r else 'none')" 2>/dev/null)
REC_REASON=$(echo "$AVAIL" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('recommended_slot'); print(r['reason'] if r else 'none')" 2>/dev/null)
SVC_PRICE=$(echo "$AVAIL" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('service_price','none'))" 2>/dev/null)
HAS_BOOKING_INST=$(echo "$AVAIL" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if d.get('booking_instruction') else 'false')" 2>/dev/null)
SERVICE_ID=$(echo "$AVAIL" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('service_id',''))" 2>/dev/null)

check "$([ "$SLOTS" -gt 0 ] && echo true || echo false)" "Slots found: $SLOTS"
check "$([ "$REC_SLOT" != "none" ] && echo true || echo false)" "Recommended: $REC_SLOT"
check "$([ "$REC_REASON" != "none" ] && echo true || echo false)" "Reason: $REC_REASON"
check "$([ "$SVC_PRICE" != "none" ] && echo true || echo false)" "Price: $SVC_PRICE"
check "$HAS_BOOKING_INST" "booking_instruction injected"

# Grab first slot for booking test
SLOT_JSON=$(echo "$AVAIL" | python3 -c "
import json,sys
d=json.load(sys.stdin)
s=d.get('slots',[{}])[0]
print(json.dumps({'practitioner_id':s.get('practitioner_id',''),'date':s.get('date',''),'start_time':s.get('start_time',''),'end_time':s.get('end_time','')}))" 2>/dev/null)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST 3: Search availability — unknown service (Invisalign)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${YELLOW}TEST 3: Unknown service — Invisalign${NC}"
UNKNOWN=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=search_availability" \
  -H "Content-Type: application/json" \
  -d "{\"practice_id\":\"$PRACTICE_ID\",\"service_name\":\"Invisalign\"}")

NOT_FOUND=$(echo "$UNKNOWN" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if d.get('service_not_found') else 'false')" 2>/dev/null)
ALT_COUNT=$(echo "$UNKNOWN" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('available_services',[])))" 2>/dev/null)
HAS_CONSULT=$(echo "$UNKNOWN" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if 'consultation' in d.get('message','').lower() else 'false')" 2>/dev/null)

check "$NOT_FOUND" "Service not found flag set"
check "$([ "$ALT_COUNT" -gt 0 ] && echo true || echo false)" "Alternative services listed: $ALT_COUNT"
check "$HAS_CONSULT" "Consultation suggested in message"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST 4: Book appointment (dummy)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${YELLOW}TEST 4: Book appointment${NC}"
BOOK=$(curl -s -X POST "$BASE/elevenlabs-tool?tool=request_appointment" \
  -H "Content-Type: application/json" \
  -d "{
    \"practice_id\":\"$PRACTICE_ID\",
    \"service_id\":\"$SERVICE_ID\",
    \"enquiry_id\":\"$ENQUIRY_ID\",
    \"chosen_slot\":$SLOT_JSON,
    \"notes\":\"E2E test booking — safe to delete\"
  }")

BOOK_OK=$(echo "$BOOK" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if d.get('success') else 'false')" 2>/dev/null)
BOOK_STATUS=$(echo "$BOOK" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null)
REQUEST_ID=$(echo "$BOOK" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('request_id',''))" 2>/dev/null)
BOOK_MSG=$(echo "$BOOK" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('message','')[:100])" 2>/dev/null)

check "$BOOK_OK" "Booking success"
check "$([ -n "$REQUEST_ID" ] && echo true || echo false)" "Request ID: $REQUEST_ID"
check "$(echo $BOOK_MSG | grep -qi 'transfer\|team\|reception' && echo false || echo true)" "No human handoff in message: \"$BOOK_MSG\""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST 5: Web chat — chatbase action
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${YELLOW}TEST 5: Web chat — chatbase-action${NC}"
CHAT=$(curl -s -X GET "$BASE/chatbase-action?practiceId=$PRACTICE_ID")

CHAT_NAME=$(echo "$CHAT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('practice_name',''))" 2>/dev/null)
CHAT_TEAM=$(echo "$CHAT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if d.get('team') else 'false')" 2>/dev/null)
CHAT_PRICES=$(echo "$CHAT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if d.get('prices') else 'false')" 2>/dev/null)
CHAT_HOURS=$(echo "$CHAT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if d.get('opening_hours') else 'false')" 2>/dev/null)
CHAT_GUIDE=$(echo "$CHAT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('clinic_guidelines') or '(empty)')" 2>/dev/null)
CHAT_TONE=$(echo "$CHAT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('agent_tone') or '(empty)')" 2>/dev/null)

check "$([ -n "$CHAT_NAME" ] && echo true || echo false)" "Practice: $CHAT_NAME"
check "$CHAT_TEAM" "Team with bios loaded"
check "$CHAT_PRICES" "Price list loaded"
check "$CHAT_HOURS" "Opening hours loaded"
echo -e "  ${CYAN}ℹ clinic_guidelines: $CHAT_GUIDE${NC}"
echo -e "  ${CYAN}ℹ agent_tone: $CHAT_TONE${NC}"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST 6: Verify DB — enquiry + conversation + booking exist
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${YELLOW}TEST 6: Dashboard sync — DB verification${NC}"

# Helper: supabase db query outputs "Initialising login role..." before JSON — strip it
dbquery() {
  npx supabase db query --linked "$1" 2>&1 | grep -v '^Initialising'
}

# Check enquiry exists
ENQ_CHECK=$(dbquery "SELECT id, source, patient_name, is_completed FROM enquiries WHERE id = '$ENQUIRY_ID'")
ENQ_EXISTS=$(echo "$ENQ_CHECK" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if len(d.get('rows',[])) > 0 else 'false')" 2>/dev/null)
ENQ_SOURCE=$(echo "$ENQ_CHECK" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('rows',[]); print(r[0].get('source','') if r else '')" 2>/dev/null)

check "$ENQ_EXISTS" "Enquiry in DB: $ENQUIRY_ID"
check "$([ "$ENQ_SOURCE" = "phone" ] && echo true || echo false)" "Enquiry source: $ENQ_SOURCE"

# Check conversation exists
CONV_CHECK=$(dbquery "SELECT id, channel, enquiry_id FROM conversations WHERE id = '$CONV_ID'")
CONV_EXISTS=$(echo "$CONV_CHECK" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if len(d.get('rows',[])) > 0 else 'false')" 2>/dev/null)
CONV_ENQ_LINK=$(echo "$CONV_CHECK" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('rows',[]); print(r[0].get('enquiry_id','') if r else '')" 2>/dev/null)

check "$CONV_EXISTS" "Conversation in DB: $CONV_ID"
check "$([ "$CONV_ENQ_LINK" = "$ENQUIRY_ID" ] && echo true || echo false)" "Conversation linked to enquiry"

# Check appointment request exists
if [ -n "$REQUEST_ID" ]; then
  APPT_CHECK=$(dbquery "SELECT id, status, chosen_slot, notes FROM appointment_requests WHERE id = '$REQUEST_ID'")
  APPT_EXISTS=$(echo "$APPT_CHECK" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if len(d.get('rows',[])) > 0 else 'false')" 2>/dev/null)
  APPT_STATUS=$(echo "$APPT_CHECK" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('rows',[]); print(r[0].get('status','') if r else '')" 2>/dev/null)
  APPT_NOTES=$(echo "$APPT_CHECK" | python3 -c "import json,sys; d=json.load(sys.stdin); r=d.get('rows',[]); print(r[0].get('notes','') if r else '')" 2>/dev/null)

  check "$APPT_EXISTS" "Appointment request in DB: $REQUEST_ID"
  check "$([ -n "$APPT_STATUS" ] && echo true || echo false)" "Booking status: $APPT_STATUS"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST 7: No human handoff language in any response
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${YELLOW}TEST 7: No human handoff language${NC}"

ALL_RESPONSES="$LOOKUP $AVAIL $UNKNOWN $BOOK"
NO_TRANSFER=$(echo "$ALL_RESPONSES" | grep -qi 'transfer to\|speak to.*team\|call the clinic\|put you through\|reception team' && echo false || echo true)
NO_TRY_AGAIN=$(echo "$ALL_RESPONSES" | grep -qi 'try again later' && echo false || echo true)

check "$NO_TRANSFER" "No 'transfer/speak to team/reception' in any response"
check "$NO_TRY_AGAIN" "No 'try again later' in any response"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CLEANUP
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${YELLOW}CLEANUP: Removing test data${NC}"

if [ -n "$REQUEST_ID" ]; then
  # Delete test appointment (from appointments table too)
  npx supabase db query --linked "DELETE FROM appointments WHERE source = 'phone' AND notes LIKE '%E2E test%'" > /dev/null 2>&1
  npx supabase db query --linked "DELETE FROM appointment_requests WHERE id = '$REQUEST_ID'" > /dev/null 2>&1
  echo -e "  ${CYAN}Deleted test appointment request${NC}"
fi
if [ -n "$CONV_ID" ]; then
  npx supabase db query --linked "DELETE FROM conversations WHERE id = '$CONV_ID'" > /dev/null 2>&1
  echo -e "  ${CYAN}Deleted test conversation${NC}"
fi
if [ -n "$ENQUIRY_ID" ]; then
  npx supabase db query --linked "DELETE FROM enquiries WHERE id = '$ENQUIRY_ID'" > /dev/null 2>&1
  echo -e "  ${CYAN}Deleted test enquiry${NC}"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SUMMARY
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
TOTAL=$((PASS+FAIL))
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}  ALL $TOTAL TESTS PASSED${NC}"
else
  echo -e "${RED}  $FAIL FAILED${NC} / ${GREEN}$PASS PASSED${NC} / $TOTAL TOTAL"
fi
echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
echo ""
