/**
 * Purpose:
 *   Diary/calendar view showing booked appointments across practitioner columns.
 *   Reads from the normalised appointments table with a fallback to legacy
 *   enquiry-based bookings.
 *
 * Dependencies:
 *   - @/lib/supabaseData (listPractitioners, listAppointmentsForDay)
 *   - @tanstack/react-query (data fetching + caching)
 *   - date-fns (date arithmetic and formatting)
 *
 * Used by:
 *   - src/pages/Clinic.jsx (rendered when currentView === 'diary')
 *
 * Changes:
 *   2026-03-16: Removed pending state — bookings go straight to confirmed.
 *   2026-03-11: Upgraded to read from appointments + appointment_requests tables,
 *               duration-proportional blocks.
 *   2026-03-10: Initial creation — enquiry-based appointments only.
 */

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameMonth, isSameDay, addMonths, subMonths, isToday,
  addDays, subDays,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, User, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  listPractitioners,
  listAppointmentsForDay,
} from '@/lib/supabaseData';

// Hours to display in the day grid (8am–6pm)
const HOURS = Array.from({ length: 11 }, (_, i) => i + 8);
const HOUR_HEIGHT = 80; // px per hour row
const GRID_START_HOUR = 8;

// Deterministic colour palette per practitioner column
const COLOURS = [
  { solid: 'bg-blue-100 text-blue-800 border-blue-200', dashed: 'bg-blue-50 text-blue-700 border-blue-300' },
  { solid: 'bg-violet-100 text-violet-800 border-violet-200', dashed: 'bg-violet-50 text-violet-700 border-violet-300' },
  { solid: 'bg-emerald-100 text-emerald-800 border-emerald-200', dashed: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
  { solid: 'bg-amber-100 text-amber-800 border-amber-200', dashed: 'bg-amber-50 text-amber-700 border-amber-300' },
  { solid: 'bg-rose-100 text-rose-800 border-rose-200', dashed: 'bg-rose-50 text-rose-700 border-rose-300' },
  { solid: 'bg-cyan-100 text-cyan-800 border-cyan-200', dashed: 'bg-cyan-50 text-cyan-700 border-cyan-300' },
];

function colourFor(index) {
  return COLOURS[index % COLOURS.length].solid;
}

/** Convert a time string or Date to total minutes since midnight. */
function toMinutes(input) {
  if (!input) return 0;
  // Handle "HH:MM" strings (from chosen_slot)
  if (typeof input === 'string' && input.includes(':') && input.length <= 5) {
    const [h, m] = input.split(':').map(Number);
    return h * 60 + m;
  }
  // Handle ISO timestamp strings or Date objects
  const d = new Date(input);
  return d.getHours() * 60 + d.getMinutes();
}

/** Format total minutes as "h:mm a" for display. */
function minutesToDisplay(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? 'pm' : 'am';
  const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${displayH}:${String(m).padStart(2, '0')} ${period}`;
}

export default function DiaryView({ enquiries, practice }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [selectedBlock, setSelectedBlock] = useState(null); // popover state

  const practiceId = practice?.id;
  const dateStr = format(selectedDay, 'yyyy-MM-dd');

  // ---- Data fetching ----

  // Practitioners from the normalised table
  const { data: dbPractitioners = [] } = useQuery({
    queryKey: ['practitioners', practiceId],
    queryFn: () => listPractitioners(practiceId),
    enabled: !!practiceId,
    staleTime: 60_000,
  });

  // Appointments for the selected day
  const { data: dbAppointments = [] } = useQuery({
    queryKey: ['appointments', practiceId, dateStr],
    queryFn: () => listAppointmentsForDay(practiceId, dateStr),
    enabled: !!practiceId,
    staleTime: 15_000,
  });

  // Email events for contacts with appointments on the selected day
  // Keyed by contact_id → latest email status
  const contactIds = useMemo(() => {
    const ids = new Set();
    dbAppointments.forEach(a => { if (a.contact?.id) ids.add(a.contact.id); });
    return [...ids];
  }, [dbAppointments]);

  const { data: emailEvents = [] } = useQuery({
    queryKey: ['email-events-diary', practiceId, contactIds.join(',')],
    queryFn: async () => {
      if (contactIds.length === 0) return [];
      const { data } = await supabase
        .from('email_events')
        .select('id, contact_id, email_type, status, sent_at, delivered_at, opened_at')
        .eq('practice_id', practiceId)
        .eq('email_type', 'appointment_confirmation')
        .in('contact_id', contactIds)
        .order('sent_at', { ascending: false });
      return data || [];
    },
    enabled: !!practiceId && contactIds.length > 0,
    staleTime: 10_000,
  });

  // Map contact_id → latest confirmation email status
  const emailStatusByContact = useMemo(() => {
    const map = {};
    emailEvents.forEach(ev => {
      // Keep only the most recent per contact
      if (!map[ev.contact_id]) map[ev.contact_id] = ev;
    });
    return map;
  }, [emailEvents]);

  // ---- Practitioner list (DB table → JSONB fallback) ----

  const practitioners = useMemo(() => {
    if (dbPractitioners.length > 0) {
      return dbPractitioners.map(p => ({
        id: p.id,
        displayName: `${p.title ? p.title + ' ' : ''}${p.name}`.trim(),
        workingHours: p.working_hours || {},
      }));
    }
    // Fallback: derive from the JSONB array on the practice row
    const jsonb = (practice?.practitioners || []).filter(p => p.name);
    if (jsonb.length > 0) {
      return jsonb.map((p, i) => ({
        id: `jsonb-${i}`,
        displayName: `${p.title ? p.title + ' ' : ''}${p.name}`.trim(),
        workingHours: {},
      }));
    }
    return [{ id: 'default', displayName: 'Practitioner 1', workingHours: {} }];
  }, [dbPractitioners, practice?.practitioners]);

  // ---- Build unified block list for the selected day ----

  const dayBlocks = useMemo(() => {
    const blocks = [];

    // 1. Confirmed appointments from the appointments table
    dbAppointments.forEach(apt => {
      const pracId = apt.practitioner?.id;
      blocks.push({
        key: `apt-${apt.id}`,
        id: apt.id,
        type: 'confirmed',
        practitionerId: pracId,
        practitionerName: apt.practitioner
          ? `${apt.practitioner.title ? apt.practitioner.title + ' ' : ''}${apt.practitioner.name}`
          : 'Unknown',
        patientName: apt.contact?.name || 'Unknown Patient',
        patientPhone: apt.contact?.phone || '',
        contactId: apt.contact?.id || null,
        serviceName: apt.service?.name || '',
        startMin: toMinutes(apt.starts_at),
        endMin: toMinutes(apt.ends_at),
        source: apt.source,
        notes: apt.notes,
        status: apt.status,
        emailStatus: apt.contact?.id ? emailStatusByContact[apt.contact.id] : null,
      });
    });

    // 2. Legacy: enquiry-based appointments (fallback for old data)
    (enquiries || []).forEach(e => {
      if (!e.appointment_datetime) return;
      try {
        if (!isSameDay(new Date(e.appointment_datetime), selectedDay)) return;
      } catch { return; }

      // Skip if we already have a proper appointment for this patient + time
      const dt = new Date(e.appointment_datetime);
      const legacyMin = dt.getHours() * 60 + dt.getMinutes();
      const isDuplicate = blocks.some(b =>
        b.patientName === e.patient_name && Math.abs(b.startMin - legacyMin) < 15
      );
      if (isDuplicate) return;

      // Match to practitioner by string name
      const pracMatch = practitioners.find(p =>
        p.displayName === e.practitioner || p.displayName.includes(e.practitioner || '')
      );

      blocks.push({
        key: `enq-${e.id}`,
        id: e.id,
        type: 'legacy',
        practitionerId: pracMatch?.id || practitioners[0]?.id,
        practitionerName: e.practitioner || practitioners[0]?.displayName || '',
        patientName: e.patient_name || 'Unknown',
        serviceName: e.selected_service || '',
        startMin: legacyMin,
        endMin: legacyMin + 30, // legacy bookings default to 30 min
        source: e.source,
        status: 'confirmed',
      });
    });

    return blocks.sort((a, b) => a.startMin - b.startMin);
  }, [dbAppointments, enquiries, dateStr, selectedDay, practitioners, emailStatusByContact]);

  // ---- Mini calendar: which days have appointments ----
  // Use a simple check — dots for days with blocks
  const getBlockCountForDay = (day) => {
    // From legacy enquiries
    const legacyCount = (enquiries || []).filter(e => {
      if (!e.appointment_datetime) return false;
      try { return isSameDay(new Date(e.appointment_datetime), day); } catch { return false; }
    }).length;

    // From DB appointments (only if same as selected day, since we only fetch one day)
    const dbCount = isSameDay(day, selectedDay) ? dbAppointments.length : 0;

    return legacyCount + dbCount;
  };

  // ---- Calendar helpers ----
  const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });
  const startPad = (startOfMonth(currentMonth).getDay() + 6) % 7;
  const totalCount = dayBlocks.length;

  // ---- Working hours for a practitioner on the selected day ----
  const getDayKey = (day) => format(day, 'EEEE').toLowerCase();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ===== Left sidebar: mini calendar + sidebar lists ===== */}
      <div className="w-64 shrink-0 border-r border-slate-100 bg-white flex flex-col px-4 py-8 overflow-y-auto">
        <h1 className="text-base font-semibold text-slate-900 mb-1">Diary</h1>
        <p className="text-xs text-slate-400 mb-6">Appointments</p>

        {/* Month navigation */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-50"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-slate-700">{format(currentMonth, 'MMM yyyy')}</span>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-50"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <div key={i} className="text-center text-[10px] font-medium text-slate-400">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-px">
          {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
          {days.map(day => {
            const count = getBlockCountForDay(day);
            const isSelected = isSameDay(day, selectedDay);
            const today = isToday(day);
            const inMonth = isSameMonth(day, currentMonth);
            return (
              <button
                key={day.toISOString()}
                onClick={() => { setSelectedDay(day); setCurrentMonth(startOfMonth(day)); }}
                className={`
                  relative flex flex-col items-center justify-center rounded-lg h-7 w-full text-[11px] font-medium transition-all
                  ${isSelected ? 'bg-slate-900 text-white' : today ? 'bg-blue-50 text-blue-700' : inMonth ? 'text-slate-700 hover:bg-slate-50' : 'text-slate-300'}
                `}
              >
                {format(day, 'd')}
                {count > 0 && (
                  <span className={`absolute bottom-0.5 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-blue-500'}`} />
                )}
              </button>
            );
          })}
        </div>

        {/* Day appointment summary */}
        <div className="mt-6">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
            {format(selectedDay, 'd MMM')} — {totalCount} appt{totalCount !== 1 ? 's' : ''}
          </p>
          {dayBlocks.length === 0 ? (
            <p className="text-xs text-slate-300 text-center py-4">Nothing booked</p>
          ) : (
            <div className="space-y-1.5">
              {dayBlocks.map(b => (
                <button
                  key={b.key}
                  onClick={() => setSelectedBlock(b)}
                  className="w-full text-left text-xs rounded-lg px-2.5 py-2 border transition-colors hover:bg-slate-100 bg-slate-50 border-slate-100"
                >
                  <p className="font-medium text-slate-800 truncate">{b.patientName}</p>
                  <p className="text-slate-400">
                    {minutesToDisplay(b.startMin)}
                    {b.endMin ? ` – ${minutesToDisplay(b.endMin)}` : ''}
                  </p>
                  {b.serviceName && <p className="text-slate-400 truncate">{b.serviceName}</p>}
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ===== Right: day grid view ===== */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
        {/* Day header bar */}
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedDay(subDays(selectedDay, 1))}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {format(selectedDay, 'EEEE, d MMMM yyyy')}
              </h2>
              {isToday(selectedDay) && <span className="text-xs text-blue-600 font-medium">Today</span>}
            </div>
            <button
              onClick={() => setSelectedDay(addDays(selectedDay, 1))}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={() => setSelectedDay(new Date())}
            className="text-xs text-slate-500 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-1.5 transition-colors"
          >
            Today
          </button>
        </div>

        {/* Timetable grid */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex min-h-full">
            {/* Time column */}
            <div className="w-16 shrink-0 border-r border-slate-100 bg-white">
              {HOURS.map(h => (
                <div key={h} className="h-20 border-b border-slate-50 flex items-start justify-end pr-3 pt-1">
                  <span className="text-[11px] text-slate-400">
                    {format(new Date(2000, 0, 1, h), 'h a')}
                  </span>
                </div>
              ))}
            </div>

            {/* Practitioner columns */}
            <div className="flex-1 flex">
              {practitioners.map((prac, pIdx) => {
                // Filter blocks that belong to this practitioner
                const pracBlocks = dayBlocks.filter(b => b.practitionerId === prac.id);

                // Check working hours for greying out unavailable times
                const dayKey = getDayKey(selectedDay);
                const wh = prac.workingHours?.[dayKey];
                const isWorkingDay = !!wh;
                const workStart = wh ? toMinutes(wh.start) : GRID_START_HOUR * 60;
                const workEnd = wh ? toMinutes(wh.end) : 18 * 60;

                return (
                  <div key={prac.id} className="flex-1 border-r border-slate-100 last:border-r-0 flex flex-col">
                    {/* Column header */}
                    <div className="h-10 bg-white border-b border-slate-100 flex items-center justify-center shrink-0">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                          COLOURS[pIdx % COLOURS.length].solid.split(' ').filter(c => c.startsWith('bg-'))[0]
                        } bg-opacity-50`}>
                          <User className="w-3 h-3 text-slate-500" />
                        </div>
                        <span className="text-xs font-medium text-slate-700 truncate max-w-[120px]">
                          {prac.displayName}
                        </span>
                      </div>
                    </div>

                    {/* Hour grid + appointment blocks */}
                    <div className="relative" style={{ height: HOURS.length * HOUR_HEIGHT }}>
                      {/* Hour gridlines + working-hours shading */}
                      {HOURS.map(h => {
                        const hourMin = h * 60;
                        const isOutsideHours = isWorkingDay && wh && (hourMin < workStart || hourMin >= workEnd);
                        return (
                          <div
                            key={h}
                            className={`absolute w-full border-b border-slate-100 ${
                              isOutsideHours ? 'bg-slate-50' : ''
                            }`}
                            style={{ top: (h - GRID_START_HOUR) * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                          />
                        );
                      })}

                      {/* Appointment blocks — positioned by start time, sized by duration */}
                      {pracBlocks.map(b => {
                        const top = ((b.startMin - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT;
                        const durationMin = Math.max(b.endMin - b.startMin, 15); // minimum 15 min display
                        const height = Math.max((durationMin / 60) * HOUR_HEIGHT, 28); // minimum 28px

                        return (
                          <button
                            key={b.key}
                            onClick={(e) => { e.stopPropagation(); setSelectedBlock(b); }}
                            style={{ top, height }}
                            className={`
                              absolute left-1 right-1 rounded-lg border px-2 py-1 text-xs
                              overflow-hidden cursor-pointer transition-shadow hover:shadow-md z-10
                              ${colourFor(pIdx)}
                            `}
                          >
                            <p className="font-semibold truncate">{b.patientName}</p>
                            <p className="truncate opacity-75">
                              {minutesToDisplay(b.startMin)}
                              {b.serviceName ? ` · ${b.serviceName}` : ''}
                            </p>
                            {/* Email status indicator */}
                            {b.emailStatus && height >= 36 && (
                              <span className={`inline-flex items-center gap-0.5 text-[9px] mt-0.5 ${
                                b.emailStatus.status === 'opened' || b.emailStatus.status === 'clicked'
                                  ? 'text-green-700'
                                  : b.emailStatus.status === 'delivered'
                                    ? 'text-blue-700'
                                    : b.emailStatus.status === 'sent'
                                      ? 'text-amber-600'
                                      : 'text-slate-400'
                              }`}>
                                {b.emailStatus.status === 'opened' || b.emailStatus.status === 'clicked'
                                  ? '✓✓ Email opened'
                                  : b.emailStatus.status === 'delivered'
                                    ? '✓ Email delivered'
                                    : b.emailStatus.status === 'sent'
                                      ? '⚠ Sent — not delivered'
                                      : ''}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ===== Appointment detail popover ===== */}
      {selectedBlock && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
          onClick={() => setSelectedBlock(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 w-full max-w-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {selectedBlock.patientName}
                </h3>
                {selectedBlock.patientPhone && (
                  <p className="text-xs text-slate-400 mt-0.5">{selectedBlock.patientPhone}</p>
                )}
              </div>
              <button
                onClick={() => setSelectedBlock(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs text-slate-600 mb-4">
              {selectedBlock.serviceName && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 w-16">Service</span>
                  <span className="font-medium">{selectedBlock.serviceName}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-slate-400 w-16">Time</span>
                <span className="font-medium">
                  {minutesToDisplay(selectedBlock.startMin)} – {minutesToDisplay(selectedBlock.endMin)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 w-16">With</span>
                <span className="font-medium">{selectedBlock.practitionerName}</span>
              </div>
              {selectedBlock.source && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 w-16">Source</span>
                  <span className="capitalize">{selectedBlock.source}</span>
                </div>
              )}
              {selectedBlock.notes && (
                <div className="flex items-start gap-2">
                  <span className="text-slate-400 w-16">Notes</span>
                  <span>{selectedBlock.notes}</span>
                </div>
              )}
              {selectedBlock.emailStatus && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 w-16">Email</span>
                  <span className={`font-medium ${
                    selectedBlock.emailStatus.status === 'opened' || selectedBlock.emailStatus.status === 'clicked'
                      ? 'text-green-600'
                      : selectedBlock.emailStatus.status === 'delivered'
                        ? 'text-blue-600'
                        : selectedBlock.emailStatus.status === 'sent'
                          ? 'text-amber-600'
                          : 'text-slate-400'
                  }`}>
                    {selectedBlock.emailStatus.status === 'opened' || selectedBlock.emailStatus.status === 'clicked'
                      ? `Opened${selectedBlock.emailStatus.opened_at ? ` ${format(new Date(selectedBlock.emailStatus.opened_at), 'h:mm a')}` : ''}`
                      : selectedBlock.emailStatus.status === 'delivered'
                        ? `Delivered${selectedBlock.emailStatus.delivered_at ? ` ${format(new Date(selectedBlock.emailStatus.delivered_at), 'h:mm a')}` : ''}`
                        : selectedBlock.emailStatus.status === 'sent'
                          ? 'Sent — not yet delivered'
                          : selectedBlock.emailStatus.status}
                  </span>
                </div>
              )}
              {selectedBlock.type === 'confirmed' && !selectedBlock.emailStatus && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 w-16">Email</span>
                  <span className="text-slate-400">No email sent</span>
                </div>
              )}
            </div>

            {/* Status badge */}
            <div className="flex items-center pt-3 border-t border-slate-100">
              <Badge className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700">
                Booked
              </Badge>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
