import React, { useState } from 'react';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameMonth, isSameDay, addMonths, subMonths, isToday,
  addDays, subDays, getHours, getMinutes
} from 'date-fns';
import { ChevronLeft, ChevronRight, CalendarDays, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// Hours to show in the day view
const HOURS = Array.from({ length: 11 }, (_, i) => i + 8); // 8am–6pm

// Derive a colour per practitioner name (deterministic)
const COLOURS = [
  'bg-blue-100 text-blue-800 border-blue-200',
  'bg-violet-100 text-violet-800 border-violet-200',
  'bg-emerald-100 text-emerald-800 border-emerald-200',
  'bg-amber-100 text-amber-800 border-amber-200',
  'bg-rose-100 text-rose-800 border-rose-200',
  'bg-cyan-100 text-cyan-800 border-cyan-200',
];

function colourFor(name, practitioners) {
  const idx = practitioners.indexOf(name);
  return COLOURS[idx % COLOURS.length];
}

export default function DiaryView({ enquiries, practice }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date());

  const bookedEnquiries = enquiries.filter(e => e.appointment_datetime);

  const getAppointmentsForDay = (day) =>
    bookedEnquiries.filter(e => {
      try { return isSameDay(new Date(e.appointment_datetime), day); } catch { return false; }
    });

  const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });
  const startPad = (startOfMonth(currentMonth).getDay() + 6) % 7;

  const dayAppointments = getAppointmentsForDay(selectedDay)
    .sort((a, b) => new Date(a.appointment_datetime) - new Date(b.appointment_datetime));

  // Use practitioners from practice settings, fall back to those referenced in appointments
  const practicePractitioners = (practice?.practitioners || []).map(p =>
    `${p.title ? p.title + ' ' : ''}${p.name}`.trim()
  ).filter(Boolean);

  const practitioners = practicePractitioners.length > 0
    ? practicePractitioners
    : [...new Set(dayAppointments.map(e => e.practitioner || 'Practitioner 1'))];

  if (practitioners.length === 0) practitioners.push('Practitioner 1');

  // Map appointments to their hour slot
  const apptsByHour = {};
  dayAppointments.forEach(e => {
    const h = getHours(new Date(e.appointment_datetime));
    if (!apptsByHour[h]) apptsByHour[h] = [];
    apptsByHour[h].push(e);
  });

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left: compact mini calendar */}
      <div className="w-64 shrink-0 border-r border-slate-100 bg-white flex flex-col px-4 py-8 overflow-y-auto">
        <h1 className="text-base font-semibold text-slate-900 mb-1">Diary</h1>
        <p className="text-xs text-slate-400 mb-6">Proactive diary management</p>

        {/* Month nav */}
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

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <div key={i} className="text-center text-[10px] font-medium text-slate-400">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-px">
          {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
          {days.map(day => {
            const appts = getAppointmentsForDay(day);
            const isSelected = isSameDay(day, selectedDay);
            const today = isToday(day);
            const inMonth = isSameMonth(day, currentMonth);
            return (
              <button
                key={day.toISOString()}
                onClick={() => {
                  setSelectedDay(day);
                  setCurrentMonth(startOfMonth(day));
                }}
                className={`
                  relative flex flex-col items-center justify-center rounded-lg h-7 w-full text-[11px] font-medium transition-all
                  ${isSelected ? 'bg-slate-900 text-white' : today ? 'bg-blue-50 text-blue-700' : inMonth ? 'text-slate-700 hover:bg-slate-50' : 'text-slate-300'}
                `}
              >
                {format(day, 'd')}
                {appts.length > 0 && (
                  <span className={`absolute bottom-0.5 w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-blue-500'}`} />
                )}
              </button>
            );
          })}
        </div>

        {/* Upcoming appointments list */}
        <div className="mt-6">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
            {format(selectedDay, 'd MMM')} — {dayAppointments.length} appt{dayAppointments.length !== 1 ? 's' : ''}
          </p>
          {dayAppointments.length === 0 ? (
            <p className="text-xs text-slate-300 text-center py-4">Nothing booked</p>
          ) : (
            <div className="space-y-1.5">
              {dayAppointments.map(e => (
                <div key={e.id} className="text-xs bg-slate-50 rounded-lg px-2.5 py-2 border border-slate-100">
                  <p className="font-medium text-slate-800 truncate">{e.patient_name}</p>
                  <p className="text-slate-400">{format(new Date(e.appointment_datetime), 'h:mm a')}</p>
                  {e.selected_service && <p className="text-slate-400 truncate">{e.selected_service}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: day view */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
        {/* Day header */}
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedDay(subDays(selectedDay, 1))}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-base font-semibold text-slate-900">{format(selectedDay, 'EEEE, d MMMM yyyy')}</h2>
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

        {/* Timetable */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex min-h-full">
            {/* Time column */}
            <div className="w-16 shrink-0 border-r border-slate-100 bg-white">
              {HOURS.map(h => (
                <div key={h} className="h-20 border-b border-slate-50 flex items-start justify-end pr-3 pt-1">
                  <span className="text-[11px] text-slate-400">{format(new Date(2000, 0, 1, h), 'h a')}</span>
                </div>
              ))}
            </div>

            {/* Practitioner columns */}
            <div className="flex-1 flex">
              {practitioners.map((prac, pIdx) => (
                <div key={prac} className="flex-1 border-r border-slate-100 last:border-r-0">
                  {/* Column header */}
                  <div className="h-10 bg-white border-b border-slate-100 flex items-center justify-center">
                    <div className="flex items-center gap-1.5">
                      <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
                        <User className="w-3 h-3 text-slate-500" />
                      </div>
                      <span className="text-xs font-medium text-slate-700">{prac}</span>
                    </div>
                  </div>

                  {/* Hour slots */}
                  {HOURS.map(h => {
                    const slotAppts = (apptsByHour[h] || []).filter(
                      e => (e.practitioner || 'Practitioner 1') === prac
                    );
                    return (
                      <div key={h} className="h-20 border-b border-slate-100 relative px-1 py-0.5">
                        {slotAppts.map(e => {
                          const mins = getMinutes(new Date(e.appointment_datetime));
                          const topOffset = (mins / 60) * 80; // 80px = h-20
                          return (
                            <div
                              key={e.id}
                              style={{ top: topOffset }}
                              className={`absolute left-1 right-1 rounded-lg border px-2 py-1 text-xs ${colourFor(prac, practitioners)}`}
                            >
                              <p className="font-semibold truncate">{e.patient_name}</p>
                              <p className="truncate opacity-75">
                                {format(new Date(e.appointment_datetime), 'h:mm a')}
                                {e.selected_service ? ` · ${e.selected_service}` : ''}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}