import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { updatePractice as updateSupabasePractice } from '@/lib/supabaseData';
import { Loader2, Building2, Users, PoundSterling, Star, Check, Plug } from 'lucide-react';
import { toast } from 'sonner';
import { assignTwilioNumber } from '@/lib/twilioService';

import ClinicDetailsTab from './settings/ClinicDetailsTab';
import TeamTab from './settings/TeamTab';
import PricingTab from './settings/PricingTab';
import PracticeInfoTab from './settings/PracticeInfoTab';
import IntegrationsTab from './settings/IntegrationsTab';

/* Scrape-merge helpers. We never overwrite a populated field — only fill
   gaps. That way re-running the scraper on a clinic that's already been
   tuned by hand never blows away the manual edits. */
function mergeScraperHours(current, scraped) {
  const byDay = new Map((scraped || []).map((h) => [String(h.day || '').toLowerCase(), h]));
  return (current || []).map((row) => {
    const m = byDay.get(row.day.toLowerCase());
    if (!m) return row;
    return {
      day: row.day,
      is_open: !!m.is_open,
      open_time: m.open_time || row.open_time,
      close_time: m.close_time || row.close_time,
    };
  });
}
function mergeStaff(current, scraped) {
  const existingByName = new Set((current || []).map((p) => (p.name || '').toLowerCase()));
  const additions = (scraped || [])
    .filter((p) => p?.name && !existingByName.has(p.name.toLowerCase()))
    .map((p) => ({
      name: p.name,
      title: p.title || '',
      credentials: p.credentials || '',
      bio: p.bio || (p.specialty ? `Specialises in ${p.specialty}.` : ''),
      services: [],
    }));
  return [...(current || []), ...additions];
}
function mergeServices(current, scraped) {
  const existing = new Set((current || []).map((s) => (s.service_name || '').toLowerCase()));
  const additions = (scraped || [])
    .filter((s) => s?.name && !existing.has(s.name.toLowerCase()))
    .map((s) => ({
      service_name: s.name,
      category: 'general',
      price: parseScrapedPrice(s.price),
      description: s.description || '',
      notes: '',
      is_from_price: typeof s.price === 'string' && /from/i.test(s.price),
    }));
  return [...(current || []), ...additions];
}
function parseScrapedPrice(raw) {
  if (!raw) return '';
  const m = String(raw).match(/£?(\d+(?:\.\d{1,2})?)/);
  return m ? m[1] : '';
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DEFAULT_HOURS = DAYS.map(day => ({
  day,
  is_open: !['Saturday', 'Sunday'].includes(day),
  open_time: '09:00',
  close_time: '17:30',
}));

const TABS = [
  { id: 'clinic',       label: 'Clinic',        icon: Building2 },
  { id: 'team',         label: 'Team',           icon: Users },
  { id: 'pricing',      label: 'Pricing',        icon: PoundSterling },
  { id: 'info',         label: 'Practice Info',  icon: Star },
  { id: 'integrations', label: 'Integrations',   icon: Plug },
];

export default function ClinicSettings({ practice, onUpdate, activeTab, onTabChange }) {
  const setActiveTab = onTabChange;
  const [isSaving, setIsSaving] = useState(false);

  // Tab: Clinic Details
  const [details, setDetails] = useState({
    name: practice.name || '',
    address: practice.address || '',
    phone: practice.phone || '',
    email: practice.email || '',
    website: practice.website || '',
  });
  const [practiceType, setPracticeType] = useState(practice.practice_type || '');
  const [hours, setHours] = useState(practice.opening_hours?.length ? practice.opening_hours : DEFAULT_HOURS);
  const [integrations, setIntegrations] = useState({
    phone_enabled: false,
    sms_enabled: false,
    web_chat_enabled: false,
    ...practice.integrations,
  });
  const [holidayHours, setHolidayHours] = useState(practice.holiday_hours || []);

  const [pearDental, setPearDental] = useState({
    api_key: practice.pear_dental?.api_key || '',
    practice_code: practice.pear_dental?.practice_code || '',
    connected: practice.pear_dental?.connected || false,
  });

  // Tab: Team
  const [practitioners, setPractitioners] = useState(practice.practitioners || []);

  // Tab: Pricing
  const [priceList, setPriceList] = useState(practice.price_list || []);

  // Tab: Practice Info
  const [usps, setUsps] = useState(practice.usps || '');
  const [practicePlan, setPracticePlan] = useState({ offered: false, terms: '', ...practice.practice_plan });
  const [financeDocUrl, setFinanceDocUrl] = useState(practice.finance_document_url || '');
  const [clinicGuidelines, setClinicGuidelines] = useState(practice.clinic_guidelines || '');

  const isFirstRender = useRef(true);
  const [savedAt, setSavedAt] = useState(null);
  const [isAssigningNumber, setIsAssigningNumber] = useState(false);

  const saveData = async (data) => {
    setIsSaving(true);
    try {
      // Try Supabase first
      const updated = await updateSupabasePractice(practice.id, data);
      onUpdate({ ...practice, ...updated });
    } catch {
      // Fall back to localStorage
      const updated = await base44.entities.Practice.update(practice.id, data);
      onUpdate({ ...practice, ...updated, ...(updated.data || {}) });
    }
    setSavedAt(new Date());
    setIsSaving(false);
  };

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    const timer = setTimeout(() => {
      saveData({
        ...details,
        practice_type: practiceType,
        opening_hours: hours,
        holiday_hours: holidayHours,
        integrations,
        pear_dental: pearDental,
        practitioners,
        price_list: priceList,
        usps,
        practice_plan: practicePlan,
        finance_document_url: financeDocUrl,
        clinic_guidelines: clinicGuidelines,
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [details, practiceType, hours, holidayHours, integrations, pearDental, practitioners, priceList, usps, practicePlan, financeDocUrl, clinicGuidelines]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Side nav tabs */}
      <div className="w-48 shrink-0 bg-white border-r border-slate-100 flex flex-col pt-8 pb-4 px-3 overflow-hidden">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-4 px-2">Settings</p>
        <nav className="space-y-1 flex-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400 h-8">
          {isSaving
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</>
            : savedAt
              ? <><Check className="w-3 h-3 text-emerald-500" /> <span className="text-emerald-600">Saved</span></>
              : null}
        </div>
      </div>

      {/* Tab content. Pricing has many columns (category, service, price,
          from-flag, description, notes, delete) — with the default
          max-w-3xl shell (~768px) every column is squeezed to ~60px and
          textareas wrap awkwardly. We widen the shell on the pricing tab
          so the price-list rows breathe; other tabs keep the comfortable
          reading width. */}
      <div className="flex-1 overflow-y-auto">
        <div className={`px-8 py-10 ${activeTab === 'pricing' ? 'max-w-6xl' : 'max-w-3xl'}`}>
          {activeTab === 'clinic' && (
          <ClinicDetailsTab
            details={details} setDetails={setDetails}
            hours={hours} setHours={setHours}
            holidayHours={holidayHours} setHolidayHours={setHolidayHours}
            integrations={integrations}
            practiceType={practiceType} setPracticeType={setPracticeType}
            practice={practice}
            onScraped={(extracted) => {
              /* Re-scrape from Settings should update every section the
                 scraper covers — basics here, plus practitioners, prices,
                 hours, agent_tone, clinic_guidelines. We hand it to every
                 setter that owns a slice; the auto-save effect picks them
                 all up in one debounced round-trip. */
              setDetails((prev) => ({
                ...prev,
                name:    extracted.name    || prev.name,
                phone:   extracted.phone   || prev.phone,
                email:   extracted.email   || prev.email,
                address: extracted.address || prev.address,
                website: extracted.appointment_booking_url || prev.website,
              }));
              if (extracted.business_hours?.length > 0) {
                setHours((prev) => mergeScraperHours(prev, extracted.business_hours));
              }
              if (extracted.staff?.length > 0) {
                setPractitioners((prev) => mergeStaff(prev, extracted.staff));
              }
              if (extracted.services?.length > 0) {
                setPriceList((prev) => mergeServices(prev, extracted.services));
              }
              if (extracted.description) setUsps((prev) => prev || extracted.description);
              if (extracted.clinic_guidelines) setClinicGuidelines((prev) => prev || extracted.clinic_guidelines);
            }}
          />
        )}
          {activeTab === 'team' && (
            <TeamTab practitioners={practitioners} setPractitioners={setPractitioners} />
          )}
          {activeTab === 'pricing' && (
            <PricingTab priceList={priceList} setPriceList={setPriceList} practice={practice} />
          )}
          {activeTab === 'info' && (
            <PracticeInfoTab
              usps={usps} setUsps={setUsps}
              practicePlan={practicePlan} setPracticePlan={setPracticePlan}
              financeDocUrl={financeDocUrl} setFinanceDocUrl={setFinanceDocUrl}
              clinicGuidelines={clinicGuidelines} setClinicGuidelines={setClinicGuidelines}
            />
          )}
          {activeTab === 'integrations' && (
            <IntegrationsTab
              practice={practice}
              integrations={integrations}
              setIntegrations={setIntegrations}
              pearDental={pearDental}
              setPearDental={setPearDental}
              isAssigningNumber={isAssigningNumber}
              onAssignNumber={async () => {
                setIsAssigningNumber(true);
                try {
                  const result = await assignTwilioNumber(practice.id);
                  onUpdate({ ...practice, twilio_phone_number: result.phoneNumber });
                  toast.success(`Voice AI enabled: ${result.phoneNumber}`);
                  return result;
                } catch (err) {
                  toast.error(err.message || 'Failed to assign number');
                  return null;
                } finally {
                  setIsAssigningNumber(false);
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}