import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Calendar as CalendarIcon, Send, Loader2 } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

const SERVICES = [
  'General Checkup',
  'Teeth Cleaning',
  'Fillings',
  'Root Canal',
  'Crowns & Bridges',
  'Teeth Whitening',
  'Dental Implants',
  'Orthodontics',
  'Emergency Care',
  'Other'
];

const TIME_SLOTS = [
  '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00', '17:30', '18:00'
];

export default function AppointmentBooking({ enquiry, onUpdate }) {
  // Single persistent boolean for confirmed state
  const [showConfirmedPanel, setShowConfirmedPanel] = useState(() => {
    return enquiry.confirmation_sent && enquiry.selected_service && enquiry.appointment_datetime;
  });
  
  const [showTickAnimation, setShowTickAnimation] = useState(false);
  const [service, setService] = useState(enquiry.selected_service || '');
  const [appointmentDate, setAppointmentDate] = useState(
    enquiry.appointment_datetime ? new Date(enquiry.appointment_datetime) : null
  );
  const [appointmentTime, setAppointmentTime] = useState(
    enquiry.appointment_datetime ? enquiry.appointment_datetime.split('T')[1]?.substring(0, 5) : ''
  );
  const [includeDeposit, setIncludeDeposit] = useState(enquiry.include_deposit_link || false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Reset state when enquiry changes or confirmation status changes
  useEffect(() => {
    const hasConfirmation = enquiry.confirmation_sent && enquiry.selected_service && enquiry.appointment_datetime;
    setShowConfirmedPanel(hasConfirmation);
    setService(enquiry.selected_service || '');
    setAppointmentDate(enquiry.appointment_datetime ? new Date(enquiry.appointment_datetime) : null);
    setAppointmentTime(enquiry.appointment_datetime ? enquiry.appointment_datetime.split('T')[1]?.substring(0, 5) : '');
    setIncludeDeposit(enquiry.include_deposit_link || false);
  }, [enquiry.id, enquiry.confirmation_sent, enquiry.selected_service, enquiry.appointment_datetime]);

  const handleSendConfirmation = async () => {
    if (!service || !appointmentDate || !appointmentTime) {
      toast.error('Please select a service and appointment time');
      return;
    }

    if (!enquiry.phone_number) {
      toast.error('No phone number available for this enquiry');
      return;
    }

    // Step 1: Show tick animation overlay
    setShowTickAnimation(true);
    
    // Step 2: After tick animation, show confirmed panel
    setTimeout(() => {
      setShowTickAnimation(false);
      setShowConfirmedPanel(true);
    }, 800);

    try {
      const currentUser = await base44.auth.me();
      const dateStr = format(appointmentDate, 'yyyy-MM-dd');
      const appointmentDateTime = `${dateStr}T${appointmentTime}`;
      
      await base44.entities.Enquiry.update(enquiry.id, {
        selected_service: service,
        appointment_datetime: appointmentDateTime,
        include_deposit_link: includeDeposit,
        confirmation_sent: true,
        confirmation_sent_date: new Date().toISOString()
      });

      const formattedDate = new Date(appointmentDateTime).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      let message = `Hi ${enquiry.patient_name}, your appointment for ${service} is confirmed for ${formattedDate} at ${appointmentTime}.`;
      
      if (includeDeposit && currentUser.deposit_link) {
        message += `\n\nPlease complete your deposit payment here: ${currentUser.deposit_link}`;
      }
      
      message += '\n\nIf you need to reschedule, please contact us. See you soon!';

      await base44.integrations.Core.SendEmail({
        to: enquiry.phone_number + '@sms-gateway.com',
        subject: 'Appointment Confirmation',
        body: message
      });

      toast.success('Confirmation sent successfully!');

    } catch (error) {
      setShowTickAnimation(false);
      setShowConfirmedPanel(false);
      toast.error('Failed to send confirmation');
      console.error(error);
    }
  };

  // Tick animation overlay (temporary visual feedback)
  if (showTickAnimation) {
    return (
      <motion.div
        key="tick-animation"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-slate-50 rounded-lg p-8 flex flex-col items-center justify-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center mb-3"
        >
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-white text-3xl"
          >
            ✓
          </motion.span>
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-slate-700 font-medium"
        >
          Confirmation sent
        </motion.p>
      </motion.div>
    );
  }

  // Persistent confirmed panel (post-send UI)
  if (showConfirmedPanel) {
    return (
      <div className="bg-gradient-to-br from-emerald-50 to-green-50 rounded-lg p-4 border border-emerald-200">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <div className="text-xs text-emerald-600 font-medium flex items-center gap-1.5">
              <span className="text-base">✓</span> Appointment Confirmed
            </div>
            <div className="text-sm text-slate-900 font-medium">
              {service}
            </div>
            <div className="text-sm text-slate-600">
              {appointmentDate && appointmentTime && (
                <>
                  {format(appointmentDate, 'EEEE, MMMM d, yyyy')} at {appointmentTime}
                </>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConfirmedPanel(false)}
            className="text-xs border-emerald-300 hover:bg-emerald-100"
          >
            Change appointment
          </Button>
        </div>
      </div>
    );
  }

  // Booking form (editing state)
  return (
    <div className="bg-slate-50 rounded-lg p-4 space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-slate-600">Service</Label>
        <Select value={service} onValueChange={setService}>
          <SelectTrigger className="bg-white" onClick={(e) => e.stopPropagation()}>
            <SelectValue placeholder="Select service" />
          </SelectTrigger>
          <SelectContent>
            {SERVICES.map((svc) => (
              <SelectItem key={svc} value={svc}>
                {svc}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-xs text-slate-600">Date</Label>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-start text-left font-normal bg-white"
                onClick={(e) => e.stopPropagation()}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {appointmentDate ? format(appointmentDate, 'PPP') : 'Pick a date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start" onClick={(e) => e.stopPropagation()}>
              <Calendar
                mode="single"
                selected={appointmentDate}
                onSelect={(date) => {
                  setAppointmentDate(date);
                  setCalendarOpen(false);
                }}
                disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-slate-600">Time</Label>
          <Select value={appointmentTime} onValueChange={setAppointmentTime}>
            <SelectTrigger className="bg-white" onClick={(e) => e.stopPropagation()}>
              <SelectValue placeholder="Select time" />
            </SelectTrigger>
            <SelectContent>
              {TIME_SLOTS.map((time) => (
                <SelectItem key={time} value={time}>
                  {time}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          id={`deposit-${enquiry.id}`}
          checked={includeDeposit}
          onCheckedChange={setIncludeDeposit}
        />
        <Label
          htmlFor={`deposit-${enquiry.id}`}
          className="text-sm text-slate-600 cursor-pointer"
        >
          Include deposit payment link
        </Label>
      </div>

      <Button
        onClick={handleSendConfirmation}
        disabled={!service || !appointmentDate || !appointmentTime}
        className="w-full bg-blue-600 hover:bg-blue-700"
      >
        <Send className="w-4 h-4 mr-2" />
        Send Confirmation SMS
      </Button>
    </div>
  );
}