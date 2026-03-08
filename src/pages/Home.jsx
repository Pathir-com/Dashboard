import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Phone, MessageCircle, AlertTriangle, CheckCircle2, Loader2, Bell, Calendar as CalendarIcon, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import AppointmentBooking from '../components/AppointmentBooking';

const createSlug = (name) => {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
};

export default function Home() {
  const [expandedId, setExpandedId] = useState(null);
  const [selectedPractice, setSelectedPractice] = useState(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoadingPractice, setIsLoadingPractice] = useState(true);
  const queryClient = useQueryClient();
  const previousCountRef = useRef(0);

  // Redirect to Internal page if pathname is /internal
  useEffect(() => {
    const pathname = window.location.pathname;
    if (pathname === '/internal') {
      window.location.href = createPageUrl('Internal');
      return;
    }
  }, []);

  // Get current user (optional - only for admin features)
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const isAuth = await base44.auth.isAuthenticated();
        if (isAuth) {
          const user = await base44.auth.me();
          setCurrentUser(user);
        }
      } catch (err) {
        // User not authenticated - that's fine
      }
    };
    fetchUser();
  }, []);

  // Get practice from URL pathname
  useEffect(() => {
    const pathname = window.location.pathname;
    const slug = pathname.replace(/^\//, '').replace(/\/$/, '');
    
    if (!slug) {
      setIsLoadingPractice(false);
      return;
    }
    
    try {
      base44.entities.Practice.list()
        .then(practices => {
          const practice = practices.find(p => createSlug(p.name) === slug);
          if (practice) {
            setSelectedPractice(practice);
          }
          setIsLoadingPractice(false);
        })
        .catch(err => {
          console.error('Failed to load practices:', err);
          setIsLoadingPractice(false);
        });
    } catch (err) {
      console.error('Error fetching practice:', err);
      setIsLoadingPractice(false);
    }
  }, []);

  const { data: enquiries = [], isLoading } = useQuery({
    queryKey: ['enquiries', selectedPractice?.id],
    queryFn: async () => {
      if (!selectedPractice?.id) return [];
      const rawEnquiries = await base44.entities.Enquiry.filter({ practice_id: selectedPractice.id }, '-created_date');
      return rawEnquiries.map(e => ({
        ...e,
        ...(e.data || {}),
      }));
    },
    enabled: !!selectedPractice?.id && isAuthenticated
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Enquiry.update(id, data),
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
        {/* Back Button - Admin Only */}
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

  // Separate pending and completed
  const pendingEnquiries = enquiries.filter(e => !e.is_completed).sort((a, b) => {
    if (a.is_urgent !== b.is_urgent) return a.is_urgent ? -1 : 1;
    return new Date(b.created_date) - new Date(a.created_date);
  });

  const completedEnquiries = enquiries.filter(e => e.is_completed).sort((a, b) => {
    return new Date(b.created_date) - new Date(a.created_date);
  });

  const pendingCount = pendingEnquiries.length;
  const urgentCount = pendingEnquiries.filter(e => e.is_urgent).length;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-12 pt-20 md:pt-12">
        {/* Logo */}
        <div className="absolute top-6 left-6">
          <img 
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69598d89634866d811371736/596c9f930_squareblackbackground.png" 
            alt="Pathir"
            className="h-10 w-10 rounded-lg shadow-sm"
          />
        </div>

        {/* Back Button - Admin Only */}
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

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">
            {selectedPractice.name}
          </h1>
          <div className="flex gap-4 mt-3">
            <span className="text-slate-500 text-sm">
              {pendingCount} pending
            </span>
            {urgentCount > 0 && (
              <span className="text-rose-500 text-sm font-medium">
                {urgentCount} urgent
              </span>
            )}
          </div>
        </div>

        {/* Pending Enquiries */}
        {pendingEnquiries.length > 0 && (
          <div className="space-y-3 mb-8">
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide">
              Pending
            </h2>
            <AnimatePresence>
              {pendingEnquiries.map((enquiry) => (
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
                    {/* Checkbox */}
                    <motion.div 
                      className="pt-0.5" 
                      onClick={(e) => e.stopPropagation()}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Checkbox
                        checked={enquiry.is_completed}
                        onCheckedChange={() => handleToggleComplete(enquiry)}
                        className={`
                          w-5 h-5 rounded-full border-2 transition-all duration-300
                          ${enquiry.is_completed 
                            ? 'bg-emerald-500 border-emerald-500 shadow-sm shadow-emerald-200' 
                            : 'border-slate-300 hover:border-slate-400 hover:scale-110'
                          }
                        `}
                      />
                    </motion.div>

                    {/* Content */}
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
                            {/* Conversation Accordion */}
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

                            {/* Appointment Booking Accordion */}
                            <AccordionItem value="booking" className="border-none">
                              <AccordionTrigger className="bg-slate-50 rounded-lg px-4 py-2 hover:no-underline">
                                <div className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-2">
                                  <CalendarIcon className="w-4 h-4" />
                                  Book Appointment
                                </div>
                              </AccordionTrigger>
                              <AccordionContent className="mt-1">
                                <AppointmentBooking 
                                  enquiry={enquiry}
                                  onUpdate={() => queryClient.invalidateQueries({ queryKey: ['enquiries'] })}
                                />
                              </AccordionContent>
                            </AccordionItem>
                          </Accordion>
                        </motion.div>
                      )}

                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                        {/* Source indicator */}
                        <span className="flex items-center gap-1.5">
                          {enquiry.source === 'phone' ? (
                            <>
                              <Phone className="w-3.5 h-3.5" />
                              Phone
                            </>
                          ) : (
                            <>
                              <MessageCircle className="w-3.5 h-3.5" />
                              Website
                            </>
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
        )}

        {/* Completed Enquiries */}
        {completedEnquiries.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide">
              Completed
            </h2>
            <AnimatePresence>
              {completedEnquiries.map((enquiry) => (
                <motion.div
                  key={enquiry.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  onClick={() => toggleExpand(enquiry.id)}
                  className="rounded-xl p-5 shadow-sm border border-slate-100 opacity-60 cursor-pointer hover:shadow-md transition-all duration-300"
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.6)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)'
                  }}
                >
                  <div className="flex items-start gap-4">
                    <motion.div 
                      className="pt-0.5" 
                      onClick={(e) => e.stopPropagation()}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Checkbox
                        checked={enquiry.is_completed}
                        onCheckedChange={() => handleToggleComplete(enquiry)}
                        className="w-5 h-5 rounded-full border-2 transition-all duration-300 bg-emerald-500 border-emerald-500 shadow-sm shadow-emerald-200"
                      />
                    </motion.div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1.5">
                        <span className="font-medium text-slate-400 line-through">
                          {enquiry.patient_name}
                        </span>
                      </div>

                      <p className="text-sm leading-relaxed mb-3 text-slate-400">
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
                            {/* Conversation Accordion */}
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

                            {/* Appointment Booking Accordion */}
                            <AccordionItem value="booking" className="border-none">
                              <AccordionTrigger className="bg-slate-50 rounded-lg px-4 py-2 hover:no-underline">
                                <div className="text-xs font-medium text-slate-500 uppercase tracking-wide flex items-center gap-2">
                                  <CalendarIcon className="w-4 h-4" />
                                  Book Appointment
                                </div>
                              </AccordionTrigger>
                              <AccordionContent className="mt-1">
                                <AppointmentBooking 
                                  enquiry={enquiry}
                                  onUpdate={() => queryClient.invalidateQueries({ queryKey: ['enquiries'] })}
                                />
                              </AccordionContent>
                            </AccordionItem>
                          </Accordion>
                        </motion.div>
                      )}

                      <div className="flex items-center gap-4 text-xs text-slate-400">
                        <span className="flex items-center gap-1.5">
                          {enquiry.source === 'phone' ? (
                            <>
                              <Phone className="w-3.5 h-3.5" />
                              Phone
                            </>
                          ) : (
                            <>
                              <MessageCircle className="w-3.5 h-3.5" />
                              Website
                            </>
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
        )}

        {/* Empty state */}
        {pendingEnquiries.length === 0 && completedEnquiries.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 stroke-1" />
            <p>No enquiries yet</p>
          </div>
        )}
      </div>
    </div>
  );
}