/**
 * Purpose:
 *   Diary/calendar view showing confirmed appointments and pending requests
 *   across practitioner columns. Reads from the normalised appointments table
 *   with a fallback to legacy enquiry-based bookings.
 *
 * Dependencies:
 *   - @/lib/supabaseData (listPractitioners, listAppointmentsForDay,
 *     listPendingRequests, confirmAppointmentRequest)
 *   - @tanstack/react-query (data fetching + caching)
 *   - date-fns (date arithmetic and formatting)
 *
 * Used by:
 *   - src/pages/Clinic.jsx (rendered when currentView === 'diary')
 *
 * Changes:
 *   2026-03-11: Upgraded to read from appointments + appointment_requests tables,
 *               duration-proportional blocks, pending request display, confirm flow.
 *   2026-03-10: Initial creation — enquiry-based appointments only.
 */

import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameMonth, isSameDay, addMonths, subMonths, isToday,
  addDays, subDays,
} from 'date-fns';
import {
  ChevronLeft, ChevronRight, User, Clock, CheckCircle2, AlertTriangle, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  listPractitioners,
  listAppointmentsForDay,
  listPendingRequests,
  confirmAppointmentRequest,
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

function colourFor(index, isPending) {
  const palette = COLOURS[index % COLOURS.length];
  return isPending ? palette.dashed : palette.solid;
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
  const [isConfirming, setIsConfirming] = useState(false);
  const queryClient = useQueryClient();

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

  // Confirmed/pending appointments for the selected day
  const { data: dbAppointments = [] } = useQuery({
    queryKey: ['appointments', practiceId, dateStr],
    queryFn: () => listAppointmentsForDay(practiceId, dateStr),
    enabled: !!practiceId,
    staleTime: 15_000,
  });

  // Pending requests awaiting confirmation
  const { data: pendingRequests = [] } = useQuery({
    queryKey: ['pending-requests', practiceId],
    queryFn: () => listPendingRequests(practiceId),
    enabled: !!practiceId,
    staleTime: 15_000,
  });

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
        serviceName: apt.service?.name || '',
        startMin: toMinutes(apt.starts_at),
        endMin: toMinutes(apt.ends_at),
        source: apt.source,
        notes: apt.notes,
        status: apt.status,
      });
    });

    // 2. Pending requests with a chosen_slot on the selected day
    pendingRequests.forEach(req => {
      const slot = req.chosen_slot;
      if (!slot?.date || slot.date !== dateStr) return;
      blocks.push({
        key: `req-${req.id}`,
        id: req.id,
        type: 'pending',
        requestData: req, // keep original for the confirm flow
        practitionerId: slot.practitioner_id || req.preferred_practitioner?.id,
        practitionerName: slot.practitioner_name || req.preferred_practitioner?.name || '',
        patientName: req.contact?.name || 'Unknown Patient',
        patientPhone: req.contact?.phone || '',
        serviceName: req.service?.name || '',
        startMin: toMinutes(slot.start_time),
        endMin: toMinutes(slot.end_time),
        source: req.source,
        notes: req.notes,
        isUrgent: req.is_urgent,
        status: req.status,
      });
    });

    // 3. Legacy: enquiry-based appointments (fallback for old data)
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
  }, [dbAppointments, pendingRequests, enquiries, dateStr, selectedDay, practitioners]);

  // ---- Pending requests without a specific time (sidebar list only) ----
  const untimedRequests = pendingRequests.filter(req => {
    const slot = req.chosen_slot;
    return !slot?.date || !slot?.start_time;
  });

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

    // From pending requests with a chosen_slot on this day
    const reqCount = pendingRequests.filter(r =>
      r.chosen_slot?.date === format(day, 'yyyy-MM-dd')
    ).length;

    return legacyCount + dbCount + reqCount;
  };

  // ---- Confirm handler ----
  const handleConfirm = async (block) => {
    if (block.type !== 'pending' || !block.requestData) return;
    setIsConfirming(true);

    const req = block.requestData;
    const slot = req.chosen_slot;

    try {
      await confirmAppointmentRequest(req.id, {
        practiceId,
        practitionerId: slot.practitioner_id || req.preferred_practitioner?.id,
        serviceId: req.service?.id,
        contactId: req.contact?.id,
        startsAt: `${slot.date}T${slot.start_time}:00Z`,
        endsAt: `${slot.date}T${slot.end_time}:00Z`,
        source: req.source || 'phone',
      });

      toast.success(`Confirmed: ${block.patientName} at ${minutesToDisplay(block.startMin)}`);
      // Refresh both queries so the diary updates
      queryClient.invalidateQueries({ queryKey: ['appointments', practiceId] });
      queryClient.invalidateQueries({ queryKey: ['pending-requests', practiceId] });
      setSelectedBlock(null);
    } catch (err) {
      toast.error(`Failed to confirm: ${err.message}`);
    } finally {
      setIsConfirming(false);
    }
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
        <p className="text-xs text-slate-400 mb-6">Appointments & pending requests</p>

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
                  className={`w-full text-left text-xs rounded-lg px-2.5 py-2 border transition-colors hover:bg-slate-100 ${
                    b.type === 'pending'
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-slate-50 border-slate-100'
                  }`}
                >
                  <p className="font-medium text-slate-800 truncate">{b.patientName}</p>
                  <p className="text-slate-400">
                    {minutesToDisplay(b.startMin)}
                    {b.endMin ? ` – ${minutesToDisplay(b.endMin)}` : ''}
                  </p>
                  {b.serviceName && <p className="text-slate-400 truncate">{b.serviceName}</p>}
                  {b.type === 'pending' && (
                    <Badge className="mt-1 bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px] px-1.5 py-0">
                      Pending
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Untimed pending requests (no specific slot chosen) */}
        {untimedRequests.length > 0 && (
          <div className="mt-6">
            <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-widest mb-2">
              Awaiting time — {untimedRequests.length} request{untimedRequests.length !== 1 ? 's' : ''}
            </p>
            <div className="space-y-1.5">
              {untimedRequests.map(req => (
                <div
                  key={req.id}
                  className="text-xs bg-amber-50 rounded-lg px-2.5 py-2 border border-amber-200"
                >
                  <p className="font-medium text-slate-800 truncate">
                    {req.contact?.name || 'Unknown'}
                    {req.is_urgent && (
                      <AlertTriangle className="inline w-3 h-3 text-rose-500 ml-1" />
                    )}
                  </p>
                  {req.service?.name && <p className="text-slate-400 truncate">{req.service.name}</p>}
                  {req.preferred_date && (
                    <p className="text-slate-400">Pref: {req.preferred_date}</p>
                  )}
                  <Badge className="mt-1 bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px] px-1.5 py-0">
                    {req.status === 'asap' ? 'ASAP' : 'Pending'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
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
                        const isPending = b.type === 'pending';

                        return (
                          <button
                            key={b.key}
                            onClick={(e) => { e.stopPropagation(); setSelectedBlock(b); }}
                            style={{ top, height }}
                            className={`
                              absolute left-1 right-1 rounded-lg border px-2 py-1 text-xs
                              overflow-hidden cursor-pointer transition-shadow hover:shadow-md z-10
                              ${colourFor(pIdx, isPending)}
                              ${isPending ? 'border-dashed border-2' : ''}
                            `}
                          >
                            <p className="font-semibold truncate">{b.patientName}</p>
                            <p className="truncate opacity-75">
                              {minutesToDisplay(b.startMin)}
                              {b.serviceName ? ` · ${b.serviceName}` : ''}
                            </p>
                            {isPending && height >= 48 && (
                              <p className="text-[10px] opacity-60 mt-0.5">Pending confirmation</p>
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
            </div>

            {/* Status badge + action buttons */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <Badge className={`text-[10px] px-2 py-0.5 ${
                selectedBlock.type === 'pending'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}>
                {selectedBlock.type === 'pending'
                  ? (selectedBlock.status === 'asap' ? 'ASAP' : 'Pending')
                  : 'Confirmed'}
              </Badge>

              {selectedBlock.type === 'pending' && (
                <button
                  onClick={() => handleConfirm(selectedBlock)}
                  disabled={isConfirming}
                  className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {isConfirming ? 'Confirming...' : 'Confirm Booking'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
