import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { createPractice } from '@/lib/supabaseData';
import { toast } from 'sonner';

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
  const [form, setForm] = useState({
    name: '',
    address: '',
    phone: '',
    email: user?.email || '',
    website: '',
    practice_type: 'Private',
    opening_hours: DEFAULT_HOURS,
  });

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
        phone: form.phone,
        email: form.email,
        website: form.website,
        practice_type: form.practice_type,
        opening_hours: form.opening_hours,
        onboarding_completed: true,
      });
      toast.success('Clinic created! Welcome to Pathir.');
      navigate(`/Clinic?id=${practice.id}`);
    } catch (err) {
      toast.error(err.message || 'Failed to create clinic');
    } finally {
      setLoading(false);
    }
  };

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
            <div key={s} className="flex-1 flex items-center gap-2">
              <div className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? 'bg-slate-900' : 'bg-slate-200'}`} />
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

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => update('phone', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                      placeholder="+44 20 7946 0958"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => update('email', e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                      placeholder="reception@clinic.co.uk"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
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
                      <option value="Mixed">Mixed</option>
                    </select>
                  </div>
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
              <p className="text-slate-500 text-sm mb-6">Set your typical weekly schedule</p>

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
                    {day.is_open && (
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
                    )}
                    {!day.is_open && (
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
                      Creating...
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
