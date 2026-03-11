import React, { useState, useEffect } from 'react';
import { listEmailEvents } from '@/lib/supabaseData';
import { Mail, CheckCircle2, Eye, MousePointerClick, Loader2, Send } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';

const STATUS_CONFIG = {
  sent:      { label: 'Sent',      color: 'text-slate-500', bg: 'bg-slate-100',  icon: Send },
  delivered: { label: 'Delivered', color: 'text-blue-600',  bg: 'bg-blue-50',    icon: CheckCircle2 },
  opened:    { label: 'Opened',   color: 'text-green-600', bg: 'bg-green-50',   icon: Eye },
  clicked:   { label: 'Clicked',  color: 'text-purple-600', bg: 'bg-purple-50', icon: MousePointerClick },
  failed:    { label: 'Failed',   color: 'text-red-600',   bg: 'bg-red-50',     icon: Mail },
};

export default function EmailFollowUp({ enquiryId, practiceId, patientName, contactId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contactEmail, setContactEmail] = useState(null);

  useEffect(() => {
    if (!enquiryId) return;
    loadEvents();
  }, [enquiryId]);

  useEffect(() => {
    if (!contactId) return;
    supabase
      .from('contacts')
      .select('email')
      .eq('id', contactId)
      .single()
      .then(({ data }) => {
        if (data?.email) setContactEmail(data.email);
      });
  }, [contactId]);

  async function loadEvents() {
    try {
      const data = await listEmailEvents(enquiryId);
      setEvents(data);
    } catch (err) {
      console.error('Failed to load email events', err);
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

  return (
    <div className="space-y-3">
      {events.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-2">No emails sent yet</p>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => {
            const cfg = STATUS_CONFIG[ev.status] || STATUS_CONFIG.sent;
            const Icon = cfg.icon;
            return (
              <div key={ev.id} className="flex items-start gap-3 bg-white rounded-lg border border-slate-100 p-3">
                <div className={`p-1.5 rounded-full ${cfg.bg}`}>
                  <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-700 truncate">
                      {ev.subject || ev.email_type}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    To: {ev.recipient_email}
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

      {contactEmail && (
        <p className="text-xs text-slate-400 text-center">
          Patient email: {contactEmail}
        </p>
      )}
    </div>
  );
}
