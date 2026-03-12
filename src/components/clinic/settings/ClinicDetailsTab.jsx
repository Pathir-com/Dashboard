/**
 * Purpose:
 *   Settings tab for basic clinic information, opening hours, holiday closures,
 *   and PMS integration. Phone and email fields become read-only when their
 *   respective integrations are active (prevents accidental edits to connected numbers).
 *
 * Dependencies:
 *   - @/components/ui (Input, Label, Switch)
 *   - ./HolidayHours (holiday closure sub-component)
 *
 * Used by:
 *   - src/components/clinic/ClinicSettings.jsx (activeTab === 'clinic')
 *
 * Changes:
 *   2026-03-11: Added read-only phone/email display when integration is enabled.
 *   2026-03-09: Initial creation.
 */

import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Phone, Mail } from 'lucide-react';
import HolidayHours from './HolidayHours';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function ClinicDetailsTab({ details, setDetails, hours, setHours, holidayHours, setHolidayHours, integrations, practiceType, setPracticeType }) {
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
              {/* Read-only when phone integration is active — prevents accidental edits to the Twilio-connected number */}
              {integrations?.phone_enabled && details.phone ? (
                <div className="mt-1.5 flex h-9 w-full items-center rounded-md border border-slate-100 bg-slate-50 px-3 text-sm text-slate-700 gap-2">
                  <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  {details.phone}
                </div>
              ) : (
                <Input value={details.phone} onChange={e => setDetails({ ...details, phone: e.target.value })} placeholder="020 1234 5678" className="mt-1.5" />
              )}
            </div>
            <div>
              <Label className="text-slate-600">Email</Label>
              {/* Read-only when email integration is active */}
              {integrations?.email_enabled && details.email ? (
                <div className="mt-1.5 flex h-9 w-full items-center rounded-md border border-slate-100 bg-slate-50 px-3 text-sm text-slate-700 gap-2">
                  <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  {details.email}
                </div>
              ) : (
                <Input value={details.email} onChange={e => setDetails({ ...details, email: e.target.value })} placeholder="hello@yourclinic.co.uk" className="mt-1.5" />
              )}
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
    </div>
  );
}