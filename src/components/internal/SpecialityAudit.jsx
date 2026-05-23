import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import {
  Loader2, RefreshCw, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight,
  Phone, MessageSquare, Calendar, Users, Stethoscope,
} from 'lucide-react';
import { toast } from 'sonner';

/**
 * SpecialityAudit — admin view of every practice grouped by speciality,
 * showing whether each is correctly wired (agent, number registration,
 * bookable catalog, routing) and its interaction counts. Calls the
 * admin-overview edge function (read-only). Use the Repair button to run
 * backfill-practices when something is flagged.
 */
export default function SpecialityAudit() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [expanded, setExpanded] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke('admin-overview');
      if (error) throw error;
      setData(res);
    } catch (e) {
      toast.error(e.message || 'Failed to load audit');
    } finally {
      setLoading(false);
    }
  };

  const repairAll = async () => {
    if (!confirm('Run backfill-practices across all practices? This repairs agents, catalogs, routing and registrations. Idempotent.')) return;
    setRepairing(true);
    try {
      const { error } = await supabase.functions.invoke('backfill-practices');
      if (error) throw error;
      toast.success('Backfill complete — reloading audit');
      await load();
    } catch (e) {
      toast.error(e.message || 'Backfill failed');
    } finally {
      setRepairing(false);
    }
  };

  const SPEC_LABELS = { dental: 'Dental', hair_transplant: 'Hair Transplant', unknown: 'Unspecified' };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Audit by speciality</h2>
          <p className="text-sm text-slate-500">Wiring + activity health for every practice. The database is the source of truth; this cross-checks ElevenLabs and Twilio against it.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={load} disabled={loading} variant="outline" className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {data ? 'Refresh' : 'Run audit'}
          </Button>
          {data && (
            <Button onClick={repairAll} disabled={repairing} className="gap-2">
              {repairing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Repair all
            </Button>
          )}
        </div>
      </div>

      {!data && !loading && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
          Run the audit to see every practice grouped by speciality.
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {Object.entries(data.by_speciality).map(([spec, practices]) => {
            const s = data.summary[spec] || {};
            return (
              <section key={spec}>
                <div className="flex items-center gap-2 mb-3">
                  <Stethoscope className="w-4 h-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-slate-700">{SPEC_LABELS[spec] || spec}</h3>
                  <span className="text-xs text-slate-400">
                    {s.practices} practice{s.practices === 1 ? '' : 's'} · {s.healthy} healthy · {s.with_issues} with issues
                  </span>
                </div>
                <div className="space-y-2">
                  {practices.map((p) => {
                    const open = expanded[p.id];
                    return (
                      <div key={p.id} className={`rounded-xl border ${p.ok ? 'border-slate-200' : 'border-amber-200 bg-amber-50/40'}`}>
                        <button
                          onClick={() => setExpanded((e) => ({ ...e, [p.id]: !e[p.id] }))}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left"
                        >
                          {open ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                          {p.ok
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
                          <span className="font-medium text-slate-900 flex-1">{p.name}</span>
                          <span className="hidden sm:flex items-center gap-3 text-xs text-slate-500">
                            <span title="bookable" className={`flex items-center gap-1 ${p.catalog.bookable ? 'text-emerald-600' : 'text-amber-600'}`}>
                              <Calendar className="w-3.5 h-3.5" />{p.catalog.bookable ? 'bookable' : 'not bookable'}
                            </span>
                            <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{p.interactions.enquiries}</span>
                          </span>
                          {!p.ok && <span className="text-xs font-medium text-amber-700">{p.health.length} issue{p.health.length === 1 ? '' : 's'}</span>}
                        </button>

                        {open && (
                          <div className="px-4 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                            {/* Wiring */}
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Wiring</p>
                              <Row label="Agent" ok={p.agent.exists_in_elevenlabs} value={p.agent.id ? (p.agent.exists_in_elevenlabs ? 'live' : 'missing in ElevenLabs') : 'none'} />
                              <Row label="Catalog" ok={p.catalog.bookable} value={`${p.catalog.services} services · ${p.catalog.practitioners} practitioners`} />
                              {p.number ? (
                                <>
                                  <Row label="Number" ok value={p.number.assigned} icon={<Phone className="w-3.5 h-3.5" />} />
                                  <Row label="Routing" ok={String(p.number.twilio_voice_url).includes('elevenlabs')} value={String(p.number.twilio_voice_url).includes('elevenlabs') ? 'ElevenLabs' : p.number.twilio_voice_url} />
                                  <Row label="Registration" ok={p.number.registration_matches_db} value={p.number.registration_matches_db ? 'correct agent' : `wrong agent (${p.number.elevenlabs_registered_agent || 'none'})`} />
                                </>
                              ) : (
                                <Row label="Number" ok={false} value="not assigned" icon={<Phone className="w-3.5 h-3.5" />} />
                              )}
                            </div>

                            {/* Channels + activity */}
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Channels &amp; activity</p>
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(p.integrations).filter(([k]) => k !== 'sms_provider').map(([k, v]) => (
                                  <span key={k} className={`text-[11px] px-2 py-0.5 rounded-full border ${v ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>{k.replace('_', ' ')}</span>
                                ))}
                              </div>
                              <Row label="Enquiries" value={p.interactions.enquiries} icon={<MessageSquare className="w-3.5 h-3.5" />} />
                              <Row label="Conversations" value={p.interactions.conversations} />
                              <Row label="Appointments" value={`${p.interactions.appointments} booked · ${p.interactions.appointment_requests} requests`} icon={<Calendar className="w-3.5 h-3.5" />} />
                              <Row label="Last activity" value={p.interactions.last_activity ? new Date(p.interactions.last_activity).toLocaleString('en-GB') : '—'} />
                            </div>

                            {/* Issues */}
                            {!p.ok && (
                              <div className="sm:col-span-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
                                <p className="text-xs font-semibold text-amber-800 mb-1">Issues</p>
                                <ul className="list-disc list-inside text-sm text-amber-700 space-y-0.5">
                                  {p.health.map((h, i) => <li key={i}>{h}</li>)}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, ok, icon }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-400 w-28 shrink-0 flex items-center gap-1">{icon}{label}</span>
      <span className={`flex-1 ${ok === false ? 'text-amber-700 font-medium' : ok === true ? 'text-slate-700' : 'text-slate-600'}`}>{value}</span>
    </div>
  );
}
