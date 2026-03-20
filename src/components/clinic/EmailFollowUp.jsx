import React, { useState, useEffect } from 'react';
import { listEmailEvents, listSmsEvents } from '@/lib/supabaseData';
import { Mail, CheckCircle2, Eye, MousePointerClick, Loader2, Send, MessageCircle, Phone } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';

const STATUS_CONFIG = {
  sent:      { label: 'Sent',      color: 'text-slate-500', bg: 'bg-slate-100',  icon: Send },
  delivered: { label: 'Delivered', color: 'text-blue-600',  bg: 'bg-blue-50',    icon: CheckCircle2 },
  opened:    { label: 'Opened',   color: 'text-green-600', bg: 'bg-green-50',   icon: Eye },
  clicked:   { label: 'Clicked',  color: 'text-purple-600', bg: 'bg-purple-50', icon: MousePointerClick },
  failed:    { label: 'Failed',   color: 'text-red-600',   bg: 'bg-red-50',     icon: Mail },
};

const TYPE_LABELS = {
  confirmation: 'Booking Confirmation',
  reminder: 'Day-Before Reminder',
  payment_link: 'Payment Link',
  receipt: 'Payment Receipt',
  new_patient_welcome: 'Welcome Email',
  appointment_confirmation: 'Booking Confirmation',
  email_verification: 'Email Verification',
};

export default function EmailFollowUp({ enquiryId, practiceId, patientName, contactId }) {
  const [emailEvents, setEmailEvents] = useState([]);
  const [smsEvents, setSmsEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contactInfo, setContactInfo] = useState({ email: null, phone: null });

  useEffect(() => {
    if (!enquiryId) return;
    loadEvents();
  }, [enquiryId]);

  useEffect(() => {
    if (!contactId) return;
    supabase
      .from('contacts')
      .select('email, phone')
      .eq('id', contactId)
      .single()
      .then(({ data }) => {
        if (data) setContactInfo({ email: data.email, phone: data.phone });
      });
  }, [contactId]);

  async function loadEvents() {
    try {
      const [emails, sms] = await Promise.all([
        listEmailEvents(enquiryId),
        listSmsEvents(enquiryId),
      ]);
      setEmailEvents(emails);
      setSmsEvents(sms);
    } catch (err) {
      console.error('Failed to load follow-up events', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
      </div>
    );
  }

  const allEvents = [
    ...emailEvents.map(ev => ({ ...ev, channel: 'email' })),
    ...smsEvents.map(ev => ({ ...ev, channel: 'sms' })),
  ].sort((a, b) => new Date(b.sent_at || b.created_at) - new Date(a.sent_at || a.created_at));

  return (
    <div className="space-y-3">
      {allEvents.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-2">No follow-ups sent yet</p>
      ) : (
        <div className="space-y-2">
          {allEvents.map((ev) => {
            const isEmail = ev.channel === 'email';
            const cfg = STATUS_CONFIG[ev.status] || STATUS_CONFIG.sent;
            const Icon = isEmail ? cfg.icon : MessageCircle;
            const typeLabel = isEmail
              ? TYPE_LABELS[ev.email_type] || ev.email_type
              : TYPE_LABELS[ev.sms_type] || ev.sms_type;

            return (
              <div key={ev.id} className="flex items-start gap-3 bg-white rounded-lg border border-slate-100 p-3">
                <div className={`p-1.5 rounded-full ${isEmail ? cfg.bg : 'bg-emerald-50'}`}>
                  <Icon className={`w-3.5 h-3.5 ${isEmail ? cfg.color : 'text-emerald-600'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-700 truncate">
                      {isEmail ? (ev.subject || typeLabel) : typeLabel}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${isEmail ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      {isEmail ? 'Email' : 'SMS'}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    To: {isEmail ? ev.recipient_email : ev.recipient_phone}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                    {ev.sent_at && (
                      <span>Sent {format(new Date(ev.sent_at), 'MMM d, h:mm a')}</span>
                    )}
                    {ev.opened_at && (
                      <span className="text-green-600">
                        Opened {format(new Date(ev.opened_at), 'MMM d, h:mm a')}
                        {ev.opened_count > 1 && ` (${ev.opened_count}x)`}
                      </span>
                    )}
                    {ev.clicked_at && (
                      <span className="text-purple-600">
                        Clicked {format(new Date(ev.clicked_at), 'MMM d, h:mm a')}
                        {ev.clicked_count > 1 && ` (${ev.clicked_count}x)`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(contactInfo.email || contactInfo.phone) && (
        <div className="flex items-center justify-center gap-4 text-xs text-slate-400">
          {contactInfo.email && <span>Email: {contactInfo.email}</span>}
          {contactInfo.phone && <span>Phone: {contactInfo.phone}</span>}
        </div>
      )}
    </div>
  );
}
