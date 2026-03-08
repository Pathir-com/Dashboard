/**
 * Local data store replacing @base44/sdk.
 * Uses localStorage for persistence, exposes the same API surface
 * that the rest of the app expects.
 */

const STORAGE_KEY = 'pathir_live_v3';

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function getStore() {
  let store = loadStore();
  if (!store) {
    // Clear any stale base44 keys
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('base44_') || k === 'pathir_data') localStorage.removeItem(k);
    });
    store = seed();
    saveStore(store);
  }
  return store;
}

function generateId() {
  return Math.random().toString(36).slice(2, 11);
}

// --------------- Seed data ---------------

function seed() {
  const now = new Date().toISOString();
  const today = new Date();

  const practices = [
    {
      id: 'prac_1',
      name: 'Parkview Dental',
      password: 'demo123',
      chatbase_agent_id: 'cb_agent_abc123',
      elevenlabs_agent_id: 'el_agent_xyz789',
      address: '42 High Street, London SW1A 1AA',
      phone: '+44 20 7946 0958',
      email: 'reception@parkviewdental.co.uk',
      website: 'https://parkviewdental.co.uk',
      practice_type: 'Private',
      opening_hours: [
        { day: 'Monday', is_open: true, open_time: '08:00', close_time: '18:00' },
        { day: 'Tuesday', is_open: true, open_time: '08:00', close_time: '18:00' },
        { day: 'Wednesday', is_open: true, open_time: '08:00', close_time: '18:00' },
        { day: 'Thursday', is_open: true, open_time: '08:00', close_time: '20:00' },
        { day: 'Friday', is_open: true, open_time: '08:00', close_time: '17:00' },
        { day: 'Saturday', is_open: true, open_time: '09:00', close_time: '13:00' },
        { day: 'Sunday', is_open: false, open_time: '09:00', close_time: '17:30' },
      ],
      holiday_hours: [],
      integrations: {
        phone_enabled: true,
        sms_enabled: true,
        web_chat_enabled: true,
        facebook_enabled: false,
        instagram_enabled: false,
        email_enabled: true,
      },
      pear_dental: { api_key: '', practice_code: '', connected: false },
      practitioners: [
        { id: 'dr1', title: 'Dr', name: 'Sarah Mitchell', credentials: 'GDC 123456 \u00b7 BDS, MJDF', bio: 'Dr Mitchell has 15 years of experience and specialises in cosmetic dentistry and nervous patients.', services: ['General Checkup', 'Teeth Whitening', 'Veneers', 'Invisalign'] },
        { id: 'dr2', title: 'Dr', name: 'James Okafor', credentials: 'GDC 789012 \u00b7 BDS, MSc', bio: 'Dr Okafor is our implant specialist with advanced training from the Royal College of Surgeons.', services: ['Dental Implants', 'Root Canal', 'Crowns & Bridges', 'Oral Surgery'] },
        { id: 'hyg1', title: 'Ms', name: 'Emily Chen', credentials: 'GDC 345678 \u00b7 DipDH', bio: 'Emily is a senior dental hygienist focused on preventive care and periodontal health.', services: ['Teeth Cleaning', 'Periodontal Treatment', 'Fluoride Treatment'] },
      ],
      price_list: [
        { id: 'p1', category: 'Preventive', service_name: 'New Patient Examination', price: 65, notes: 'Includes X-rays' },
        { id: 'p2', category: 'Preventive', service_name: 'Hygiene Clean', price: 85, notes: '30 min with hygienist' },
        { id: 'p3', category: 'Restorative', service_name: 'White Filling (small)', price: 150, notes: '' },
        { id: 'p4', category: 'Restorative', service_name: 'Crown (porcelain)', price: 750, notes: '2 visits required' },
        { id: 'p5', category: 'Cosmetic', service_name: 'Teeth Whitening', price: 350, notes: 'Home kit included' },
        { id: 'p6', category: 'Cosmetic', service_name: 'Porcelain Veneer (per tooth)', price: 850, notes: '' },
        { id: 'p7', category: 'Implants', service_name: 'Single Implant', price: 2500, notes: 'Consultation + CT scan included' },
        { id: 'p8', category: 'Orthodontics', service_name: 'Invisalign (full)', price: 4500, notes: '12-18 months treatment' },
        { id: 'p9', category: 'Endodontics', service_name: 'Root Canal (molar)', price: 650, notes: '' },
        { id: 'p10', category: 'Preventive', service_name: 'Emergency Appointment', price: 95, notes: 'Same-day availability' },
      ],
      usps: '\u2022 Award-winning cosmetic dentist with 15 years experience\n\u2022 Same-day emergency appointments available\n\u2022 Interest-free payment plans up to 12 months\n\u2022 Specialist in nervous and anxious patients\n\u2022 State-of-the-art 3D scanner and digital X-rays',
      practice_plan: {
        offered: true,
        terms: '\u00a315.95/month includes:\n\u2022 2 check-ups per year\n\u2022 2 hygiene visits per year\n\u2022 10% off all treatments\n\u2022 No joining fee\n\u2022 Worldwide dental trauma cover',
      },
      finance_document_url: '',
      created_date: now,
    },
    {
      id: 'prac_2',
      name: 'Bright Smile Clinic',
      password: 'bright2025',
      chatbase_agent_id: '',
      elevenlabs_agent_id: 'el_agent_bsc456',
      address: '15 Queen Street, Manchester M2 5HT',
      phone: '+44 161 234 5678',
      email: 'hello@brightsmile.co.uk',
      website: 'https://brightsmile.co.uk',
      practice_type: 'Mixed',
      opening_hours: [
        { day: 'Monday', is_open: true, open_time: '09:00', close_time: '17:30' },
        { day: 'Tuesday', is_open: true, open_time: '09:00', close_time: '17:30' },
        { day: 'Wednesday', is_open: true, open_time: '09:00', close_time: '17:30' },
        { day: 'Thursday', is_open: true, open_time: '09:00', close_time: '19:00' },
        { day: 'Friday', is_open: true, open_time: '09:00', close_time: '17:00' },
        { day: 'Saturday', is_open: false, open_time: '09:00', close_time: '17:30' },
        { day: 'Sunday', is_open: false, open_time: '09:00', close_time: '17:30' },
      ],
      holiday_hours: [],
      integrations: { phone_enabled: true, sms_enabled: false, web_chat_enabled: true },
      pear_dental: { api_key: '', practice_code: '', connected: false },
      practitioners: [
        { id: 'dr3', title: 'Dr', name: 'Amina Patel', credentials: 'GDC 456789', services: ['General Checkup', 'Fillings'] },
      ],
      price_list: [],
      usps: '',
      practice_plan: { offered: false, terms: '' },
      finance_document_url: '',
      created_date: now,
    },
    {
      id: 'prac_3',
      name: 'Antrim House Dental',
      password: '',
      chatbase_agent_id: 'chatbase_city_345',
      elevenlabs_agent_id: 'eleven_city_678',
      address: '8 Antrim Road, Belfast BT15 2AA',
      phone: '+44 28 9024 1234',
      email: 'info@antrimhousedental.co.uk',
      website: 'https://antrimhousedental.co.uk',
      practice_type: 'Private',
      opening_hours: [
        { day: 'Monday', is_open: true, open_time: '08:30', close_time: '17:30' },
        { day: 'Tuesday', is_open: true, open_time: '08:30', close_time: '17:30' },
        { day: 'Wednesday', is_open: true, open_time: '08:30', close_time: '17:30' },
        { day: 'Thursday', is_open: true, open_time: '08:30', close_time: '19:00' },
        { day: 'Friday', is_open: true, open_time: '08:30', close_time: '16:00' },
        { day: 'Saturday', is_open: true, open_time: '09:00', close_time: '13:00' },
        { day: 'Sunday', is_open: false, open_time: '09:00', close_time: '17:30' },
      ],
      holiday_hours: [],
      integrations: { phone_enabled: true, sms_enabled: true, web_chat_enabled: true, facebook_enabled: false, instagram_enabled: false, email_enabled: true },
      pear_dental: { api_key: '', practice_code: '', connected: false },
      practitioners: [
        { id: 'dr4', title: 'Dr', name: 'Fiona McAllister', credentials: 'GDC 234567 \u00b7 BDS', bio: 'Dr McAllister is the principal dentist with over 20 years experience in general and restorative dentistry.', services: ['General Checkup', 'Fillings', 'Crowns & Bridges', 'Root Canal'] },
        { id: 'dr5', title: 'Dr', name: 'Rory Campbell', credentials: 'GDC 345678 \u00b7 BDS, MSc Endo', bio: 'Dr Campbell specialises in endodontics and complex restorative cases.', services: ['Root Canal', 'Dental Implants', 'Emergency Care'] },
      ],
      price_list: [
        { id: 'a1', category: 'Preventive', service_name: 'New Patient Exam', price: 55, notes: 'Includes X-rays' },
        { id: 'a2', category: 'Preventive', service_name: 'Hygiene Visit', price: 75, notes: '' },
        { id: 'a3', category: 'Restorative', service_name: 'White Filling', price: 130, notes: '' },
        { id: 'a4', category: 'Cosmetic', service_name: 'Teeth Whitening', price: 295, notes: 'Boutique kit' },
      ],
      usps: '\u2022 Family-friendly practice with over 20 years in the community\n\u2022 Late Thursday appointments until 7pm\n\u2022 Saturday morning clinic\n\u2022 Nervous patient specialists',
      practice_plan: { offered: true, terms: '\u00a312.50/month includes 2 check-ups, 2 hygiene visits, 10% off treatments' },
      finance_document_url: '',
      created_date: now,
    },
    {
      id: 'prac_4',
      name: 'Sparkling Dental Clinic',
      password: '',
      chatbase_agent_id: 'chatbase_smile_789',
      elevenlabs_agent_id: 'eleven_smile_012',
      address: '22 Deansgate, Manchester M3 1RH',
      phone: '+44 161 456 7890',
      email: 'smile@sparklingdental.co.uk',
      website: 'https://sparklingdental.co.uk',
      practice_type: 'Private',
      opening_hours: [
        { day: 'Monday', is_open: true, open_time: '09:00', close_time: '18:00' },
        { day: 'Tuesday', is_open: true, open_time: '09:00', close_time: '18:00' },
        { day: 'Wednesday', is_open: true, open_time: '09:00', close_time: '18:00' },
        { day: 'Thursday', is_open: true, open_time: '09:00', close_time: '20:00' },
        { day: 'Friday', is_open: true, open_time: '09:00', close_time: '17:00' },
        { day: 'Saturday', is_open: false, open_time: '09:00', close_time: '17:30' },
        { day: 'Sunday', is_open: false, open_time: '09:00', close_time: '17:30' },
      ],
      holiday_hours: [],
      integrations: { phone_enabled: true, sms_enabled: true, web_chat_enabled: true, facebook_enabled: false, instagram_enabled: false, email_enabled: false },
      pear_dental: { api_key: '', practice_code: '', connected: false },
      practitioners: [
        { id: 'dr6', title: 'Dr', name: 'Yusuf Hassan', credentials: 'GDC 567890 \u00b7 BDS, MFDS', bio: 'Dr Hassan focuses on cosmetic and aesthetic dentistry including veneers and smile makeovers.', services: ['Teeth Whitening', 'Veneers', 'Invisalign', 'General Checkup'] },
      ],
      price_list: [
        { id: 's1', category: 'Preventive', service_name: 'Exam & Clean', price: 95, notes: 'Combined appointment' },
        { id: 's2', category: 'Cosmetic', service_name: 'Zoom Whitening', price: 450, notes: 'In-chair + home kit' },
        { id: 's3', category: 'Cosmetic', service_name: 'Composite Bonding (per tooth)', price: 350, notes: '' },
      ],
      usps: '\u2022 Cosmetic dentistry specialists\n\u2022 Zoom whitening available\n\u2022 City centre location with late Thursday opening',
      practice_plan: { offered: false, terms: '' },
      finance_document_url: '',
      created_date: now,
    },
    {
      id: 'prac_5',
      name: 'Designer Smiles',
      password: '',
      chatbase_agent_id: 'sample_chatbase_123',
      elevenlabs_agent_id: 'sample_elevenlabs_456',
      address: '5 Harley Street, London W1G 9QQ',
      phone: '+44 20 7123 4567',
      email: 'hello@designersmiles.co.uk',
      website: 'https://designersmiles.co.uk',
      practice_type: 'Private',
      opening_hours: [
        { day: 'Monday', is_open: true, open_time: '08:00', close_time: '18:00' },
        { day: 'Tuesday', is_open: true, open_time: '08:00', close_time: '18:00' },
        { day: 'Wednesday', is_open: true, open_time: '08:00', close_time: '18:00' },
        { day: 'Thursday', is_open: true, open_time: '08:00', close_time: '18:00' },
        { day: 'Friday', is_open: true, open_time: '08:00', close_time: '17:00' },
        { day: 'Saturday', is_open: true, open_time: '10:00', close_time: '14:00' },
        { day: 'Sunday', is_open: false, open_time: '09:00', close_time: '17:30' },
      ],
      holiday_hours: [],
      integrations: { phone_enabled: true, sms_enabled: true, web_chat_enabled: true, facebook_enabled: true, instagram_enabled: true, email_enabled: true },
      pear_dental: { api_key: '', practice_code: '', connected: false },
      practitioners: [
        { id: 'dr7', title: 'Dr', name: 'Alexandra Petrov', credentials: 'GDC 678901 \u00b7 BDS, MSc Prostho', bio: 'Dr Petrov is a Harley Street prosthodontist specialising in full-mouth rehabilitations and smile design.', services: ['Veneers', 'Dental Implants', 'Crowns & Bridges', 'Smile Makeover'] },
        { id: 'dr8', title: 'Dr', name: 'Marcus Wright', credentials: 'GDC 789012 \u00b7 BDS, MSc Ortho', bio: 'Dr Wright provides Invisalign and fixed braces for adults and teenagers.', services: ['Invisalign', 'Orthodontics', 'General Checkup'] },
      ],
      price_list: [
        { id: 'd1', category: 'Preventive', service_name: 'Comprehensive Exam', price: 195, notes: 'Full assessment + digital scan' },
        { id: 'd2', category: 'Cosmetic', service_name: 'Porcelain Veneer', price: 1200, notes: 'Per tooth, E.max' },
        { id: 'd3', category: 'Cosmetic', service_name: 'Smile Makeover Consultation', price: 0, notes: 'Complimentary' },
        { id: 'd4', category: 'Implants', service_name: 'Single Implant (premium)', price: 3500, notes: 'Straumann implant' },
        { id: 'd5', category: 'Orthodontics', service_name: 'Invisalign (comprehensive)', price: 5500, notes: '' },
      ],
      usps: '\u2022 Harley Street practice with world-class facilities\n\u2022 Digital smile design technology\n\u2022 VIP patient lounge\n\u2022 All major insurance accepted\n\u2022 0% finance available up to 24 months',
      practice_plan: { offered: true, terms: '\u00a329.95/month premium plan:\n\u2022 2 check-ups per year\n\u2022 4 hygiene visits per year\n\u2022 15% off all treatments\n\u2022 Priority booking\n\u2022 Complimentary whitening top-up annually' },
      finance_document_url: '',
      created_date: now,
    },
  ];

  const daysAgo = (n, hour = 10, min = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    d.setHours(hour, min, 0, 0);
    return d.toISOString();
  };
  const daysFromNow = (n, hour = 10, min = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    d.setHours(hour, min, 0, 0);
    return d.toISOString();
  };

  const enquiries = [
    {
      id: 'enq_1', practice_id: 'prac_1',
      patient_name: 'Oliver Thompson', phone_number: '+44 7700 900123',
      message: 'I have a terrible toothache on my lower right side. It started yesterday and the pain is getting worse. I need to see someone as soon as possible please.',
      source: 'phone', is_urgent: true, is_completed: false,
      conversation: [
        { role: 'agent', message: "Good morning, you've reached Parkview Dental. I'm Ella, how can I help you today?", timestamp: daysAgo(0, 9, 15) },
        { role: 'patient', message: "Hi, I've got a really bad toothache. It started yesterday and it's getting worse.", timestamp: daysAgo(0, 9, 15) },
        { role: 'agent', message: "I'm sorry to hear that. Can you tell me which side the pain is on?", timestamp: daysAgo(0, 9, 16) },
        { role: 'patient', message: "Lower right side. It's throbbing and I can barely eat.", timestamp: daysAgo(0, 9, 16) },
        { role: 'agent', message: "That sounds uncomfortable. We do have emergency appointments available today. Let me take your details and get you booked in. Could I take your name please?", timestamp: daysAgo(0, 9, 17) },
        { role: 'patient', message: 'Oliver Thompson.', timestamp: daysAgo(0, 9, 17) },
        { role: 'agent', message: "Thank you Oliver. I've flagged this as urgent for the team. Someone will call you back shortly to confirm your appointment time.", timestamp: daysAgo(0, 9, 18) },
        { role: 'patient', message: 'Yes, this is my mobile. Thank you.', timestamp: daysAgo(0, 9, 18) },
      ],
      selected_service: null, appointment_datetime: null, confirmation_sent: false,
      created_date: daysAgo(0, 9, 15),
    },
    {
      id: 'enq_2', practice_id: 'prac_1',
      patient_name: 'Sophie Williams', phone_number: '+44 7700 900456',
      message: "I'd like to enquire about teeth whitening options and pricing. I have a wedding coming up in about 6 weeks.",
      source: 'chat', is_urgent: false, is_completed: false,
      conversation: [
        { role: 'agent', message: 'Hello! Welcome to Parkview Dental. How can I help you today?', timestamp: daysAgo(1, 14, 30) },
        { role: 'patient', message: "Hi, I'm interested in teeth whitening. I have a wedding in 6 weeks and want my teeth to look great!", timestamp: daysAgo(1, 14, 30) },
        { role: 'agent', message: "Congratulations on your upcoming wedding! We offer professional teeth whitening from \u00a3350. This includes an in-clinic session and a home whitening kit. Would you like to book a consultation?", timestamp: daysAgo(1, 14, 31) },
        { role: 'patient', message: 'That sounds good. Can I come in this week for a consultation?', timestamp: daysAgo(1, 14, 31) },
      ],
      selected_service: null, appointment_datetime: null, confirmation_sent: false,
      created_date: daysAgo(1, 14, 30),
    },
    {
      id: 'enq_3', practice_id: 'prac_1',
      patient_name: 'James Hartley', phone_number: '+44 7700 900789',
      message: "Calling to book my 6-monthly check-up. I'm an existing patient \u2014 reference PV-2847.",
      source: 'phone', is_urgent: false, is_completed: true,
      conversation: [
        { role: 'agent', message: 'Good afternoon, Parkview Dental, Ella speaking. How can I help?', timestamp: daysAgo(2, 11, 0) },
        { role: 'patient', message: "Hi, I'd like to book my regular check-up please. I'm James Hartley, patient reference PV-2847.", timestamp: daysAgo(2, 11, 0) },
        { role: 'agent', message: "Hello James, thanks for calling. I can see your records here. You're due for a check-up and hygiene appointment. Would you like to book both?", timestamp: daysAgo(2, 11, 1) },
        { role: 'patient', message: 'Yes please, back to back if possible.', timestamp: daysAgo(2, 11, 1) },
      ],
      selected_service: 'General Checkup', appointment_datetime: daysFromNow(3, 10, 0),
      practitioner: 'Dr Sarah Mitchell',
      confirmation_sent: true, confirmation_sent_date: daysAgo(2, 11, 5),
      created_date: daysAgo(2, 11, 0),
    },
    {
      id: 'enq_4', practice_id: 'prac_1',
      patient_name: 'Priya Sharma', phone_number: '+44 7700 900321',
      message: 'My son (age 7) chipped his front tooth at school. Not in pain but the tooth looks damaged. Can we get an appointment this week?',
      source: 'chat', is_urgent: true, is_completed: false,
      conversation: [
        { role: 'agent', message: 'Hello, welcome to Parkview Dental. How can I help?', timestamp: daysAgo(0, 15, 45) },
        { role: 'patient', message: "My 7-year-old chipped his front tooth at school today. He isn't in pain but the tooth looks broken. Can we see someone soon?", timestamp: daysAgo(0, 15, 45) },
        { role: 'agent', message: "I'm sorry to hear about that. A chipped tooth in a child should be assessed promptly. We can see him this week \u2014 I'll flag this as urgent for the team.", timestamp: daysAgo(0, 15, 46) },
        { role: 'patient', message: 'Priya Sharma, 07700 900321. His name is Aarush.', timestamp: daysAgo(0, 15, 46) },
      ],
      selected_service: null, appointment_datetime: null, confirmation_sent: false,
      created_date: daysAgo(0, 15, 45),
    },
    {
      id: 'enq_5', practice_id: 'prac_1',
      patient_name: 'Margaret Collins', phone_number: '+44 7700 900654',
      message: 'Interested in dental implants to replace two missing molars. Would like to know about costs and financing options.',
      source: 'phone', is_urgent: false, is_completed: false,
      conversation: [
        { role: 'agent', message: 'Good morning, Parkview Dental. How may I help you today?', timestamp: daysAgo(1, 10, 20) },
        { role: 'patient', message: "Hello, I'm calling about dental implants. I have two missing teeth at the back and my dentist has suggested implants.", timestamp: daysAgo(1, 10, 20) },
        { role: 'agent', message: "Our implant consultations are complimentary and include a CT scan. Single implants start from \u00a32,500, and we offer interest-free finance over 12 months.", timestamp: daysAgo(1, 10, 21) },
        { role: 'patient', message: "Yes, that would be great. I'm available most mornings.", timestamp: daysAgo(1, 10, 22) },
      ],
      selected_service: null, appointment_datetime: null, confirmation_sent: false,
      created_date: daysAgo(1, 10, 20),
    },
    {
      id: 'enq_6', practice_id: 'prac_1',
      patient_name: 'David Nguyen', phone_number: '+44 7700 900987',
      message: 'Routine hygiene appointment booking. Existing patient.',
      source: 'phone', is_urgent: false, is_completed: true,
      conversation: [],
      selected_service: 'Teeth Cleaning', appointment_datetime: daysFromNow(1, 14, 30),
      practitioner: 'Ms Emily Chen',
      confirmation_sent: true, confirmation_sent_date: daysAgo(3),
      created_date: daysAgo(3, 16, 0),
    },
    {
      id: 'enq_7', practice_id: 'prac_1',
      patient_name: 'Rachel Evans', phone_number: '+44 7700 900111',
      message: "I'd like to register as a new patient. Just moved to the area.",
      source: 'chat', is_urgent: false, is_completed: false,
      conversation: [
        { role: 'agent', message: 'Welcome to Parkview Dental! How can I help you today?', timestamp: daysAgo(0, 11, 0) },
        { role: 'patient', message: "Hi, I've just moved to the area and looking for a new dentist. Do you accept new patients?", timestamp: daysAgo(0, 11, 0) },
        { role: 'agent', message: "Absolutely, we're always happy to welcome new patients. A new patient examination is \u00a365 and includes X-rays.", timestamp: daysAgo(0, 11, 1) },
        { role: 'patient', message: 'Yes please!', timestamp: daysAgo(0, 11, 1) },
      ],
      selected_service: null, appointment_datetime: null, confirmation_sent: false,
      created_date: daysAgo(0, 11, 0),
    },
    {
      id: 'enq_8', practice_id: 'prac_2',
      patient_name: 'Tom Bradley', phone_number: '+44 7911 123456',
      message: 'Need to book a filling appointment.',
      source: 'phone', is_urgent: false, is_completed: false,
      conversation: [],
      selected_service: null, appointment_datetime: null, confirmation_sent: false,
      created_date: daysAgo(1, 9, 30),
    },
    // Antrim House Dental enquiries
    {
      id: 'enq_9', practice_id: 'prac_3',
      patient_name: 'Ciara O\'Brien', phone_number: '+44 7812 345678',
      message: 'My crown has come loose while eating. It\'s not painful but feels very wobbly. Can someone see me today?',
      source: 'phone', is_urgent: true, is_completed: false,
      conversation: [
        { role: 'agent', message: 'Good morning, Antrim House Dental. How can I help?', timestamp: daysAgo(0, 10, 5) },
        { role: 'patient', message: 'Hi, my crown came off while I was eating breakfast. It\'s still attached but really wobbly.', timestamp: daysAgo(0, 10, 5) },
        { role: 'agent', message: 'I\'m sorry about that. We can fit you in today as an emergency. Can I take your name?', timestamp: daysAgo(0, 10, 6) },
        { role: 'patient', message: 'Ciara O\'Brien. I\'m an existing patient.', timestamp: daysAgo(0, 10, 6) },
      ],
      selected_service: null, appointment_datetime: null, confirmation_sent: false,
      created_date: daysAgo(0, 10, 5),
    },
    {
      id: 'enq_10', practice_id: 'prac_3',
      patient_name: 'Sean Murphy', phone_number: '+44 7823 456789',
      message: 'Looking to get Invisalign. Heard you do a free consultation?',
      source: 'chat', is_urgent: false, is_completed: false,
      conversation: [
        { role: 'agent', message: 'Hello! Welcome to Antrim House Dental. How can I help today?', timestamp: daysAgo(1, 16, 0) },
        { role: 'patient', message: 'Hi, I\'m interested in Invisalign. Do you offer it and is there a free consult?', timestamp: daysAgo(1, 16, 0) },
        { role: 'agent', message: 'Yes, we do offer Invisalign and your initial consultation is complimentary. Shall I book you in?', timestamp: daysAgo(1, 16, 1) },
      ],
      selected_service: null, appointment_datetime: null, confirmation_sent: false,
      created_date: daysAgo(1, 16, 0),
    },
    {
      id: 'enq_11', practice_id: 'prac_3',
      patient_name: 'Maeve Donovan', phone_number: '+44 7834 567890',
      message: 'Routine check-up for myself and my two children (ages 10 and 13).',
      source: 'phone', is_urgent: false, is_completed: true,
      conversation: [],
      selected_service: 'General Checkup', appointment_datetime: daysFromNow(5, 9, 30),
      practitioner: 'Dr Fiona McAllister',
      confirmation_sent: true, confirmation_sent_date: daysAgo(1, 14, 0),
      created_date: daysAgo(2, 9, 0),
    },
    // Sparkling Dental Clinic enquiries
    {
      id: 'enq_12', practice_id: 'prac_4',
      patient_name: 'Liam Foster', phone_number: '+44 7745 678901',
      message: 'Interested in composite bonding for my front teeth. Have a slight gap I\'d like closed.',
      source: 'chat', is_urgent: false, is_completed: false,
      conversation: [
        { role: 'agent', message: 'Welcome to Sparkling Dental! How can we help you today?', timestamp: daysAgo(0, 13, 20) },
        { role: 'patient', message: 'Hi, I\'ve got a gap between my two front teeth and want to know about bonding options.', timestamp: daysAgo(0, 13, 20) },
        { role: 'agent', message: 'Composite bonding is a great option for closing gaps. It starts from \u00a3350 per tooth and is done in a single visit. Would you like to book a consultation with Dr Hassan?', timestamp: daysAgo(0, 13, 21) },
      ],
      selected_service: null, appointment_datetime: null, confirmation_sent: false,
      created_date: daysAgo(0, 13, 20),
    },
    {
      id: 'enq_13', practice_id: 'prac_4',
      patient_name: 'Emma Richardson', phone_number: '+44 7756 789012',
      message: 'Want to book the Zoom whitening. Getting married in 4 weeks!',
      source: 'phone', is_urgent: false, is_completed: false,
      conversation: [
        { role: 'agent', message: 'Hi, Sparkling Dental, how can I help?', timestamp: daysAgo(0, 11, 45) },
        { role: 'patient', message: 'Hi! I\'m getting married in 4 weeks and really want the Zoom whitening. Is that enough time?', timestamp: daysAgo(0, 11, 45) },
        { role: 'agent', message: 'Congratulations! Yes, 4 weeks is perfect. The Zoom treatment is \u00a3450 and includes an in-chair session plus a home top-up kit. Shall I book you in?', timestamp: daysAgo(0, 11, 46) },
      ],
      selected_service: null, appointment_datetime: null, confirmation_sent: false,
      created_date: daysAgo(0, 11, 45),
    },
    // Designer Smiles enquiries
    {
      id: 'enq_14', practice_id: 'prac_5',
      patient_name: 'Victoria Chen-Ramirez', phone_number: '+44 7867 890123',
      message: 'Interested in a full smile makeover. I\'ve seen your work on Instagram and would love a consultation.',
      source: 'chat', is_urgent: false, is_completed: false,
      conversation: [
        { role: 'agent', message: 'Welcome to Designer Smiles on Harley Street. How may I assist you?', timestamp: daysAgo(0, 14, 0) },
        { role: 'patient', message: 'Hi, I\'ve been following your Instagram and I love the smile transformations. I\'d like to book a smile makeover consultation.', timestamp: daysAgo(0, 14, 0) },
        { role: 'agent', message: 'Thank you! We\'d love to help you. Our complimentary smile makeover consultation includes a digital smile design preview so you can see your potential results. Dr Petrov has availability next week.', timestamp: daysAgo(0, 14, 1) },
        { role: 'patient', message: 'That sounds amazing. Yes please, any morning works for me.', timestamp: daysAgo(0, 14, 1) },
      ],
      selected_service: null, appointment_datetime: null, confirmation_sent: false,
      created_date: daysAgo(0, 14, 0),
    },
    {
      id: 'enq_15', practice_id: 'prac_5',
      patient_name: 'Alexander Hughes', phone_number: '+44 7878 901234',
      message: 'Need to replace 3 missing teeth with implants. Want the best option available.',
      source: 'phone', is_urgent: false, is_completed: false,
      conversation: [
        { role: 'agent', message: 'Good afternoon, Designer Smiles Harley Street. How can I help?', timestamp: daysAgo(1, 15, 30) },
        { role: 'patient', message: 'Hello, I have 3 missing teeth and I\'ve been told implants are the best solution. I want the premium option.', timestamp: daysAgo(1, 15, 30) },
        { role: 'agent', message: 'Absolutely. Dr Petrov specialises in implant-supported restorations using Straumann implants. A single premium implant is \u00a33,500. For multiple implants we can discuss a tailored plan. Shall I book a CT scan and consultation?', timestamp: daysAgo(1, 15, 31) },
        { role: 'patient', message: 'Yes, please. Cost isn\'t an issue, I just want the best result.', timestamp: daysAgo(1, 15, 32) },
      ],
      selected_service: null, appointment_datetime: null, confirmation_sent: false,
      created_date: daysAgo(1, 15, 30),
    },
    {
      id: 'enq_16', practice_id: 'prac_5',
      patient_name: 'Isabella Morgan', phone_number: '+44 7889 012345',
      message: 'Invisalign enquiry for my 16-year-old daughter.',
      source: 'phone', is_urgent: false, is_completed: true,
      conversation: [],
      selected_service: 'Invisalign', appointment_datetime: daysFromNow(2, 11, 0),
      practitioner: 'Dr Marcus Wright',
      confirmation_sent: true, confirmation_sent_date: daysAgo(2, 10, 0),
      created_date: daysAgo(3, 10, 0),
    },
  ];

  return { practices, enquiries };
}

// --------------- Entity helpers ---------------

function createEntityAPI(entityName) {
  return {
    list(sortField) {
      const store = getStore();
      let items = [...(store[entityName] || [])];
      if (sortField) {
        const desc = sortField.startsWith('-');
        const field = desc ? sortField.slice(1) : sortField;
        items.sort((a, b) => {
          const av = a[field] || '';
          const bv = b[field] || '';
          return desc ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
        });
      }
      return Promise.resolve(items);
    },

    filter(criteria, sortField) {
      const store = getStore();
      let items = (store[entityName] || []).filter(item =>
        Object.entries(criteria).every(([k, v]) => item[k] === v)
      );
      if (sortField) {
        const desc = sortField.startsWith('-');
        const field = desc ? sortField.slice(1) : sortField;
        items.sort((a, b) => {
          const av = a[field] || '';
          const bv = b[field] || '';
          return desc ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
        });
      }
      return Promise.resolve(items);
    },

    create(data) {
      const store = getStore();
      const item = { ...data, id: generateId(), created_date: new Date().toISOString() };
      store[entityName] = [...(store[entityName] || []), item];
      saveStore(store);
      return Promise.resolve(item);
    },

    update(id, data) {
      const store = getStore();
      const items = store[entityName] || [];
      const idx = items.findIndex(i => i.id === id);
      if (idx === -1) return Promise.reject(new Error('Not found'));
      items[idx] = { ...items[idx], ...data };
      store[entityName] = items;
      saveStore(store);
      return Promise.resolve(items[idx]);
    },

    delete(id) {
      const store = getStore();
      store[entityName] = (store[entityName] || []).filter(i => i.id !== id);
      saveStore(store);
      return Promise.resolve();
    },
  };
}

// --------------- Public API (matches base44 SDK surface) ---------------

export const base44 = {
  entities: {
    Practice: createEntityAPI('practices'),
    Enquiry: createEntityAPI('enquiries'),
  },

  auth: {
    isAuthenticated: () => Promise.resolve(false),
    me: () => Promise.resolve({ role: 'admin' }),
    logout: () => {},
    redirectToLogin: () => {},
  },

  integrations: {
    Core: {
      SendEmail: (params) => {
        console.log('[Pathir] Email stub:', params);
        return Promise.resolve({ success: true });
      },
      UploadFile: ({ file }) => {
        const url = URL.createObjectURL(file);
        return Promise.resolve({ file_url: url });
      },
    },
  },
};
