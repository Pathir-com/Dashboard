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

export default function ClinicSettings({ practice, onUpdate }) {
  const [activeTab, setActiveTab] = useState('clinic');
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
    phone_enabled: practice.integrations?.phone_enabled || false,
    sms_enabled: practice.integrations?.sms_enabled || false,
    web_chat_enabled: practice.integrations?.web_chat_enabled || false,
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
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [details, practiceType, hours, holidayHours, integrations, pearDental, practitioners, priceList, usps, practicePlan, financeDocUrl]);

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

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-10 max-w-3xl">
          {activeTab === 'clinic' && (
          <ClinicDetailsTab
            details={details} setDetails={setDetails}
            hours={hours} setHours={setHours}
            holidayHours={holidayHours} setHolidayHours={setHolidayHours}
            pearDental={pearDental} setPearDental={setPearDental}
            practiceType={practiceType} setPracticeType={setPracticeType}
          />
        )}
          {activeTab === 'team' && (
            <TeamTab practitioners={practitioners} setPractitioners={setPractitioners} />
          )}
          {activeTab === 'pricing' && (
            <PricingTab priceList={priceList} setPriceList={setPriceList} />
          )}
          {activeTab === 'info' && (
            <PracticeInfoTab
              usps={usps} setUsps={setUsps}
              practicePlan={practicePlan} setPracticePlan={setPracticePlan}
              financeDocUrl={financeDocUrl} setFinanceDocUrl={setFinanceDocUrl}
            />
          )}
          {activeTab === 'integrations' && (
            <IntegrationsTab
              practice={practice}
              integrations={integrations}
              setIntegrations={setIntegrations}
              isAssigningNumber={isAssigningNumber}
              onAssignNumber={async () => {
                setIsAssigningNumber(true);
                try {
                  const result = await assignTwilioNumber(practice.id);
                  onUpdate({ ...practice, twilio_phone_number: result.phoneNumber });
                  toast.success(`Voice AI enabled: ${result.phoneNumber}`);
                } catch (err) {
                  toast.error(err.message || 'Failed to assign number');
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