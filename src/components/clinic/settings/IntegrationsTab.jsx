import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Phone, MessageCircle, Mail, Globe, Facebook, Instagram,
  CreditCard, Loader2, Check, AlertCircle, Copy, CheckCircle2, Link2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { togglePhoneAgent } from '@/lib/twilioService';

/* ── Channel + integration card definitions ── */

const CHANNELS = [
  { key: 'phone_enabled', icon: Phone, iconColor: 'text-blue-600', bgColor: 'bg-blue-50', borderColor: 'border-blue-100', label: 'Phone Agent', description: 'AI answers every incoming call instantly, 24/7 — no missed calls.' },
  { key: 'sms_enabled', icon: MessageCircle, iconColor: 'text-green-600', bgColor: 'bg-green-50', borderColor: 'border-green-100', label: 'SMS', description: 'Appointment confirmations and reminders via text.' },
  { key: 'email_enabled', icon: Mail, iconColor: 'text-violet-600', bgColor: 'bg-violet-50', borderColor: 'border-violet-100', label: 'Email', description: 'Send appointment confirmations, follow-ups, and payment links.' },
  { key: 'web_chat_enabled', icon: Globe, iconColor: 'text-slate-600', bgColor: 'bg-slate-50', borderColor: 'border-slate-200', label: 'Web Chat', description: 'AI chat widget engages website visitors before they leave.' },
  { key: 'facebook_enabled', icon: Facebook, iconColor: 'text-[#1877F2]', bgColor: 'bg-blue-50', borderColor: 'border-blue-100', label: 'Facebook Messenger', description: 'AI handles all Facebook Messenger DMs on your behalf.' },
  { key: 'instagram_enabled', icon: Instagram, iconColor: 'text-[#E1306C]', bgColor: 'bg-pink-50', borderColor: 'border-pink-100', label: 'Instagram DMs', description: 'AI responds to Instagram Direct Messages automatically.' },
];

const CONNECT_ITEMS = [
  { key: 'stripe', icon: CreditCard, iconColor: 'text-[#635BFF]', bgColor: 'bg-indigo-50', borderColor: 'border-indigo-100', label: 'Stripe', description: 'Accept payments, deposits, and payment links.' },
];

const PMS_SYSTEMS = [
  { id: 'pearl', key: 'pms_pearl', icon: Link2, iconColor: 'text-green-600', bgColor: 'bg-green-50', borderColor: 'border-green-100', label: 'Pearl Dental', description: 'Sync appointments and patient records.' },
  { id: 'aerona', key: 'pms_aerona', icon: Link2, iconColor: 'text-blue-600', bgColor: 'bg-blue-50', borderColor: 'border-blue-100', label: 'Aerona Dental', description: 'Connect your Aerona practice management system.' },
];

export default function IntegrationsTab({
  practice,
  integrations,
  setIntegrations,
  onAssignNumber,
  isAssigningNumber,
  pearDental,
  setPearDental,
}) {
  const twilioNumber = practice?.twilio_phone_number;
  const hasNumber = !!twilioNumber;

  const [expanded, setExpanded] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [isTogglingPhone, setIsTogglingPhone] = useState(false);
  const [phoneCopied, setPhoneCopied] = useState(false);

  // Form state
  const [stripeKey, setStripeKey] = useState(integrations.stripe_publishable_key || '');
  const [stripeSecret, setStripeSecret] = useState(integrations.stripe_secret_key || '');
  const [fbPageId, setFbPageId] = useState(integrations.facebook_page_id || '');
  const [fbAccessToken, setFbAccessToken] = useState(integrations.facebook_access_token || '');
  const [igBusinessId, setIgBusinessId] = useState(integrations.instagram_business_id || '');
  const [igAccessToken, setIgAccessToken] = useState(integrations.instagram_access_token || '');
  const [pmsApiKey, setPmsApiKey] = useState(pearDental?.api_key || '');
  const [pmsPracticeCode, setPmsPracticeCode] = useState(pearDental?.practice_code || '');

  // Email verification state
  const [emailAddress, setEmailAddress] = useState(practice?.email || '');
  const [emailCode, setEmailCode] = useState('');
  const [emailStep, setEmailStep] = useState(
    integrations.email_verified ? 'verified' : 'input'
  );
  const [isSendingCode, setIsSendingCode] = useState(false);

  /* ── Connected status ── */
  const isConnected = {
    phone_enabled: hasNumber && integrations.phone_enabled,
    sms_enabled: hasNumber && integrations.sms_enabled !== false,
    web_chat_enabled: !!practice?.elevenlabs_agent_id,
    email_enabled: !!integrations.email_enabled && !!integrations.email_verified,
    facebook_enabled: !!integrations.facebook_page_id,
    instagram_enabled: !!integrations.instagram_business_id,
    stripe: !!integrations.stripe_connected,
    pms_pearl: !!pearDental?.connected,
    pms_aerona: false,
  };

  function openPanel(key) {
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (key === 'stripe') { setStripeKey(integrations.stripe_publishable_key || ''); setStripeSecret(integrations.stripe_secret_key || ''); }
    if (key === 'facebook_enabled') { setFbPageId(integrations.facebook_page_id || ''); setFbAccessToken(integrations.facebook_access_token || ''); }
    if (key === 'instagram_enabled') { setIgBusinessId(integrations.instagram_business_id || ''); setIgAccessToken(integrations.instagram_access_token || ''); }
    if (key === 'pms_pearl') { setPmsApiKey(pearDental?.api_key || ''); setPmsPracticeCode(pearDental?.practice_code || ''); }
  }

  /* ── Channel toggle handler (some need setup first) ── */
  async function handleChannelClick(key) {
    const needsPanel = ['email_enabled', 'web_chat_enabled', 'facebook_enabled', 'instagram_enabled'];
    if (needsPanel.includes(key)) {
      openPanel(key);
      return;
    }
    if (key === 'phone_enabled') {
      if (!hasNumber) { await onAssignNumber(); return; }
      openPanel('phone_enabled');
      return;
    }
    setIntegrations({ ...integrations, [key]: !integrations[key] });
  }

  /* ── Handlers ── */
  async function handleStripeConnect() {
    const pk = stripeKey.trim();
    const sk = stripeSecret.trim();
    if (!pk.startsWith('pk_test_') && !pk.startsWith('pk_live_')) { toast.error('Publishable key must start with pk_test_ or pk_live_'); return; }
    if (!sk.startsWith('sk_test_') && !sk.startsWith('sk_live_') && !sk.startsWith('rk_test_') && !sk.startsWith('rk_live_')) { toast.error('Secret key must start with sk_test_ or sk_live_'); return; }
    const skMode = sk.includes('_test_') ? 'test' : 'live';
    const updated = { ...integrations, stripe_publishable_key: pk, stripe_secret_key: sk, stripe_connected: true, stripe_mode: skMode };
    try {
      const { error } = await supabase.from('practices').update({ integrations: updated }).eq('id', practice?.id);
      if (error) throw error;
      setIntegrations(updated);
      toast.success(`Stripe connected (${skMode} mode)`); setExpanded(null);
    } catch (err) { console.error('Failed to save Stripe keys:', err); toast.error('Failed to save Stripe keys'); }
  }

  async function handleStripeDisconnect() {
    const { stripe_publishable_key, stripe_secret_key, stripe_connected, stripe_mode, ...rest } = integrations;
    try {
      const { error } = await supabase.from('practices').update({ integrations: rest }).eq('id', practice?.id);
      if (error) throw error;
      setIntegrations(rest); setStripeKey(''); setStripeSecret('');
      toast.success('Stripe disconnected'); setExpanded(null);
    } catch (err) { console.error(err); toast.error('Failed to disconnect Stripe'); }
  }

  async function handleFacebookConnect() {
    if (!fbPageId.trim() || !fbAccessToken.trim()) { toast.error('Page ID and Access Token are required'); return; }
    setIsVerifying(true);
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${fbPageId}?access_token=${fbAccessToken}`);
      if (!res.ok) throw new Error('Invalid Page ID or Access Token');
      const page = await res.json();
      const updated = { ...integrations, facebook_page_id: fbPageId.trim(), facebook_access_token: fbAccessToken.trim(), facebook_page_name: page.name || '', facebook_enabled: true };
      const { error } = await supabase.from('practices').update({ integrations: updated }).eq('id', practice?.id);
      if (error) throw error;
      setIntegrations(updated);
      toast.success(`Facebook connected: ${page.name || fbPageId}`); setExpanded(null);
    } catch (err) { toast.error(err.message); } finally { setIsVerifying(false); }
  }

  async function handleFacebookDisconnect() {
    const { facebook_page_id, facebook_access_token, facebook_page_name, facebook_enabled, ...rest } = integrations;
    try {
      const { error } = await supabase.from('practices').update({ integrations: rest }).eq('id', practice?.id);
      if (error) throw error;
      setIntegrations(rest); setFbPageId(''); setFbAccessToken('');
      toast.success('Facebook Messenger disconnected'); setExpanded(null);
    } catch (err) { toast.error('Failed to disconnect Facebook'); console.error(err); }
  }

  async function handleInstagramConnect() {
    if (!igBusinessId.trim() || !igAccessToken.trim()) { toast.error('Business Account ID and Access Token are required'); return; }
    setIsVerifying(true);
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${igBusinessId}?fields=name,username&access_token=${igAccessToken}`);
      if (!res.ok) throw new Error('Invalid Business Account ID or Access Token');
      const account = await res.json();
      const updated = { ...integrations, instagram_business_id: igBusinessId.trim(), instagram_access_token: igAccessToken.trim(), instagram_username: account.username || '', instagram_enabled: true };
      const { error } = await supabase.from('practices').update({ integrations: updated }).eq('id', practice?.id);
      if (error) throw error;
      setIntegrations(updated);
      toast.success(`Instagram connected: @${account.username || igBusinessId}`); setExpanded(null);
    } catch (err) { toast.error(err.message); } finally { setIsVerifying(false); }
  }

  async function handleInstagramDisconnect() {
    const { instagram_business_id, instagram_access_token, instagram_username, instagram_enabled, ...rest } = integrations;
    try {
      const { error } = await supabase.from('practices').update({ integrations: rest }).eq('id', practice?.id);
      if (error) throw error;
      setIntegrations(rest); setIgBusinessId(''); setIgAccessToken('');
      toast.success('Instagram disconnected'); setExpanded(null);
    } catch (err) { toast.error('Failed to disconnect Instagram'); console.error(err); }
  }

  async function handlePmsConnect() {
    const key = pmsApiKey.trim();
    const code = pmsPracticeCode.trim();
    if (!key || !code) { toast.error('Please enter your API key and practice code'); return; }
    const updated = { api_key: key, practice_code: code, connected: true };
    try {
      const { error } = await supabase.from('practices').update({ pear_dental: updated }).eq('id', practice?.id);
      if (error) throw error;
      setPearDental(updated);
      toast.success('Pearl Dental connected'); setExpanded(null);
    } catch (err) { toast.error('Failed to connect Pearl Dental'); console.error(err); }
  }

  async function handlePmsDisconnect() {
    const updated = { api_key: '', practice_code: '', connected: false };
    try {
      const { error } = await supabase.from('practices').update({ pear_dental: updated }).eq('id', practice?.id);
      if (error) throw error;
      setPearDental(updated); setPmsApiKey(''); setPmsPracticeCode('');
      toast.success('Pearl Dental disconnected'); setExpanded(null);
    } catch (err) { toast.error('Failed to disconnect Pearl Dental'); console.error(err); }
  }

  async function handleSendVerification() {
    const email = emailAddress.trim();
    if (!email || !email.includes('@')) { toast.error('Please enter a valid email address'); return; }
    setIsSendingCode(true);
    try {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const updatedIntegrations = { ...integrations, email_verification_code: code, email_verification_email: email, email_verification_sent_at: new Date().toISOString() };
      setIntegrations(updatedIntegrations);
      await supabase.from('practices').update({ integrations: updatedIntegrations }).eq('id', practice?.id);
      const { error: sendError } = await supabase.functions.invoke('send-email', { body: { to: email, type: 'email_verification', practice_id: practice?.id, data: { code } } });
      if (sendError) throw sendError;
      toast.success(`Verification code sent to ${email}`);
      setEmailStep('code');
    } catch (err) { toast.error('Failed to send verification code'); console.error(err); } finally { setIsSendingCode(false); }
  }

  async function handleVerifyCode() {
    const stored = integrations.email_verification_code;
    if (!stored || emailCode.trim() !== stored) { toast.error('Incorrect code — please check and try again'); return; }
    const sentAt = integrations.email_verification_sent_at;
    if (sentAt && Date.now() - new Date(sentAt).getTime() > 10 * 60 * 1000) { toast.error('Code expired — please request a new one'); setEmailStep('input'); return; }
    const verifiedEmail = integrations.email_verification_email || emailAddress.trim();
    const updatedIntegrations = { ...integrations, email_enabled: true, email_verified: true, email_from: verifiedEmail, email_verification_code: null, email_verification_sent_at: null, email_verification_email: null };
    try {
      const { error } = await supabase.from('practices').update({ integrations: updatedIntegrations, email: verifiedEmail }).eq('id', practice?.id);
      if (error) throw error;
      setIntegrations(updatedIntegrations); setEmailStep('verified');
      toast.success('Email verified and enabled'); setExpanded(null);
    } catch (err) { console.error(err); toast.error('Verification matched but failed to save — please try again'); }
  }

  async function handleEmailDisconnect() {
    const updatedIntegrations = { ...integrations, email_enabled: false, email_verified: false, email_from: null };
    try {
      await supabase.from('practices').update({ integrations: updatedIntegrations }).eq('id', practice?.id);
      setIntegrations(updatedIntegrations); setEmailStep('input');
      toast.success('Email disconnected'); setExpanded(null);
    } catch (err) { console.error(err); toast.error('Failed to disconnect — please try again'); }
  }

  /* ── Phone agent toggle handlers ── */
  async function handlePhoneDisconnect() {
    setIsTogglingPhone(true);
    try {
      const updated = { ...integrations, phone_enabled: false };
      const { error } = await supabase.from('practices').update({ integrations: updated }).eq('id', practice?.id);
      if (error) throw error;
      setIntegrations(updated);
      toast.success('Phone agent disconnected');
      setExpanded(null);
      // Update Twilio routing in the background (non-blocking)
      togglePhoneAgent(practice.id, false).catch(err => console.error('Twilio routing update failed:', err));
    } catch (err) {
      console.error(err);
      toast.error('Failed to disconnect phone agent');
    } finally {
      setIsTogglingPhone(false);
    }
  }

  async function handlePhoneReconnect() {
    setIsTogglingPhone(true);
    try {
      const updated = { ...integrations, phone_enabled: true };
      const { error } = await supabase.from('practices').update({ integrations: updated }).eq('id', practice?.id);
      if (error) throw error;
      setIntegrations(updated);
      toast.success('Phone agent reconnected');
      setExpanded(null);
      // Update Twilio routing in the background (non-blocking)
      togglePhoneAgent(practice.id, true).catch(err => console.error('Twilio routing update failed:', err));
    } catch (err) {
      console.error(err);
      toast.error('Failed to reconnect phone agent');
    } finally {
      setIsTogglingPhone(false);
    }
  }

  /* ── Status dot colour ── */
  function dotColor(key) {
    if (isConnected[key]) return 'bg-emerald-400';
    if (expanded === key) return 'bg-amber-400';
    return 'bg-slate-200';
  }

  /* ── Render a card ── */
  function renderCard({ key, icon: Icon, iconColor, bgColor, borderColor, label, description }, onClick) {
    const active = isConnected[key] || expanded === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onClick(key)}
        disabled={key === 'phone_enabled' && isAssigningNumber}
        className={`relative flex flex-col items-start rounded-xl border p-4 text-left transition-all ${
          active ? 'bg-white border-slate-300 shadow-sm' : 'bg-slate-50/50 border-slate-100 hover:bg-white hover:border-slate-200'
        }`}
      >
        <div className={`w-10 h-10 rounded-xl ${bgColor} border ${borderColor} flex items-center justify-center mb-3`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <p className={`text-sm font-semibold leading-tight ${active ? 'text-slate-900' : 'text-slate-500'}`}>{label}</p>
        <p className="text-[11px] text-slate-400 mt-1 leading-snug line-clamp-2">{description}</p>
        <div className={`absolute top-3 right-3 w-2 h-2 rounded-full ${dotColor(key)}`} />
      </button>
    );
  }

  /* ── Detail panel content ── */
  function renderPanel() {
    if (!expanded) return null;
    return (
      <AnimatePresence>
        <motion.div
          key={expanded}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="bg-white rounded-xl border border-slate-200 p-5 mt-3 relative">
            <button onClick={() => setExpanded(null)} className="absolute top-3 right-3 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-50">
              <X className="w-4 h-4" />
            </button>

            {/* ── Phone Agent ── */}
            {expanded === 'phone_enabled' && twilioNumber && (
              <div className="space-y-3 max-w-sm">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-sm font-semibold text-slate-900">Phone Agent</p>
                  {integrations.phone_enabled
                    ? <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50">Connected</Badge>
                    : <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">Disconnected</Badge>
                  }
                </div>

                {/* Assigned number with copy button */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">Your AI phone number</Label>
                  <div className="flex items-center gap-1.5">
                    <Input readOnly value={twilioNumber} className={`font-mono text-xs h-8 bg-slate-50 ${integrations.phone_enabled ? 'text-slate-700' : 'text-slate-400'}`} />
                    <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => {
                      navigator.clipboard.writeText(twilioNumber);
                      setPhoneCopied(true);
                      toast.success('Phone number copied');
                      setTimeout(() => setPhoneCopied(false), 2000);
                    }}>
                      {phoneCopied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>

                {!integrations.phone_enabled && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 text-xs text-amber-700">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Callers will hear a message that the automated receptionist is unavailable.</span>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  {integrations.phone_enabled ? (
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                      disabled={isTogglingPhone} onClick={handlePhoneDisconnect}>
                      {isTogglingPhone ? <><Loader2 className="w-3 h-3 animate-spin mr-1.5" /> Disconnecting</> : 'Disconnect'}
                    </Button>
                  ) : (
                    <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                      disabled={isTogglingPhone} onClick={handlePhoneReconnect}>
                      {isTogglingPhone ? <><Loader2 className="w-3 h-3 animate-spin mr-1.5" /> Reconnecting</> : 'Reconnect'}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* ── Web Chat embed ── */}
            {expanded === 'web_chat_enabled' && practice?.elevenlabs_agent_id && (() => {
              const snippet = `<script\n  src="https://amxcposgqlmgapzoopze.supabase.co/storage/v1/object/public/widget/pathir-chat.js"\n  data-agent-id="${practice.elevenlabs_agent_id}"\n  data-token-url="https://amxcposgqlmgapzoopze.supabase.co/functions/v1/chat-token"\n  data-title="${practice.name || 'Chat with us'}"\n  data-subtitle="Ask Poppy anything"\n  data-accent="#3072ff"\n></script>`;
              return (
                <div className="space-y-3 max-w-md">
                  <p className="text-sm font-semibold text-slate-900 mb-2">Web Chat — Embed Code</p>
                  <p className="text-xs text-slate-500">Add this snippet before the closing <code className="bg-slate-100 px-1 rounded">&lt;/body&gt;</code> tag:</p>
                  <div className="relative">
                    <pre className="bg-slate-900 text-slate-200 text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">{snippet}</pre>
                    <button
                      onClick={() => { navigator.clipboard.writeText(snippet); setEmbedCopied(true); toast.success('Embed code copied'); setTimeout(() => setEmbedCopied(false), 2000); }}
                      className="absolute top-2 right-2 p-1.5 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                    >
                      {embedCopied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">Works on Framer, WordPress, Squarespace, Wix, or any HTML page.</p>
                </div>
              );
            })()}

            {/* ── Email verification ── */}
            {expanded === 'email_enabled' && (
              <div className="space-y-3 max-w-sm">
                <p className="text-sm font-semibold text-slate-900 mb-2">Email — Verification</p>
                {emailStep === 'verified' ? (
                  <>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <div>
                        <p className="text-xs font-medium text-emerald-800">Email verified</p>
                        <p className="text-xs text-emerald-600">{integrations.email_from || practice?.email}</p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-500">Change email address</Label>
                      <div className="flex gap-2">
                        <Input type="email" placeholder="new@example.com" value={emailAddress !== (integrations.email_from || practice?.email) ? emailAddress : ''} onChange={(e) => setEmailAddress(e.target.value)} className="text-xs h-8" />
                        <Button size="sm" className="h-8 text-xs shrink-0" variant="outline" disabled={isSendingCode || !emailAddress.trim() || emailAddress === (integrations.email_from || practice?.email)} onClick={handleSendVerification}>
                          {isSendingCode ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Verify new'}
                        </Button>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={handleEmailDisconnect}>Disconnect email</Button>
                  </>
                ) : emailStep === 'code' ? (
                  <>
                    <p className="text-xs text-slate-500">We sent a 6-digit code to <strong>{integrations.email_verification_email || emailAddress}</strong>.</p>
                    <div className="flex gap-2">
                      <Input placeholder="123456" value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="font-mono text-xs h-8 w-32 tracking-widest" maxLength={6} />
                      <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white" disabled={emailCode.length !== 6} onClick={handleVerifyCode}>Verify</Button>
                    </div>
                    <button className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2" onClick={() => { setEmailStep('input'); setEmailCode(''); }}>Use a different email</button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-slate-500">Enter the email address patients will see when they receive emails from your practice.</p>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-500">Practice email</Label>
                      <Input type="email" placeholder="reception@example.com" value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} className="text-xs h-8" />
                    </div>
                    <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white" disabled={isSendingCode || !emailAddress.trim() || !emailAddress.includes('@')} onClick={handleSendVerification}>
                      {isSendingCode ? <><Loader2 className="w-3 h-3 animate-spin mr-1.5" /> Sending code</> : 'Send verification code'}
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* ── Stripe ── */}
            {expanded === 'stripe' && (
              <div className="space-y-3 max-w-sm">
                <p className="text-sm font-semibold text-slate-900 mb-2">Stripe — API Keys</p>
                <div className="space-y-1.5"><Label className="text-xs text-slate-500">Publishable Key</Label><Input placeholder="pk_test_..." value={stripeKey} onChange={(e) => setStripeKey(e.target.value)} className="font-mono text-xs h-8" /></div>
                <div className="space-y-1.5"><Label className="text-xs text-slate-500">Secret Key</Label><Input type="password" placeholder="sk_test_..." value={stripeSecret} onChange={(e) => setStripeSecret(e.target.value)} className="font-mono text-xs h-8" /></div>
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 text-xs text-slate-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Find your keys in the <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer" className="text-[#635BFF] underline underline-offset-2">Stripe Dashboard</a>. Use test keys first.</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" className="h-7 text-xs bg-[#635BFF] hover:bg-[#5851ea] text-white" disabled={isVerifying || !stripeKey || !stripeSecret} onClick={handleStripeConnect}>
                    {isConnected.stripe ? <><Check className="w-3 h-3 mr-1.5" /> Update</> : 'Connect'}
                  </Button>
                  {isConnected.stripe && <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={handleStripeDisconnect}>Disconnect</Button>}
                </div>
              </div>
            )}

            {/* ── Facebook ── */}
            {expanded === 'facebook_enabled' && (
              <div className="space-y-3 max-w-sm">
                <p className="text-sm font-semibold text-slate-900 mb-2">Facebook Messenger — Connect</p>
                {isConnected.facebook_enabled && <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 text-xs text-green-700"><CheckCircle2 className="w-3.5 h-3.5" /><span>Connected: {integrations.facebook_page_name || integrations.facebook_page_id}</span></div>}
                <div className="space-y-1.5"><Label className="text-xs text-slate-500">Page ID</Label><Input placeholder="123456789012345" value={fbPageId} onChange={(e) => setFbPageId(e.target.value)} className="font-mono text-xs h-8" /></div>
                <div className="space-y-1.5"><Label className="text-xs text-slate-500">Page Access Token</Label><Input type="password" placeholder="EAAGm..." value={fbAccessToken} onChange={(e) => setFbAccessToken(e.target.value)} className="font-mono text-xs h-8" /></div>
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 text-xs text-slate-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Get credentials from the <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="text-[#1877F2] underline underline-offset-2">Meta Graph API Explorer</a>. Needs <code className="bg-slate-200 px-1 rounded">pages_messaging</code>.</span>
                </div>
                {isConnected.facebook_enabled && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">Webhook URL</Label>
                    <div className="flex items-center gap-1.5">
                      <Input readOnly value="https://amxcposgqlmgapzoopze.supabase.co/functions/v1/meta-webhook" className="font-mono text-xs h-8 bg-slate-50 text-slate-500" />
                      <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => { navigator.clipboard.writeText('https://amxcposgqlmgapzoopze.supabase.co/functions/v1/meta-webhook'); toast.success('Webhook URL copied'); }}><Copy className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button size="sm" className="h-7 text-xs bg-[#1877F2] hover:bg-[#166ad8] text-white" disabled={isVerifying || !fbPageId || !fbAccessToken} onClick={handleFacebookConnect}>
                    {isVerifying ? <><Loader2 className="w-3 h-3 animate-spin mr-1.5" /> Verifying</> : isConnected.facebook_enabled ? <><Check className="w-3 h-3 mr-1.5" /> Update</> : 'Connect'}
                  </Button>
                  {isConnected.facebook_enabled && <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={handleFacebookDisconnect}>Disconnect</Button>}
                </div>
              </div>
            )}

            {/* ── Instagram ── */}
            {expanded === 'instagram_enabled' && (
              <div className="space-y-3 max-w-sm">
                <p className="text-sm font-semibold text-slate-900 mb-2">Instagram DMs — Connect</p>
                {isConnected.instagram_enabled && <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 text-xs text-green-700"><CheckCircle2 className="w-3.5 h-3.5" /><span>Connected: @{integrations.instagram_username || integrations.instagram_business_id}</span></div>}
                <div className="space-y-1.5"><Label className="text-xs text-slate-500">Business Account ID</Label><Input placeholder="17841400..." value={igBusinessId} onChange={(e) => setIgBusinessId(e.target.value)} className="font-mono text-xs h-8" /></div>
                <div className="space-y-1.5"><Label className="text-xs text-slate-500">Access Token</Label><Input type="password" placeholder="EAAGm..." value={igAccessToken} onChange={(e) => setIgAccessToken(e.target.value)} className="font-mono text-xs h-8" /></div>
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 text-xs text-slate-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Must be a Business/Creator account. Get credentials from the <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="text-[#E1306C] underline underline-offset-2">Graph API Explorer</a>. Needs <code className="bg-slate-200 px-1 rounded">instagram_manage_messages</code>.</span>
                </div>
                {isConnected.instagram_enabled && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">Webhook URL</Label>
                    <div className="flex items-center gap-1.5">
                      <Input readOnly value="https://amxcposgqlmgapzoopze.supabase.co/functions/v1/meta-webhook" className="font-mono text-xs h-8 bg-slate-50 text-slate-500" />
                      <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => { navigator.clipboard.writeText('https://amxcposgqlmgapzoopze.supabase.co/functions/v1/meta-webhook'); toast.success('Webhook URL copied'); }}><Copy className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button size="sm" className="h-7 text-xs bg-[#E1306C] hover:bg-[#c72c60] text-white" disabled={isVerifying || !igBusinessId || !igAccessToken} onClick={handleInstagramConnect}>
                    {isVerifying ? <><Loader2 className="w-3 h-3 animate-spin mr-1.5" /> Verifying</> : isConnected.instagram_enabled ? <><Check className="w-3 h-3 mr-1.5" /> Update</> : 'Connect'}
                  </Button>
                  {isConnected.instagram_enabled && <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={handleInstagramDisconnect}>Disconnect</Button>}
                </div>
              </div>
            )}

            {/* ── PMS Pearl Dental ── */}
            {expanded === 'pms_pearl' && (
              <div className="space-y-3 max-w-sm">
                <p className="text-sm font-semibold text-slate-900 mb-2">Pearl Dental — Credentials</p>
                {isConnected.pms_pearl && <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 text-xs text-green-700"><CheckCircle2 className="w-3.5 h-3.5" /><span>Connected — Practice code: {pearDental?.practice_code}</span></div>}
                <div className="grid grid-cols-2 gap-4">
                  <div><Label className="text-xs text-slate-500">API Key</Label><Input type="password" placeholder="pd_live_xxxxxxxx" value={pmsApiKey} onChange={(e) => setPmsApiKey(e.target.value)} className="font-mono text-xs h-8 mt-1.5" /></div>
                  <div><Label className="text-xs text-slate-500">Practice Code</Label><Input placeholder="e.g. CLINIC001" value={pmsPracticeCode} onChange={(e) => setPmsPracticeCode(e.target.value)} className="text-xs h-8 mt-1.5" /></div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white" disabled={!pmsApiKey || !pmsPracticeCode} onClick={handlePmsConnect}>
                    {isConnected.pms_pearl ? <><Check className="w-3 h-3 mr-1.5" /> Update</> : 'Test & Connect'}
                  </Button>
                  {isConnected.pms_pearl && <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={handlePmsDisconnect}>Disconnect</Button>}
                </div>
              </div>
            )}

            {/* ── PMS Aerona (coming soon) ── */}
            {expanded === 'pms_aerona' && (
              <div className="space-y-3 max-w-sm">
                <p className="text-sm font-semibold text-slate-900 mb-2">Aerona Dental</p>
                <p className="text-xs text-slate-400">Aerona integration coming soon.</p>
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <div className="space-y-8">
      {/* Communication Channels */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Communication Channels</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {CHANNELS.map(ch => renderCard(ch, handleChannelClick))}
        </div>
        {['phone_enabled', 'email_enabled', 'web_chat_enabled'].includes(expanded) && renderPanel()}
      </section>

      {/* Payments & Services */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Payments</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {CONNECT_ITEMS.map(item => renderCard(item, openPanel))}
        </div>
        {expanded === 'stripe' && renderPanel()}
      </section>

      {/* Practice Management Systems */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Practice Management System</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {PMS_SYSTEMS.map(pms => renderCard(pms, openPanel))}
        </div>
        {['pms_pearl', 'pms_aerona', 'facebook_enabled', 'instagram_enabled'].includes(expanded) && renderPanel()}
      </section>
    </div>
  );
}
