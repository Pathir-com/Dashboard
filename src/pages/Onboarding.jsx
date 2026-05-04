import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { createPractice, getMyPractice, updatePractice } from '@/lib/supabaseData';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import WebsiteScraper from '@/components/onboarding/WebsiteScraper';
import { buildPracticePatch } from '@/lib/applyScrapedClinic';

const STORAGE_KEY = 'pathir_onboarding_draft';

const DEFAULT_HOURS = [
  { day: 'Monday', is_open: true, open_time: '09:00', close_time: '17:30' },
  { day: 'Tuesday', is_open: true, open_time: '09:00', close_time: '17:30' },
  { day: 'Wednesday', is_open: true, open_time: '09:00', close_time: '17:30' },
  { day: 'Thursday', is_open: true, open_time: '09:00', close_time: '17:30' },
  { day: 'Friday', is_open: true, open_time: '09:00', close_time: '17:00' },
  { day: 'Saturday', is_open: false, open_time: '09:00', close_time: '13:00' },
  { day: 'Sunday', is_open: false, open_time: '09:00', close_time: '17:00' },
];

/* Reshape whatever the scraper returned into the 7-row {day,is_open,open_time,
   close_time} structure the form expects, falling back to the user's current
   row if the scraper didn't have an entry for that day. */
function normaliseHoursForUi(scraperHours, currentHours) {
  const byDay = new Map(
    (scraperHours || []).map((h) => [String(h.day || '').toLowerCase(), h]),
  );
  return (currentHours || DEFAULT_HOURS).map((row) => {
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

const INDUSTRIES = [
  {
    id: 'dental',
    label: 'Dental Practice',
    blurb: 'Routine check-ups, hygiene, cosmetic, emergencies. Persona: Poppy.',
  },
  {
    id: 'hair_transplant',
    label: 'Hair Transplant Clinic',
    blurb: 'Consultations, FUE/DHI procedures, post-op care. Persona: Hannah.',
  },
];

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [createdPractice, setCreatedPractice] = useState(null);
  const [checkingExistingPractice, setCheckingExistingPractice] = useState(true);

  useEffect(() => {
    if (!user) { setCheckingExistingPractice(false); return; }
    let cancelled = false;
    getMyPractice()
      .then((existing) => {
        if (cancelled) return;
        if (existing?.id) {
          navigate(`/Clinic?id=${existing.id}`, { replace: true });
        } else {
          setCheckingExistingPractice(false);
        }
      })
      .catch(() => { if (!cancelled) setCheckingExistingPractice(false); });
    return () => { cancelled = true; };
  }, [user, navigate]);

  const savedDraft = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  })();

  const [form, setForm] = useState({
    industry: savedDraft?.industry || 'dental',
    name: savedDraft?.name || user?.user_metadata?.clinic_name || '',
    address: savedDraft?.address || '',
    email: user?.email || savedDraft?.email || '',
    website: savedDraft?.website || '',
    practice_type: savedDraft?.practice_type || 'Private',
    opening_hours: savedDraft?.opening_hours || DEFAULT_HOURS,
    mobile_number: savedDraft?.mobile_number || '',
    /* Carry the full scraper output forward so Step 3's "Create Clinic"
       can persist the rich JSONB fields (services, staff, hours,
       agent_tone, clinic_guidelines) in the same insert — no separate
       update round-trip and no half-filled state if the user bails. */
    scraped: savedDraft?.scraped || null,
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  }, [form]);

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const updateHour = (index, field, value) => {
    const hours = [...form.opening_hours];
    hours[index] = { ...hours[index], [field]: value };
    setForm(prev => ({ ...prev, opening_hours: hours }));
  };

  /* Step 3 → Step 4: create the practice row, kick off agent provisioning,
     and hand over to the AI-test step. We commit to DB here (not at the end)
     so the SMS test path has a real practice_id to attach the trial route to.
     onboarding_completed stays false until they finish Step 4. */
  const handleCreatePractice = async () => {
    if (!form.name.trim()) {
      toast.error('Clinic name is required');
      return;
    }
    setLoading(true);
    try {
      /* Merge any fields the scraper found that the user didn't override.
         The form values win whenever the user has typed something — we
         never overwrite explicit edits. Scraper-only fields (services,
         staff, agent_tone, clinic_guidelines) flow through untouched. */
      const scrapedPatch = form.scraped ? buildPracticePatch(form.scraped) : {};
      const practice = await createPractice({
        ...scrapedPatch,
        name: form.name,
        address: form.address || scrapedPatch.address || '',
        email: form.email,
        website: form.website,
        practice_type: form.practice_type,
        opening_hours: form.opening_hours,
        industry: form.industry,
        onboarding_completed: false,
      });
      setCreatedPractice(practice);

      supabase.functions
        .invoke('provision-practice', { body: { practiceId: practice.id } })
        .catch((err) => console.error('Agent provisioning failed (non-fatal):', err));

      setStep(4);
    } catch (err) {
      toast.error(err.message || 'Failed to create clinic');
    } finally {
      setLoading(false);
    }
  };

  const handleSendIntroSms = async () => {
    if (!createdPractice?.id) {
      toast.error('Clinic not created yet');
      return;
    }
    if (!form.mobile_number.trim()) {
      toast.error('Mobile number is required');
      return;
    }
    setSmsLoading(true);
    try {
      const { error } = await supabase.functions.invoke('intro-test-sms', {
        body: {
          practiceId: createdPractice.id,
          to: form.mobile_number.trim(),
        },
      });
      if (error) throw error;
      setSmsSent(true);
      toast.success("Intro SMS sent. Reply from your phone — the AI will reply back, and the conversation will appear in your enquiries.");
    } catch (err) {
      toast.error(err.message || 'Failed to send intro SMS');
    } finally {
      setSmsLoading(false);
    }
  };

  const handleFinish = async () => {
    if (!createdPractice?.id) return;
    try {
      await updatePractice(createdPractice.id, { onboarding_completed: true });
    } catch (err) {
      console.error('Failed to mark onboarding complete:', err);
    }
    localStorage.removeItem(STORAGE_KEY);
    toast.success('Welcome to Pathir');
    navigate(`/Clinic?id=${createdPractice.id}`);
  };

  if (checkingExistingPractice) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Pathir</h1>
          <p className="text-slate-500 mt-1">Let's set up your clinic</p>
        </div>

        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex-1">
              <div className={`h-1.5 rounded-full transition-colors ${s <= step ? 'bg-slate-900' : 'bg-slate-200'}`} />
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
          {step === 1 && (
            <>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">What kind of clinic?</h2>
              <p className="text-slate-500 text-sm mb-6">We tailor the AI agent's voice, tone, and clinical guardrails to your vertical.</p>

              <div className="space-y-3">
                {INDUSTRIES.map((ind) => (
                  <button
                    key={ind.id}
                    type="button"
                    onClick={() => update('industry', ind.id)}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                      form.industry === ind.id
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-medium text-slate-900">{ind.label}</div>
                    <div className="text-sm text-slate-500 mt-1">{ind.blurb}</div>
                  </button>
                ))}
              </div>

              <button
                onClick={() => setStep(2)}
                className="w-full mt-6 py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors"
              >
                Continue
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">Clinic Details</h2>
              <p className="text-slate-500 text-sm mb-6">Paste your website and we&apos;ll fill the rest in for you. Or skip and type it manually below.</p>

              <div className="mb-6 -mx-2 sm:mx-0">
                <WebsiteScraper
                  initialUrl={form.website}
                  industry={form.industry}
                  onExtracted={(extracted) => {
                    /* Pre-fill any blank form field from the scraped data;
                       never overwrite what the user has already typed. The
                       scraper follows internal links on the site (team /
                       services / faq / about) automatically — no second
                       URL needed. */
                    setForm((prev) => ({
                      ...prev,
                      name: prev.name || extracted.name || '',
                      address: prev.address || extracted.address || '',
                      email: prev.email || extracted.email || '',
                      website: extracted.appointment_booking_url || prev.website || '',
                      opening_hours: (extracted.business_hours && extracted.business_hours.length > 0)
                        ? normaliseHoursForUi(extracted.business_hours, prev.opening_hours)
                        : prev.opening_hours,
                      scraped: extracted,
                    }));
                    toast.success('Pre-filled from your website. Edit anything that needs tweaking.');
                  }}
                />
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Clinic Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                    placeholder={form.industry === 'hair_transplant' ? 'e.g. Berkeley Hair Clinic' : 'e.g. Parkview Dental'}
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => update('address', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                    placeholder="42 High Street, London SW1A 1AA"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent bg-slate-50"
                    placeholder="reception@clinic.co.uk"
                    readOnly={!!user?.email}
                  />
                  {user?.email && (
                    <p className="text-xs text-slate-400 mt-1">From your account. Change it in Settings later.</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Website</label>
                  <input
                    type="url"
                    value={form.website}
                    onChange={(e) => update('website', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                    placeholder="https://clinic.co.uk"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Practice Type</label>
                  <select
                    value={form.practice_type}
                    onChange={(e) => update('practice_type', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent bg-white"
                  >
                    <option value="Private">Private</option>
                    <option value="NHS">NHS</option>
                    <option value="Mixed">Mixed (NHS &amp; Private)</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    if (!form.name.trim()) { toast.error('Clinic name is required'); return; }
                    setStep(3);
                  }}
                  className="flex-1 py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors"
                >
                  Continue
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">Opening Hours</h2>
              <p className="text-slate-500 text-sm mb-6">The AI uses these to find slots. You can refine and add holidays later.</p>

              <div className="space-y-3">
                {form.opening_hours.map((day, i) => (
                  <div key={day.day} className="flex items-center gap-3">
                    <label className="flex items-center gap-2 w-28 flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={day.is_open}
                        onChange={(e) => updateHour(i, 'is_open', e.target.checked)}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                      />
                      <span className="text-sm text-slate-700">{day.day}</span>
                    </label>
                    {day.is_open ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="time"
                          value={day.open_time}
                          onChange={(e) => updateHour(i, 'open_time', e.target.value)}
                          className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                        />
                        <span className="text-slate-400 text-sm">to</span>
                        <input
                          type="time"
                          value={day.close_time}
                          onChange={(e) => updateHour(i, 'close_time', e.target.value)}
                          className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400">Closed</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleCreatePractice}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Setting up...
                    </span>
                  ) : (
                    'Continue'
                  )}
                </button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">Test the AI</h2>
              <p className="text-slate-500 text-sm mb-6">
                We'll text you an introduction from <span className="font-medium text-slate-700">{form.name}</span>.
                Reply to that SMS — the AI will reply back, and the conversation will appear in your dashboard's enquiries.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Your mobile number</label>
                  <input
                    type="tel"
                    value={form.mobile_number}
                    onChange={(e) => update('mobile_number', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                    placeholder="+44 7700 900123"
                    autoFocus
                    disabled={smsSent}
                  />
                  <p className="text-xs text-slate-400 mt-1">UK or international, with country code.</p>
                </div>

                {!smsSent ? (
                  <button
                    onClick={handleSendIntroSms}
                    disabled={smsLoading || !form.mobile_number.trim()}
                    className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {smsLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Sending intro SMS...
                      </span>
                    ) : (
                      'Send intro SMS'
                    )}
                  </button>
                ) : (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800">
                    Sent. Check your phone and reply with anything — try "what services do you offer" or "I'd like to book in".
                    Then come back and finish; your reply will already be in the dashboard.
                  </div>
                )}

                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 leading-relaxed">
                  <strong>Trial mode:</strong> the SMS goes from a shared Pathir number. Once you connect your own
                  TextMagic, Twilio, SignalWire, or Vonage number from Settings → Integrations, all messaging routes
                  through it instead. Trial routing expires in 24 hours.
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleFinish}
                  className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
                >
                  Skip and go to dashboard
                </button>
                <button
                  onClick={handleFinish}
                  disabled={!smsSent}
                  className="flex-1 py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Finish
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          You can update everything from your clinic settings.
        </p>
      </div>
    </div>
  );
}
