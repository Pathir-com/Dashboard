import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useAuth } from '@/lib/AuthContext';
import { getPractice as getSupabasePractice, listEnquiries as listSupabaseEnquiries, updateEnquiry as updateSupabaseEnquiry } from '@/lib/supabaseData';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Phone, MessageCircle, AlertTriangle, CheckCircle2, Loader2, Bell, Calendar as CalendarIcon, ArrowLeft, ChevronLeft, ChevronRight, Mail, Facebook, Instagram } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, addMonths, subMonths, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import AppointmentStatus from '../components/clinic/AppointmentStatus';
import ClinicSidebar from '../components/clinic/ClinicSidebar';
import ClinicSettings from '../components/clinic/ClinicSettings';
import DiaryView from '../components/clinic/DiaryView';

export default function Clinic() {
  const [currentView, setCurrentView] = useState('enquiries');
  const [expandedId, setExpandedId] = useState(null);
  const [dateRange, setDateRange] = useState({ start: new Date(), end: new Date() });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [selectedPractice, setSelectedPractice] = useState(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoadingPractice, setIsLoadingPractice] = useState(true);
  const queryClient = useQueryClient();
  const previousCountRef = useRef(0);
  const { user: authUser, logout } = useAuth();
  const navigate = useNavigate();

  // Get practice from URL parameter — try Supabase first, fall back to localStorage
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const practiceId = urlParams.get('id');

    if (!practiceId) {
      setIsLoadingPractice(false);
      return;
    }

    // Try Supabase first
    getSupabasePractice(practiceId)
      .then(practice => {
        if (practice) {
          setSelectedPractice(practice);
          setCurrentUser({ role: 'clinic_owner' });
        }
        setIsLoadingPractice(false);
      })
      .catch(() => {
        // Fall back to localStorage (demo data)
        base44.entities.Practice.list()
          .then(practices => {
            const practice = practices.find(p => p.id === practiceId);
            if (practice) {
              setSelectedPractice(practice);
            }
            setIsLoadingPractice(false);
          })
          .catch(err => {
            console.error('Failed to load practice:', err);
            setIsLoadingPractice(false);
          });
      });
  }, []);

  const { data: enquiries = [], isLoading } = useQuery({
    queryKey: ['enquiries', selectedPractice?.id],
    queryFn: async () => {
      if (!selectedPractice?.id) return [];
      try {
        // Try Supabase first
        const supabaseEnquiries = await listSupabaseEnquiries(selectedPractice.id, '-created_at');
        if (supabaseEnquiries && supabaseEnquiries.length >= 0) {
          return supabaseEnquiries.map(e => ({ ...e, created_date: e.created_date || e.created_at }));
        }
      } catch {
        // Fall back to localStorage
      }
      const rawEnquiries = await base44.entities.Enquiry.filter({ practice_id: selectedPractice.id }, '-created_date');
      return rawEnquiries.map(e => ({
        ...e,
        ...(e.data || {}),
      }));
    },
    enabled: !!selectedPractice?.id && isAuthenticated
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      try {
        return await updateSupabaseEnquiry(id, data);
      } catch {
        return base44.entities.Enquiry.update(id, data);
      }
    },
    onSuccess: (updatedEntity) => {
      // Flatten the returned entity before it updates the cache
      const flattened = {
        ...updatedEntity,
        ...(updatedEntity.data || {}),
      };
      queryClient.setQueryData(['enquiries', selectedPractice?.id], (old) => {
        if (!old) return old;
        return old.map(e => e.id === flattened.id ? flattened : e);
      });
    },
  });

  // Notification for new enquiries
  useEffect(() => {
    if (!isLoading && enquiries.length > 0) {
      const pendingEnquiries = enquiries.filter(e => !e.is_completed);
      if (previousCountRef.current > 0 && pendingEnquiries.length > previousCountRef.current) {
        const newCount = pendingEnquiries.length - previousCountRef.current;
        toast.success(`${newCount} new enquiry received!`, {
          icon: <Bell className="w-4 h-4" />,
          duration: 5000,
        });
      }
      previousCountRef.current = pendingEnquiries.length;
    }
  }, [enquiries, isLoading]);

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (passwordInput === selectedPractice?.password) {
      setIsAuthenticated(true);
      toast.success('Access granted');
    } else {
      toast.error('Incorrect password');
    }
  };

  if (isLoadingPractice) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!selectedPractice) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center text-slate-400">
          <p>No practice found</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        {currentUser?.role === 'admin' && (
          <div className="absolute top-6 right-6">
            <Link to={createPageUrl('Internal')}>
              <Button variant="outline" size="sm" className="gap-2">
                <ArrowLeft className="w-4 h-4" />
                Back to Practices
              </Button>
            </Link>
          </div>
        )}
        
        <div className="rounded-xl shadow-lg p-8 w-full max-w-md" style={{
          backgroundColor: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.3)'
        }}>
          <div className="text-center mb-6">
            <img 
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69598d89634866d811371736/596c9f930_squareblackbackground.png" 
              alt="Pathir"
              className="h-16 w-16 rounded-lg shadow-sm mx-auto mb-4"
            />
            <h1 className="text-2xl font-bold text-slate-900 mb-2">{selectedPractice.name}</h1>
            <p className="text-slate-500">Enter password to access dashboard</p>
          </div>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <Input
              type="password"
              placeholder="Password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              className="text-lg"
              autoFocus
            />
            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700">
              Access Dashboard
            </Button>
          </form>
        </div>
      </div>
    );
  }

  const handleToggleComplete = (enquiry) => {
    updateMutation.mutate({
      id: enquiry.id,
      data: { is_completed: !enquiry.is_completed },
    });
  };

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const filteredEnquiries = enquiries
    .filter(e => {
      const d = new Date(e.created_date);
      return isWithinInterval(d, { start: startOfDay(dateRange.start), end: endOfDay(dateRange.end) });
    })
    .sort((a, b) => {
      if (a.is_urgent !== b.is_urgent) return a.is_urgent ? -1 : 1;
      return new Date(b.created_date) - new Date(a.created_date);
    });

  const urgentCount = filteredEnquiries.filter(e => e.is_urgent && !e.is_completed).length;

  const isSameDate = isSameDay(dateRange.start, dateRange.end);
  const dateLabel = isSameDate
    ? (isToday(dateRange.start) ? 'Today' : format(dateRange.start, 'd MMM yyyy'))
    : `${format(dateRange.start, 'd MMM')} – ${format(dateRange.end, 'd MMM yyyy')}`;

  const handleDayClick = (day) => {
    if (!selectingEnd) {
      setDateRange({ start: day, end: day });
      setSelectingEnd(true);
    } else {
      const start = dateRange.start <= day ? dateRange.start : day;
      const end = dateRange.start <= day ? day : dateRange.start;
      setDateRange({ start, end });
      setSelectingEnd(false);
      setCalendarOpen(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <ClinicSidebar currentView={currentView} onNavigate={setCurrentView} />

      <div className="flex-1">
        {currentView === 'settings' ? (
          <ClinicSettings
            practice={selectedPractice}
            onUpdate={(updated) => setSelectedPractice(updated)}
          />
        ) : currentView === 'diary' ? (
          <DiaryView enquiries={enquiries} practice={selectedPractice} />
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-12">
            {currentUser?.role === 'admin' && (
              <div className="absolute top-6 right-6">
                <Link to={createPageUrl('Internal')}>
                  <Button variant="outline" size="sm" className="gap-2">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Practices
                  </Button>
                </Link>
              </div>
            )}

            <div className="mb-8">
              <div className="flex items-center gap-3">
                <Popover open={calendarOpen} onOpenChange={(o) => { setCalendarOpen(o); if (!o) setSelectingEnd(false); }}>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                      <CalendarIcon className="w-4 h-4 text-slate-400" />
                      {dateLabel}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-4" align="start">
                    <div className="flex items-center justify-between mb-3">
                      <button onClick={() => setCalendarMonth(subMonths(calendarMonth, 1))} className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-50">
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-sm font-semibold text-slate-700">{format(calendarMonth, 'MMMM yyyy')}</span>
                      <button onClick={() => setCalendarMonth(addMonths(calendarMonth, 1))} className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-50">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-7 mb-1">
                      {['M','T','W','T','F','S','S'].map((d,i) => (
                        <div key={i} className="text-center text-[10px] font-medium text-slate-400 w-8">{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-px">
                      {Array.from({ length: (startOfMonth(calendarMonth).getDay() + 6) % 7 }).map((_, i) => <div key={`p${i}`} className="w-8 h-8" />)}
                      {eachDayOfInterval({ start: startOfMonth(calendarMonth), end: endOfMonth(calendarMonth) }).map(day => {
                        const isStart = isSameDay(day, dateRange.start);
                        const isEnd = isSameDay(day, dateRange.end);
                        const inRange = isWithinInterval(day, { start: startOfDay(dateRange.start), end: endOfDay(dateRange.end) });
                        const today = isToday(day);
                        return (
                          <button
                            key={day.toISOString()}
                            onClick={() => handleDayClick(day)}
                            className={`w-8 h-8 rounded-lg text-[11px] font-medium transition-all
                              ${isStart || isEnd ? 'bg-slate-900 text-white' : inRange ? 'bg-slate-100 text-slate-700' : today ? 'text-blue-600 font-bold' : 'text-slate-600 hover:bg-slate-50'}
                            `}
                          >
                            {format(day, 'd')}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => { setDateRange({ start: new Date(), end: new Date() }); setCalendarOpen(false); setSelectingEnd(false); }} className="text-xs text-slate-500 hover:text-slate-900 border border-slate-200 rounded px-2 py-1">Today</button>
                      <span className="text-xs text-slate-400 flex items-center">{selectingEnd ? 'Now select end date' : 'Select start date'}</span>
                    </div>
                  </PopoverContent>
                </Popover>
                <span className="text-sm text-slate-400">{filteredEnquiries.length} enquir{filteredEnquiries.length !== 1 ? 'ies' : 'y'}</span>
                {urgentCount > 0 && <span className="text-sm text-rose-500 font-medium">{urgentCount} urgent</span>}
              </div>
            </div>

            {filteredEnquiries.length > 0 ? (
          <div className="space-y-3 mb-8">
            <AnimatePresence>
              {filteredEnquiries.map((enquiry) => (
                <motion.div
                  key={enquiry.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  onClick={() => toggleExpand(enquiry.id)}
                  className={`
                    rounded-xl p-5 shadow-sm border transition-all duration-300 cursor-pointer hover:shadow-md
                    ${enquiry.is_completed 
                      ? 'border-slate-100 opacity-60' 
                      : enquiry.is_urgent 
                        ? 'border-rose-200 shadow-rose-50' 
                        : 'border-slate-100'
                    }
                  `}
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.6)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)'
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1.5">
                        <span className={`
                          font-medium text-slate-900
                          ${enquiry.is_completed ? 'line-through text-slate-400' : ''}
                        `}>
                          {enquiry.patient_name}
                        </span>
                        
                        {enquiry.is_urgent && !enquiry.is_completed && (
                          <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 text-xs font-medium px-2 py-0.5">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            Urgent
                          </Badge>
                        )}
                      </div>

                      <p className={`
                        text-sm leading-relaxed mb-3
                        ${enquiry.is_completed ? 'text-slate-400' : 'text-slate-600'}
                      `}>
                        {expandedId === enquiry.id ? enquiry.message : (
                          enquiry.message.length > 80 
                            ? enquiry.message.substring(0, 80) + '...' 
                            : enquiry.message
                        )}
                      </p>

                      {expandedId === enquiry.id && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="mb-3 space-y-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Accordion type="single" collapsible className="space-y-2">
                            <AccordionItem value="conversation" className="border-none">
                              <AccordionTrigger className="bg-slate-50 rounded-lg px-4 py-2 hover:no-underline">
                                <div className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-2">
                                  <MessageCircle className="w-4 h-4" />
                                  Conversation
                                </div>
                              </AccordionTrigger>
                              <AccordionContent className="bg-slate-50 rounded-lg p-4 max-h-96 overflow-y-auto mt-1">
                                {enquiry.conversation && enquiry.conversation.length > 0 ? (
                                  <div className="space-y-3">
                                    {enquiry.conversation.map((msg, idx) => (
                                      <div
                                        key={idx}
                                        className={`flex ${msg.role === 'patient' ? 'justify-end' : 'justify-start'}`}
                                      >
                                        <div className={`
                                          max-w-[80%] rounded-2xl px-4 py-2.5
                                          ${msg.role === 'patient' 
                                            ? 'bg-blue-600 text-white' 
                                            : 'bg-white text-slate-700 border border-slate-200'
                                          }
                                        `}>
                                          <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                            {msg.message}
                                          </p>
                                          {msg.timestamp && (
                                            <p className={`
                                              text-xs mt-1
                                              ${msg.role === 'patient' ? 'text-blue-100' : 'text-slate-400'}
                                            `}>
                                              {format(new Date(msg.timestamp), 'h:mm a')}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-slate-400 text-center py-4">
                                    No conversation recorded
                                  </p>
                                )}
                              </AccordionContent>
                            </AccordionItem>

                            <AccordionItem value="booking" className="border-none">
                             <AccordionTrigger className="bg-slate-50 rounded-lg px-4 py-2 hover:no-underline">
                               <div className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-2">
                                 <CalendarIcon className="w-4 h-4" />
                                 Appointment
                               </div>
                             </AccordionTrigger>
                             <AccordionContent className="mt-1">
                               <AppointmentStatus enquiry={enquiry} />
                             </AccordionContent>
                            </AccordionItem>
                          </Accordion>
                        </motion.div>
                      )}

                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                        <span className="flex items-center gap-1.5">
                          {enquiry.source === 'phone' ? (
                            <><Phone className="w-3.5 h-3.5" /> Phone</>
                          ) : enquiry.source === 'sms' ? (
                            <><MessageCircle className="w-3.5 h-3.5" /> SMS</>
                          ) : enquiry.source === 'email' ? (
                            <><Mail className="w-3.5 h-3.5" /> Email</>
                          ) : enquiry.source === 'facebook' ? (
                            <><Facebook className="w-3.5 h-3.5 text-[#1877F2]" /> Messenger</>
                          ) : enquiry.source === 'instagram' ? (
                            <><Instagram className="w-3.5 h-3.5 text-[#E1306C]" /> Instagram</>
                          ) : (
                            <><MessageCircle className="w-3.5 h-3.5" /> Website</>
                          )}
                        </span>

                        {enquiry.phone_number && (
                          <span>{enquiry.phone_number}</span>
                        )}

                        <span>
                          {format(new Date(enquiry.created_date), 'd MMM yy, HH:mm')}
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <div className="text-center py-16 text-slate-400">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 stroke-1" />
            <p>No enquiries for this period</p>
          </div>
        )}
          </div>
        )}
      </div>
    </div>
  );
}