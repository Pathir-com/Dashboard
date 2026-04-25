import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { createPractice, getMyPractice } from '@/lib/supabaseData';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

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

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [checkingExistingPractice, setCheckingExistingPractice] = useState(true);

  /* Guard: if this user already owns a practice, get them out of the
     onboarding form. They might land here from a stale URL, a bookmark,
     a browser back-button, or DashboardRedirect's react-query cache
     returning null before its first refetch lands. The DB is the source
     of truth — query it directly on mount and redirect. */
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

  // Pre-fill clinic name from auth metadata (if entered during signup)
  const savedDraft = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  })();

  const [form, setForm] = useState({
    name: savedDraft?.name || user?.user_metadata?.clinic_name || '',
    address: savedDraft?.address || '',
    email: user?.email || '',
    website: savedDraft?.website || '',
    practice_type: savedDraft?.practice_type || 'Private',
    opening_hours: savedDraft?.opening_hours || DEFAULT_HOURS,
  });

  // Persist draft to localStorage on every change (resume on return)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  }, [form]);

  const update = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const updateHour = (index, field, value) => {
    const hours = [...form.opening_hours];
    hours[index] = { ...hours[index], [field]: value };
    setForm(prev => ({ ...prev, opening_hours: hours }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('Clinic name is required');
      return;
    }
    setLoading(true);
    try {
      const practice = await createPractice({
        name: form.name,
        address: form.address,
        email: form.email,
        website: form.website,
        practice_type: form.practice_type,
        opening_hours: form.opening_hours,
        onboarding_completed: true,
      });

      // Auto-provision AI agent (non-blocking)
      try {
        await supabase.functions.invoke('provision-practice', {
          body: { practiceId: practice.id },
        });
      } catch (provisionErr) {
        console.error('Agent provisioning failed (non-fatal):', provisionErr);
      }

      // Clear draft
      localStorage.removeItem(STORAGE_KEY);

      toast.success('Clinic created! Welcome to Pathir.');
      navigate(`/Clinic?id=${practice.id}`);
    } catch (err) {
      toast.error(err.message || 'Failed to create clinic');
    } finally {
      setLoading(false);
    }
  };

  // Hold the form behind the existing-practice check so a stale arrival
  // doesn't render the empty form for a user who actually has a clinic.
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
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Pathir</h1>
          <p className="text-slate-500 mt-1">Let's set up your clinic</p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2].map((s) => (
            <div key={s} className="flex-1">
              <div className={`h-1.5 rounded-full transition-colors ${s <= step ? 'bg-slate-900' : 'bg-slate-200'}`} />
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
          {step === 1 && (
            <>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">Clinic Details</h2>
              <p className="text-slate-500 text-sm mb-6">Basic information about your practice</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Clinic Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                    placeholder="e.g. Parkview Dental"
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
                    <option value="Mixed">Mixed (NHS & Private)</option>
                  </select>
                </div>
              </div>

              <button
                onClick={() => {
                  if (!form.name.trim()) { toast.error('Clinic name is required'); return; }
                  setStep(2);
                }}
                className="w-full mt-6 py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors"
              >
                Continue
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-xl font-semibold text-slate-900 mb-1">Opening Hours</h2>
              <p className="text-slate-500 text-sm mb-6">Set your typical weekly schedule — you can add holidays later</p>

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
                  onClick={() => setStep(1)}
                  className="flex-1 py-2.5 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Setting up...
                    </span>
                  ) : (
                    'Create Clinic'
                  )}
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          You can update these details anytime from your clinic settings.
        </p>
      </div>
    </div>
  );
}
