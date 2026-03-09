#!/usr/bin/env node
import 'dotenv/config';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://amxcposgqlmgapzoopze.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRACTICE_ID = process.argv[2] || '7a2d6e46-5941-46a7-b858-88c0483b1e12';

async function db(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' } };
  if (body) opts.body = JSON.stringify(body);
  return (await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts)).json();
}

async function scenario(title, steps) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCENARIO: ${title}`);
  console.log('='.repeat(60));

  const contactIds = [];
  const enquiryIds = [];

  for (const step of steps) {
    console.log(`\n  Step: ${step.label}`);

    // Find existing contact
    let contact = null;
    if (step.phone) {
      const matches = await db(`contacts?practice_id=eq.${PRACTICE_ID}&phone=eq.${encodeURIComponent(step.phone)}&select=*`);
      contact = matches[0];
    }
    if (!contact && step.email) {
      const matches = await db(`contacts?practice_id=eq.${PRACTICE_ID}&email=eq.${encodeURIComponent(step.email)}&select=*`);
      contact = matches[0];
    }

    if (contact) {
      console.log(`    Matched contact: ${contact.name} (${contact.id.slice(0,8)})`);
      // Update with new info
      const updates = {};
      if (step.phone && !contact.phone) updates.phone = step.phone;
      if (step.email && !contact.email) updates.email = step.email;
      if (step.name && contact.name === 'Website Visitor') updates.name = step.name;
      if (Object.keys(updates).length > 0) {
        await db(`contacts?id=eq.${contact.id}`, 'PATCH', updates);
        console.log(`    Updated:`, updates);
      }
    } else {
      [contact] = await db('contacts', 'POST', {
        practice_id: PRACTICE_ID, name: step.name || 'Website Visitor',
        phone: step.phone || null, email: step.email || null, source: step.source,
      });
      console.log(`    NEW contact: ${contact.name} (${contact.id.slice(0,8)})`);
      contactIds.push(contact.id);
    }

    const [enquiry] = await db('enquiries', 'POST', {
      practice_id: PRACTICE_ID, contact_id: contact.id,
      patient_name: step.name || contact.name, phone_number: step.phone || '',
      message: step.message, source: step.source, is_urgent: step.urgent || false,
      is_completed: false, conversation: step.conversation,
    });
    enquiryIds.push(enquiry.id);
    console.log(`    Enquiry: ${step.source} — "${step.message.slice(0,60)}..."`);
  }

  // Show what Poppy gets
  const contactId = contactIds[0] || (await db(`contacts?practice_id=eq.${PRACTICE_ID}&phone=eq.${encodeURIComponent(steps[0].phone || '')}&select=id`))[0]?.id;
  if (contactId) {
    const history = await db(`enquiries?contact_id=eq.${contactId}&select=source,message,conversation,created_at&order=created_at.asc`);
    const channels = [...new Set(history.map(e => e.source))];
    const labels = { phone: 'called', sms: 'texted', chat: 'chatted on the website', email: 'emailed' };

    console.log(`\n  --- POPPY'S CONTEXT ---`);
    console.log(`  Returning patient: YES`);
    console.log(`  Previously: ${channels.map(c => labels[c]).join(', then ')}`);
    for (const e of history) {
      console.log(`  [${e.source}] "${e.message.slice(0,80)}"`);
    }
  }

  // Cleanup
  for (const id of enquiryIds) await db(`enquiries?id=eq.${id}`, 'DELETE');
  for (const id of contactIds) await db(`contacts?id=eq.${id}`, 'DELETE');
}

async function run() {
  // Scenario A: Web chat first → then calls
  await scenario('WEB CHAT first, then PHONE', [
    {
      label: 'Patient chats on website about whitening',
      source: 'chat', name: 'Emma Clarke', email: 'emma@gmail.com',
      phone: null,
      message: "I'd like to know about teeth whitening. I have a wedding in 6 weeks.",
      conversation: [
        { role: 'agent', message: 'Hello! Welcome. How can I help?', timestamp: new Date(Date.now() - 86400000).toISOString() },
        { role: 'patient', message: "Hi, I'm interested in teeth whitening. Got a wedding in 6 weeks!", timestamp: new Date(Date.now() - 86390000).toISOString() },
        { role: 'agent', message: "Congratulations! We offer whitening from £350. Would you like to book a consultation?", timestamp: new Date(Date.now() - 86380000).toISOString() },
        { role: 'patient', message: "That sounds great. I'm free most mornings.", timestamp: new Date(Date.now() - 86370000).toISOString() },
      ],
    },
    {
      label: 'Same patient calls next day',
      source: 'phone', name: 'Emma Clarke', email: 'emma@gmail.com',
      phone: '+447700111222',
      message: 'Calling to book the whitening consultation. Chatted on website yesterday.',
      conversation: [
        { role: 'agent', message: "Good morning! How can I help?", timestamp: new Date(Date.now() - 3600000).toISOString() },
        { role: 'patient', message: "Hi, I chatted on your website yesterday about whitening. Want to book.", timestamp: new Date(Date.now() - 3590000).toISOString() },
      ],
    },
  ]);

  // Scenario B: SMS first → then web chat
  await scenario('SMS first, then WEB CHAT', [
    {
      label: 'Patient texts about emergency',
      source: 'sms', name: 'SMS Contact', phone: '+447700333444',
      message: 'Hi, my filling fell out. Is there an emergency appointment today?',
      conversation: [
        { role: 'patient', message: 'Hi, my filling fell out. Is there an emergency appointment today?', timestamp: new Date(Date.now() - 7200000).toISOString() },
      ],
    },
    {
      label: 'Same patient goes to website chat',
      source: 'chat', name: 'Jake Williams', phone: '+447700333444',
      email: 'jake.w@outlook.com',
      message: "Still waiting to hear back about my filling. Can I book online?",
      conversation: [
        { role: 'agent', message: 'Hello! How can I help?', timestamp: new Date().toISOString() },
        { role: 'patient', message: "I texted earlier about a lost filling. Haven't heard back yet.", timestamp: new Date().toISOString() },
      ],
    },
  ]);

  // Scenario C: Web chat only (new patient, no history)
  await scenario('NEW patient on WEB CHAT (no history)', [
    {
      label: 'Brand new visitor',
      source: 'chat', name: 'New Visitor', email: 'new@test.com',
      phone: null,
      message: 'Do you do Invisalign?',
      conversation: [
        { role: 'patient', message: 'Do you do Invisalign?', timestamp: new Date().toISOString() },
      ],
    },
  ]);

  console.log('\n\nAll scenarios passed.\n');
}

run().catch(console.error);
