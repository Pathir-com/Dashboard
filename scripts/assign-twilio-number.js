#!/usr/bin/env node
/**
 * Assign a Twilio phone number to a practice based on its location.
 *
 * Usage:
 *   node scripts/assign-twilio-number.js <practice_id>
 *   node scripts/assign-twilio-number.js --release <practice_id>
 *
 * Requires env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config';

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || 'ACab534af8deffb17eba0d530ac601ea39';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'c4ee7e386ab9c61cc2ab18e23493210e';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://amxcposgqlmgapzoopze.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// VAPI webhook URL — calls route here
const VAPI_WEBHOOK_URL = 'https://api.vapi.ai/twilio/inbound_call';

const twilioAuth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');

// UK area code mapping — city/region keywords to Twilio search params
const UK_AREA_CODES = [
  { keywords: ['london', 'harley street', 'mayfair', 'chelsea', 'kensington', 'westminster', 'soho', 'islington', 'camden', 'hackney', 'sw1', 'w1', 'ec1', 'wc1', 'se1', 'e1', 'n1', 'nw1'], areaCode: '020', region: 'London' },
  { keywords: ['manchester', 'salford', 'stockport', 'oldham', 'bolton', 'bury', 'rochdale', 'm1', 'm2', 'm3'], areaCode: '0161', region: 'Manchester' },
  { keywords: ['birmingham', 'solihull', 'edgbaston', 'b1', 'b2', 'b3'], areaCode: '0121', region: 'Birmingham' },
  { keywords: ['liverpool', 'merseyside', 'wirral', 'l1', 'l2'], areaCode: '0151', region: 'Liverpool' },
  { keywords: ['leeds', 'wakefield', 'ls1', 'ls2'], areaCode: '0113', region: 'Leeds' },
  { keywords: ['sheffield', 's1', 's2'], areaCode: '0114', region: 'Sheffield' },
  { keywords: ['bristol', 'bs1', 'bs2'], areaCode: '0117', region: 'Bristol' },
  { keywords: ['edinburgh', 'eh1', 'eh2'], areaCode: '0131', region: 'Edinburgh' },
  { keywords: ['glasgow', 'g1', 'g2'], areaCode: '0141', region: 'Glasgow' },
  { keywords: ['belfast', 'antrim', 'bt1', 'bt2', 'bt15'], areaCode: '028', region: 'Belfast' },
  { keywords: ['cardiff', 'cf1', 'cf2'], areaCode: '029', region: 'Cardiff' },
  { keywords: ['nottingham', 'ng1', 'ng2'], areaCode: '0115', region: 'Nottingham' },
  { keywords: ['newcastle', 'gateshead', 'ne1', 'ne2'], areaCode: '0191', region: 'Newcastle' },
  { keywords: ['leicester', 'le1', 'le2'], areaCode: '0116', region: 'Leicester' },
  { keywords: ['coventry', 'cv1', 'cv2'], areaCode: '024', region: 'Coventry' },
  { keywords: ['brighton', 'hove', 'bn1', 'bn2'], areaCode: '01273', region: 'Brighton' },
  { keywords: ['cambridge', 'cb1', 'cb2'], areaCode: '01223', region: 'Cambridge' },
  { keywords: ['oxford', 'ox1', 'ox2'], areaCode: '01865', region: 'Oxford' },
  { keywords: ['bath', 'ba1', 'ba2'], areaCode: '01225', region: 'Bath' },
  { keywords: ['exeter', 'ex1', 'ex2'], areaCode: '01392', region: 'Exeter' },
  { keywords: ['york', 'yo1', 'yo2'], areaCode: '01904', region: 'York' },
  { keywords: ['reading', 'rg1', 'rg2'], areaCode: '0118', region: 'Reading' },
  { keywords: ['southampton', 'so1', 'so2'], areaCode: '023', region: 'Southampton' },
  { keywords: ['portsmouth'], areaCode: '023', region: 'Portsmouth' },
  { keywords: ['aberdeen', 'ab1'], areaCode: '01224', region: 'Aberdeen' },
  { keywords: ['dundee', 'dd1'], areaCode: '01382', region: 'Dundee' },
  { keywords: ['swansea', 'sa1'], areaCode: '01792', region: 'Swansea' },
];

function detectAreaCode(address) {
  if (!address) return null;
  const lower = address.toLowerCase();

  for (const entry of UK_AREA_CODES) {
    for (const keyword of entry.keywords) {
      if (lower.includes(keyword)) {
        return entry;
      }
    }
  }
  return null;
}

async function twilioGet(path) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}${path}`, {
    headers: { 'Authorization': `Basic ${twilioAuth}` },
  });
  return res.json();
}

async function twilioPost(path, body) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${twilioAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
  return res.json();
}

async function supabaseQuery(table, method, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);

  if (params.filter) {
    for (const [key, value] of Object.entries(params.filter)) {
      url.searchParams.set(key, `eq.${value}`);
    }
  }
  if (params.select) {
    url.searchParams.set('select', params.select);
  }

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'PATCH' ? 'return=representation' : 'return=representation',
  };

  const opts = { method, headers };
  if (params.body) opts.body = JSON.stringify(params.body);

  const res = await fetch(url.toString(), opts);
  return res.json();
}

async function searchAvailableNumbers(areaCode) {
  // Convert UK area code to E.164 format for Twilio search
  // UK area codes: 020 → +4420, 0161 → +44161, 028 → +4428
  const e164Prefix = '+44' + areaCode.replace(/^0/, '');

  const data = await twilioGet(
    `/AvailablePhoneNumbers/GB/Local.json?Contains=${encodeURIComponent(e164Prefix)}&PageSize=5&VoiceEnabled=true&SmsEnabled=true`
  );

  return data.available_phone_numbers || [];
}

async function searchFallbackNumbers() {
  // If no local match, get any UK number
  const data = await twilioGet(
    `/AvailablePhoneNumbers/GB/Local.json?PageSize=5&VoiceEnabled=true&SmsEnabled=true`
  );
  return data.available_phone_numbers || [];
}

async function buyNumber(phoneNumber) {
  const data = await twilioPost('/IncomingPhoneNumbers.json', {
    PhoneNumber: phoneNumber,
    VoiceUrl: VAPI_WEBHOOK_URL,
    VoiceMethod: 'POST',
    FriendlyName: `Pathir Auto-Assigned`,
  });

  if (data.sid) {
    console.log(`  Purchased: ${data.phone_number} (SID: ${data.sid})`);
    return data;
  } else {
    throw new Error(data.message || 'Failed to purchase number');
  }
}

async function releaseNumber(phoneNumber) {
  // Find the SID for this number
  const data = await twilioGet(
    `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`
  );

  const numbers = data.incoming_phone_numbers || [];
  if (numbers.length === 0) {
    console.log(`  Number ${phoneNumber} not found in Twilio account`);
    return;
  }

  const sid = numbers[0].sid;

  // Don't actually delete from Twilio — just unassign from practice
  // This keeps the number in our pool for future use
  console.log(`  Unassigning ${phoneNumber} (SID: ${sid}) — number kept in Twilio pool`);
}

async function getPractice(practiceId) {
  const data = await supabaseQuery('practices', 'GET', {
    filter: { id: practiceId },
    select: '*',
  });
  return Array.isArray(data) ? data[0] : null;
}

async function updatePractice(practiceId, updates) {
  const url = `${SUPABASE_URL}/rest/v1/practices?id=eq.${practiceId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(updates),
  });
  return res.json();
}

// Check if we have an unassigned number in the pool for this area
async function findPooledNumber(areaCode) {
  // Get all Twilio numbers
  const data = await twilioGet('/IncomingPhoneNumbers.json?PageSize=100');
  const allNumbers = data.incoming_phone_numbers || [];

  // Get all assigned numbers from Supabase
  const practices = await supabaseQuery('practices', 'GET', { select: 'twilio_phone_number' });
  const assignedNumbers = new Set(
    (Array.isArray(practices) ? practices : [])
      .map(p => p.twilio_phone_number)
      .filter(Boolean)
  );

  // Find unassigned numbers matching the area code
  const e164Prefix = '+44' + areaCode.replace(/^0/, '');
  const pooled = allNumbers.filter(n =>
    !assignedNumbers.has(n.phone_number) &&
    n.phone_number.startsWith(e164Prefix)
  );

  if (pooled.length > 0) {
    return pooled[0];
  }

  // Try any unassigned number
  const anyPooled = allNumbers.filter(n => !assignedNumbers.has(n.phone_number));
  return anyPooled.length > 0 ? anyPooled[0] : null;
}

async function assignNumber(practiceId) {
  console.log(`\nAssigning number to practice: ${practiceId}`);

  // 1. Get practice details
  const practice = await getPractice(practiceId);
  if (!practice) {
    console.error('  Practice not found');
    process.exit(1);
  }

  if (practice.twilio_phone_number) {
    console.log(`  Already has number: ${practice.twilio_phone_number}`);
    return practice.twilio_phone_number;
  }

  console.log(`  Practice: ${practice.name}`);
  console.log(`  Address: ${practice.address || '(none)'}`);

  // 2. Detect area code from address
  const match = detectAreaCode(practice.address);
  if (match) {
    console.log(`  Detected region: ${match.region} (area code ${match.areaCode})`);
  } else {
    console.log('  No area code match — will use any available UK number');
  }

  // 3. Check pool first (reuse unassigned numbers)
  let number = null;
  if (match) {
    console.log(`  Checking pool for ${match.region} numbers...`);
    const pooled = await findPooledNumber(match.areaCode);
    if (pooled) {
      console.log(`  Found pooled number: ${pooled.phone_number}`);
      number = pooled.phone_number;

      // Update webhook URL in case it was changed
      await twilioPost(`/IncomingPhoneNumbers/${pooled.sid}.json`, {
        VoiceUrl: VAPI_WEBHOOK_URL,
        VoiceMethod: 'POST',
        FriendlyName: `Pathir - ${practice.name}`,
      });
    }
  }

  // 4. If no pooled number, search and buy
  if (!number) {
    let available = [];

    if (match) {
      console.log(`  Searching Twilio for ${match.region} numbers...`);
      available = await searchAvailableNumbers(match.areaCode);
    }

    if (available.length === 0) {
      console.log('  No local numbers available, searching any UK number...');
      available = await searchFallbackNumbers();
    }

    if (available.length === 0) {
      console.error('  No UK numbers available on Twilio!');
      process.exit(1);
    }

    console.log(`  Found ${available.length} available numbers`);
    const purchased = await buyNumber(available[0].phone_number);
    number = purchased.phone_number;

    // Set friendly name
    await twilioPost(`/IncomingPhoneNumbers/${purchased.sid}.json`, {
      FriendlyName: `Pathir - ${practice.name}`,
    });
  }

  // 5. Save to database
  console.log(`  Saving ${number} to practice...`);
  await updatePractice(practiceId, { twilio_phone_number: number });

  console.log(`  Done! ${practice.name} → ${number}`);
  return number;
}

async function unassignNumber(practiceId) {
  console.log(`\nReleasing number from practice: ${practiceId}`);

  const practice = await getPractice(practiceId);
  if (!practice) {
    console.error('  Practice not found');
    process.exit(1);
  }

  if (!practice.twilio_phone_number) {
    console.log('  No number assigned');
    return;
  }

  console.log(`  Current number: ${practice.twilio_phone_number}`);

  // Don't delete from Twilio — just unassign from practice
  await releaseNumber(practice.twilio_phone_number);
  await updatePractice(practiceId, { twilio_phone_number: '' });

  console.log(`  Number ${practice.twilio_phone_number} unassigned (kept in pool for reuse)`);
}

// CLI
const args = process.argv.slice(2);
if (args.includes('--release')) {
  const id = args.find(a => a !== '--release');
  if (!id) { console.error('Usage: node assign-twilio-number.js --release <practice_id>'); process.exit(1); }
  unassignNumber(id);
} else if (args[0]) {
  assignNumber(args[0]);
} else {
  console.error('Usage: node assign-twilio-number.js <practice_id>');
  console.error('       node assign-twilio-number.js --release <practice_id>');
  process.exit(1);
}
