import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Link2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import HolidayHours from './HolidayHours';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function ClinicDetailsTab({ details, setDetails, hours, setHours, holidayHours, setHolidayHours, pearDental, setPearDental, practiceType, setPracticeType }) {
  const updateHour = (index, field, value) => {
    setHours(prev => prev.map((h, i) => i === index ? { ...h, [field]: value } : h));
  };

  return (
    <div className="space-y-8">
      {/* Practice Details */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Clinic Details</h2>
        <div className="bg-white rounded-xl border border-slate-100 p-6 space-y-5">
          <div className="mb-4">
            <Label className="text-slate-600">Clinic Name</Label>
            <Input value={details.name} onChange={e => setDetails({ ...details, name: e.target.value })} placeholder="My Dental Clinic" className="mt-1.5" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-slate-600">Address</Label>
              <Input value={details.address} onChange={e => setDetails({ ...details, address: e.target.value })} placeholder="123 High Street" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-slate-600">Practice Type</Label>
              <select
                value={practiceType}
                onChange={e => setPracticeType(e.target.value)}
                className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Select...</option>
                <option value="NHS">NHS</option>
                <option value="Private">Private</option>
                <option value="Mixed">Mixed</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-slate-600">Phone Number</Label>
              <Input value={details.phone} onChange={e => setDetails({ ...details, phone: e.target.value })} placeholder="020 1234 5678" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-slate-600">Email</Label>
              <Input value={details.email} onChange={e => setDetails({ ...details, email: e.target.value })} placeholder="hello@yourclinic.co.uk" className="mt-1.5" />
            </div>
          </div>
          <div>
            <Label className="text-slate-600">Website</Label>
            <Input value={details.website} onChange={e => setDetails({ ...details, website: e.target.value })} placeholder="https://yourclinic.co.uk" className="mt-1.5" />
          </div>
        </div>
      </section>

      {/* Opening Hours */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Opening Hours</h2>
        <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50">
          {hours.map((h, i) => (
            <div key={h.day} className="flex items-center gap-4 px-6 py-3">
              <span className="w-10 text-sm font-medium text-slate-700">{h.day.slice(0, 3)}</span>
              <Switch checked={h.is_open} onCheckedChange={val => updateHour(i, 'is_open', val)} />
              {h.is_open ? (
                <div className="flex items-center gap-2">
                  <Input type="time" value={h.open_time} onChange={e => updateHour(i, 'open_time', e.target.value)} className="w-28 text-sm" />
                  <span className="text-slate-400 text-sm">to</span>
                  <Input type="time" value={h.close_time} onChange={e => updateHour(i, 'close_time', e.target.value)} className="w-28 text-sm" />
                </div>
              ) : (
                <span className="text-sm text-slate-400">Closed</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <HolidayHours holidayHours={holidayHours} setHolidayHours={setHolidayHours} />

      {/* Pearl Dental */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Practice Management System</h2>
        <div className="bg-white rounded-xl border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center">
              <Link2 className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900">Pearl Dental</p>
              <p className="text-xs text-slate-400">Connect your Pearl Dental PMS to sync appointments and patient records</p>
            </div>
            {pearDental.connected && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                <CheckCircle2 className="w-4 h-4" /> Connected
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-600">API Key</Label>
                <Input value={pearDental.api_key} onChange={e => setPearDental({ ...pearDental, api_key: e.target.value, connected: false })} placeholder="pd_live_xxxxxxxxxxxxxxxx" className="mt-1.5 font-mono text-sm" type="password" />
              </div>
              <div>
                <Label className="text-slate-600">Practice Code</Label>
                <Input value={pearDental.practice_code} onChange={e => setPearDental({ ...pearDental, practice_code: e.target.value, connected: false })} placeholder="e.g. CLINIC001" className="mt-1.5" />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!pearDental.api_key || !pearDental.practice_code) { toast.error('Please enter your API key and practice code'); return; }
                setPearDental(prev => ({ ...prev, connected: true }));
                toast.success('Pearl Dental connected successfully');
              }}
              className="text-sm text-green-700 font-medium border border-green-200 bg-green-50 hover:bg-green-100 px-4 py-2 rounded-lg transition-colors"
            >
              Test & Connect
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}