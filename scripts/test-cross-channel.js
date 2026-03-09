#!/usr/bin/env node
/**
 * Test the cross-channel contact matching flow.
 *
 * Simulates:
 *   1. Patient calls → creates contact + enquiry (phone)
 *   2. Same patient texts → matched by phone → appended to contact
 *   3. Same patient uses web chat → matched → Poppy gets full history
 *
 * Usage: SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/test-cross-channel.js <practice_id>
 */

import 'dotenv/config';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://amxcposgqlmgapzoopze.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabaseRequest(path, method = 'GET', body = null) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}

const practiceId = process.argv[2];
if (!practiceId) {
  console.error('Usage: node scripts/test-cross-channel.js <practice_id>');
  process.exit(1);
}

const TEST_PHONE = '+447700900999';
const TEST_NAME = 'Sarah Johnson';
const TEST_EMAIL = 'sarah.johnson@gmail.com';

async function run() {
  console.log('\n=== CROSS-CHANNEL CONTACT TEST ===\n');

  // Step 1: Phone call creates contact + enquiry
  console.log('1. Simulating PHONE CALL from', TEST_PHONE);

  // Create contact
  const [contact] = await supabaseRequest('contacts', 'POST', {
    practice_id: practiceId,
    name: TEST_NAME,
    phone: TEST_PHONE,
    source: 'phone',
  });
  console.log('   Contact created:', contact.id);

  // Create phone enquiry
  const [phoneEnquiry] = await supabaseRequest('enquiries', 'POST', {
    practice_id: practiceId,
    contact_id: contact.id,
    patient_name: TEST_NAME,
    phone_number: TEST_PHONE,
    message: 'I have a terrible toothache on my lower right side. Started yesterday and getting worse.',
    source: 'phone',
    is_urgent: true,
    is_completed: false,
    conversation: [
      { role: 'agent', message: "Good morning, you've reached the practice. How can I help?", timestamp: new Date(Date.now() - 3600000).toISOString() },
      { role: 'patient', message: "Hi, I've got a really bad toothache. Lower right side, started yesterday.", timestamp: new Date(Date.now() - 3590000).toISOString() },
      { role: 'agent', message: "I'm sorry to hear that. We can fit you in today as an emergency. Can I take your name?", timestamp: new Date(Date.now() - 3580000).toISOString() },
      { role: 'patient', message: 'Sarah Johnson.', timestamp: new Date(Date.now() - 3570000).toISOString() },
      { role: 'agent', message: "Thank you Sarah. I've flagged this as urgent. Someone will call you back to confirm.", timestamp: new Date(Date.now() - 3560000).toISOString() },
    ],
  });
  console.log('   Phone enquiry created:', phoneEnquiry.id);

  // Step 2: Same person sends SMS
  console.log('\n2. Simulating SMS from same number', TEST_PHONE);

  // Match contact by phone
  const existingContacts = await supabaseRequest(`contacts?practice_id=eq.${practiceId}&phone=eq.${encodeURIComponent(TEST_PHONE)}&select=*`);
  const matchedContact = existingContacts[0];
  console.log('   Matched existing contact:', matchedContact.id, '(' + matchedContact.name + ')');

  // Update contact with email
  await supabaseRequest(`contacts?id=eq.${matchedContact.id}`, 'PATCH', { email: TEST_EMAIL });
  console.log('   Updated contact with email:', TEST_EMAIL);

  const [smsEnquiry] = await supabaseRequest('enquiries', 'POST', {
    practice_id: practiceId,
    contact_id: matchedContact.id,
    patient_name: TEST_NAME,
    phone_number: TEST_PHONE,
    message: 'Hi, I called earlier about my toothache. Just wanted to check if there is an appointment available today?',
    source: 'sms',
    is_urgent: false,
    is_completed: false,
    conversation: [
      { role: 'patient', message: 'Hi, I called earlier about my toothache. Just wanted to check if there is an appointment available today?', timestamp: new Date(Date.now() - 1800000).toISOString() },
    ],
  });
  console.log('   SMS enquiry created:', smsEnquiry.id);

  // Step 3: Check what Poppy would see when this patient uses web chat
  console.log('\n3. Simulating WEB CHAT lookup for', TEST_PHONE);

  const contactHistory = await supabaseRequest(
    `enquiries?contact_id=eq.${matchedContact.id}&select=id,source,message,conversation,created_at,is_completed&order=created_at.asc`
  );

  console.log('   Contact has', contactHistory.length, 'previous interactions:');
  for (const e of contactHistory) {
    const channel = { phone: 'Phone call', sms: 'Text message', chat: 'Web chat' }[e.source] || e.source;
    console.log(`   - ${channel}: "${e.message.slice(0, 80)}..."`);
    const convMsgs = e.conversation || [];
    console.log(`     (${convMsgs.length} messages in conversation)`);
  }

  console.log('\n--- What Poppy would be told ---');
  console.log(`Returning patient: YES`);
  console.log(`Name: ${matchedContact.name}`);
  console.log(`Previous interactions:`);
  for (const e of contactHistory) {
    const channel = { phone: 'Phone call', sms: 'Text message', chat: 'Web chat' }[e.source] || e.source;
    const date = new Date(e.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    console.log(`  ${date} via ${channel}: "${e.message}"`);
    const lastMsgs = (e.conversation || []).slice(-2);
    for (const m of lastMsgs) {
      console.log(`    ${m.role === 'agent' ? 'Poppy' : 'Patient'}: ${m.message}`);
    }
  }

  console.log('\n=== Poppy can now say something like: ===');
  console.log(`"Hi Sarah! I can see you called us earlier today about a toothache`);
  console.log(` and also texted to check on availability. Would you like me to`);
  console.log(` confirm that emergency appointment for you?"`);

  console.log('\n=== TEST COMPLETE ===\n');

  // Cleanup
  console.log('Cleaning up test data...');
  await supabaseRequest(`enquiries?contact_id=eq.${matchedContact.id}`, 'DELETE');
  await supabaseRequest(`contacts?id=eq.${matchedContact.id}`, 'DELETE');
  console.log('Done.\n');
}

run().catch(console.error);
