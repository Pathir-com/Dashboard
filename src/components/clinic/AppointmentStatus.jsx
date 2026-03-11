import React from 'react';
import { CalendarIcon, CheckCircle2, Clock } from 'lucide-react';
import { format } from 'date-fns';

export default function AppointmentStatus({ enquiry }) {
  const hasAppointment = enquiry.appointment_datetime && enquiry.selected_service;
  const status = enquiry.appointment_status; // 'pending' | 'confirmed' | 'cancelled' | null

  if (!hasAppointment) {
    return (
      <div className="bg-slate-50 border border-slate-200 border-dashed rounded-lg px-4 py-3 flex items-center gap-3">
        <CalendarIcon className="w-4 h-4 text-slate-400 shrink-0" />
        <p className="text-sm text-slate-400">No appointment was booked during this interaction.</p>
      </div>
    );
  }

  const isConfirmed = status === 'confirmed';

  if (isConfirmed) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex items-start gap-3">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-medium text-emerald-700 mb-0.5">Appointment Confirmed</p>
          <p className="text-sm text-slate-800 font-medium">{enquiry.selected_service}</p>
          <p className="text-sm text-slate-600">
            {format(new Date(enquiry.appointment_datetime), 'EEEE, d MMMM yyyy')} at{' '}
            {enquiry.appointment_datetime.split('T')[1]?.substring(0, 5)}
          </p>
        </div>
      </div>
    );
  }

  // Pending (yellow) — pencilled in but not yet confirmed in the diary
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3">
      <Clock className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
      <div>
        <p className="text-xs font-medium text-amber-700 mb-0.5">Appointment Pending</p>
        <p className="text-sm text-slate-800 font-medium">{enquiry.selected_service}</p>
        <p className="text-sm text-slate-600">
          {format(new Date(enquiry.appointment_datetime), 'EEEE, d MMMM yyyy')} at{' '}
          {enquiry.appointment_datetime.split('T')[1]?.substring(0, 5)}
        </p>
      </div>
    </div>
  );
}
