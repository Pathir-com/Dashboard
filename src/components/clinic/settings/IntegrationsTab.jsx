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

  // Persona name comes from the industry template — never hardcode here.
  // Falls back to "your assistant" before the lookup lands so the snippet
  // never reads as if it belonged to another vertical.
  const [personaName, setPersonaName] = useState('your assistant');
  React.useEffect(() => {
    let cancelled = false;
    const industry = practice?.industry;
    if (!industry) return;
    supabase
      .from('industry_templates')
      .select('agent_persona_name')
      .eq('id', industry)
      .single()
      .then(({ data }) => {
        if (!cancelled && data?.agent_persona_name) setPersonaName(data.agent_persona_name);
      });
    return () => { cancelled = true; };
  }, [practice?.industry]);

  const [expanded, setExpanded] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [isTogglingPhone, setIsTogglingPhone] = useState(false);
  const [phoneCopied, setPhoneCopied] = useState(false);

  // Form state
  const [stripeKey, setStripeKey] = useState(integrations.stripe_publishable_key || '');
  const [stripeSecret, setStripeSecret] = useState(integrations.stripe_secret_key || '');
  const [pmsApiKey, setPmsApiKey] = useState(pearDental?.api_key || '');
  const [pmsPracticeCode, setPmsPracticeCode] = useState(pearDental?.practice_code || '');
  const [isMetaConnecting, setIsMetaConnecting] = useState(false);
  const [isInstagramConnecting, setIsInstagramConnecting] = useState(false);

  // Email verification state
  const [emailAddress, setEmailAddress] = useState(practice?.email || '');
  const [emailCode, setEmailCode] = useState('');
  const [emailStep, setEmailStep] = useState(
    integrations.email_verified ? 'verified' : 'input'
  );
  const [isSendingCode, setIsSendingCode] = useState(false);

  /* ── Connected status ── */
  const isConnected = {
    phone_enabled: hasNumber,
    sms_enabled: hasNumber,
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
      if (!hasNumber) {
        const result = await onAssignNumber();
        if (result) {
          setIntegrations(prev => ({ ...prev, phone_enabled: true }));
          setExpanded('phone_enabled');
        }
        return;
      }
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

  // Meta App IDs — used for OAuth redirect URLs
  const META_APP_ID = import.meta.env.VITE_META_APP_ID || '';
  const META_IG_APP_ID = import.meta.env.VITE_META_IG_APP_ID || '';

  // Meta OAuth: single button connects both Facebook + Instagram
  function handleMetaLogin() {
    if (!META_APP_ID) {
      toast.error('Meta App not configured — contact support');
      return;
    }
    // Store practice ID in sessionStorage so the callback can use it
    sessionStorage.setItem('meta_connect_practice_id', practice?.id || '');

    const redirectUri = `${window.location.origin}/`;
    const scope = 'pages_messaging,pages_manage_metadata,instagram_business_manage_messages,pages_show_list';
    const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code&state=meta_connect`;

    window.location.href = authUrl;
  }

  // Handle OAuth callback (called from useEffect when URL has ?code= and state=meta_connect)
  async function handleMetaCallback(code) {
    setIsMetaConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/`;
      const { data, error } = await supabase.functions.invoke('meta-connect', {
        body: {
          practiceId: practice?.id,
          code,
          redirectUri,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Update local state with the new integrations
      const { data: refreshed } = await supabase
        .from('practices')
        .select('integrations')
        .eq('id', practice?.id)
        .single();

      if (refreshed) {
        setIntegrations(refreshed.integrations || {});
      }

      let msg = `Facebook connected: ${data.facebook?.pageName || 'Page'}`;
      if (data.instagram?.connected) {
        msg += ` + Instagram: @${data.instagram.username || 'connected'}`;
      }
      toast.success(msg);
      setExpanded(null);

      // Clean up URL params
      const url = new URL(window.location.href);
      url.searchParams.delete('code');
      url.searchParams.delete('state');
      window.history.replaceState({}, '', url.pathname + url.search);
    } catch (err) {
      toast.error(err.message || 'Failed to connect Facebook');
      console.error('[Meta OAuth]', err);
    } finally {
      setIsMetaConnecting(false);
      sessionStorage.removeItem('meta_connect_practice_id');
    }
  }

  // Instagram-only OAuth (for clinics that aren't using a Facebook Page).
  // Uses the dedicated Pathir-IG app and the new Instagram Login API rather
  // than Facebook-Login-with-Instagram. Tokens are IGAA prefixed and live
  // 60 days; backend refreshes are handled in instagram-connect.
  function handleInstagramLogin() {
    if (!META_IG_APP_ID) {
      toast.error('Instagram App not configured — contact support');
      return;
    }
    sessionStorage.setItem('ig_connect_practice_id', practice?.id || '');

    const redirectUri = `${window.location.origin}/`;
    const scope = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments';
    const authUrl = `https://www.instagram.com/oauth/authorize?force_reauth=true&client_id=${META_IG_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=ig_connect`;

    window.location.href = authUrl;
  }

  async function handleInstagramCallback(code) {
    setIsInstagramConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/`;
      const { data, error } = await supabase.functions.invoke('instagram-connect', {
        body: {
          practiceId: practice?.id,
          code,
          redirectUri,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const { data: refreshed } = await supabase
        .from('practices')
        .select('integrations')
        .eq('id', practice?.id)
        .single();
      if (refreshed) setIntegrations(refreshed.integrations || {});

      const username = data?.instagram?.username;
      toast.success(username ? `Instagram connected: @${username}` : 'Instagram connected');
      setExpanded(null);

      const url = new URL(window.location.href);
      url.searchParams.delete('code');
      url.searchParams.delete('state');
      window.history.replaceState({}, '', url.pathname + url.search);
    } catch (err) {
      toast.error(err.message || 'Failed to connect Instagram');
      console.error('[Instagram OAuth]', err);
    } finally {
      setIsInstagramConnecting(false);
      sessionStorage.removeItem('ig_connect_practice_id');
    }
  }

  async function handleInstagramDisconnect() {
    try {
      const { error } = await supabase.functions.invoke('instagram-connect', {
        body: { practiceId: practice?.id, disconnect: true },
      });
      if (error) throw error;

      const { data: refreshed } = await supabase
        .from('practices')
        .select('integrations')
        .eq('id', practice?.id)
        .single();
      if (refreshed) setIntegrations(refreshed.integrations || {});

      toast.success('Instagram disconnected');
      setExpanded(null);
    } catch (err) {
      toast.error('Failed to disconnect Instagram');
      console.error(err);
    }
  }

  // Check for either Meta or Instagram OAuth callback on mount.
  React.useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !practice?.id) return;
    if (state === 'meta_connect') handleMetaCallback(code);
    else if (state === 'ig_connect') handleInstagramCallback(code);
  }, [practice?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleMetaDisconnect() {
    try {
      const { error } = await supabase.functions.invoke('meta-connect', {
        body: { practiceId: practice?.id, disconnect: true },
      });
      if (error) throw error;

      // Refresh integrations from DB
      const { data: refreshed } = await supabase
        .from('practices')
        .select('integrations')
        .eq('id', practice?.id)
        .single();

      if (refreshed) {
        setIntegrations(refreshed.integrations || {});
      }

      toast.success('Facebook & Instagram disconnected');
      setExpanded(null);
    } catch (err) {
      toast.error('Failed to disconnect');
      console.error(err);
    }
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
      await togglePhoneAgent(practice.id, false);
      setIntegrations({ ...integrations, phone_enabled: false });
      toast.success('Phone agent disconnected');
      setExpanded(null);
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
      await togglePhoneAgent(practice.id, true);
      setIntegrations({ ...integrations, phone_enabled: true });
      toast.success('Phone agent reconnected');
      setExpanded(null);
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
    const isPhoneLoading = key === 'phone_enabled' && isAssigningNumber;
    const isChatLocked = key === 'web_chat_enabled' && !practice?.elevenlabs_agent_id;
    const isDisabled = isPhoneLoading || isChatLocked;
    return (
      <button
        key={key}
        type="button"
        onClick={() => !isDisabled && onClick(key)}
        disabled={isDisabled}
        className={`relative flex flex-col items-start rounded-xl border p-4 text-left transition-all ${
          active ? 'bg-white border-slate-300 shadow-sm' : 'bg-slate-50/50 border-slate-100 hover:bg-white hover:border-slate-200'
        } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <div className={`w-10 h-10 rounded-xl ${bgColor} border ${borderColor} flex items-center justify-center mb-3`}>
          {isPhoneLoading
            ? <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
            : <Icon className={`w-5 h-5 ${iconColor}`} />
          }
        </div>
        <p className={`text-sm font-semibold leading-tight ${active ? 'text-slate-900' : 'text-slate-500'}`}>
          {isPhoneLoading ? 'Setting up...' : label}
        </p>
        <p className="text-[11px] text-slate-400 mt-1 leading-snug line-clamp-2">
          {isPhoneLoading ? 'Assigning a local number for your area' : isChatLocked ? 'Available once your AI agent is provisioned.' : description}
        </p>
        <div className={`absolute top-3 right-3 w-2 h-2 rounded-full ${isPhoneLoading ? 'bg-blue-400 animate-pulse' : dotColor(key)}`} />
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
                    <Input readOnly value={twilioNumber} className="font-mono text-xs h-8 bg-slate-50 text-slate-700" />
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
              const snippet = `<script\n  src="https://amxcposgqlmgapzoopze.supabase.co/storage/v1/object/public/widget/pathir-chat.js"\n  data-agent-id="${practice.elevenlabs_agent_id}"\n  data-token-url="https://amxcposgqlmgapzoopze.supabase.co/functions/v1/chat-token"\n  data-title="${practice.name || 'Chat with us'}"\n  data-subtitle="Ask ${personaName} anything"\n  data-accent="#3072ff"\n></script>`;
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

            {/* ── Facebook (OAuth) ── */}
            {expanded === 'facebook_enabled' && (
              <div className="space-y-3 max-w-sm">
                <p className="text-sm font-semibold text-slate-900 mb-2">Facebook Messenger</p>
                {isMetaConnecting && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 text-xs text-blue-700">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Connecting your Facebook Page...</span>
                  </div>
                )}
                {isConnected.facebook_enabled ? (
                  <>
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 text-xs text-green-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Connected: {integrations.facebook_page_name || integrations.facebook_page_id}</span>
                    </div>
                    {isConnected.instagram_enabled && (
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 text-xs text-green-700">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Instagram: @{integrations.instagram_username || integrations.instagram_business_id}</span>
                      </div>
                    )}
                    <p className="text-xs text-slate-500">AI will automatically respond to Messenger{isConnected.instagram_enabled ? ' and Instagram' : ''} messages on behalf of your practice.</p>
                    <div className="flex items-center gap-2 pt-1">
                      <Button size="sm" className="h-7 text-xs bg-[#1877F2] hover:bg-[#166ad8] text-white" onClick={handleMetaLogin}>
                        Reconnect
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={handleMetaDisconnect}>
                        Disconnect
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-slate-500">Connect your Facebook Page to let AI handle Messenger DMs. If your Instagram Business account is linked to the same Page, it connects automatically.</p>
                    <Button size="sm" className="h-8 text-xs bg-[#1877F2] hover:bg-[#166ad8] text-white gap-2" disabled={isMetaConnecting} onClick={handleMetaLogin}>
                      <Facebook className="w-3.5 h-3.5" />
                      Connect with Facebook
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* ── Instagram (linked via Facebook OAuth) ── */}
            {expanded === 'instagram_enabled' && (
              <div className="space-y-3 max-w-sm">
                <p className="text-sm font-semibold text-slate-900 mb-2">Instagram DMs</p>
                {isConnected.instagram_enabled ? (
                  <>
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 text-xs text-green-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Connected: @{integrations.instagram_username || integrations.instagram_business_id}</span>
                    </div>
                    {isConnected.facebook_enabled && (
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 text-xs text-green-700">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Facebook: {integrations.facebook_page_name}</span>
                      </div>
                    )}
                    <p className="text-xs text-slate-500">AI will automatically respond to Instagram DMs on behalf of your practice.</p>
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={integrations.instagram_connected_via === 'instagram_oauth' ? handleInstagramDisconnect : handleMetaDisconnect}
                      >
                        Disconnect
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-slate-500">
                      Two ways to connect Instagram: via your Facebook Page (recommended if you have one — connects Messenger and Instagram in one step), or directly via Instagram (use this if you don't have a Facebook Page or your Instagram isn't linked to one).
                    </p>
                    {isConnected.facebook_enabled && (
                      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 text-xs text-amber-700">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>Facebook is connected but no Instagram Business account was detected on your Page. Try reconnecting Facebook, or connect Instagram directly using the button below.</span>
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <Button
                        size="sm"
                        className="h-8 text-xs bg-[#1877F2] hover:bg-[#166ad8] text-white gap-2"
                        disabled={isMetaConnecting || isInstagramConnecting}
                        onClick={handleMetaLogin}
                      >
                        <Facebook className="w-3.5 h-3.5" />
                        {isConnected.facebook_enabled ? 'Reconnect Facebook' : 'Connect via Facebook'}
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 text-xs bg-gradient-to-tr from-[#fdc468] via-[#df4996] to-[#7c3aed] hover:opacity-90 text-white gap-2"
                        disabled={isInstagramConnecting || isMetaConnecting}
                        onClick={handleInstagramLogin}
                      >
                        <Instagram className="w-3.5 h-3.5" />
                        {isInstagramConnecting ? 'Connecting…' : 'Connect with Instagram'}
                      </Button>
                    </div>
                  </>
                )}
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

  /* Hide channels the practice isn't using yet — most clinics start with
     phone + web chat and never touch Instagram. We surface only:
       (a) channels the practice has connected (isConnected[key])
       (b) channels they've actively toggled on (integrations[key])
       (c) channels currently expanded for setup
     The "Show all channels" affordance reveals the rest if they ever want
     to connect a new one. */
  const [showAllChannels, setShowAllChannels] = useState(false);
  const visibleChannels = showAllChannels
    ? CHANNELS
    : CHANNELS.filter(
        (ch) => isConnected[ch.key] || integrations[ch.key] || expanded === ch.key,
      );
  const hiddenChannelCount = CHANNELS.length - visibleChannels.length;

  return (
    <div className="space-y-8">
      {/* Communication Channels */}
      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Communication Channels</h2>
          {!showAllChannels && hiddenChannelCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllChannels(true)}
              className="text-xs text-slate-500 hover:text-slate-900 transition-colors"
            >
              Show {hiddenChannelCount} more
            </button>
          )}
          {showAllChannels && (
            <button
              type="button"
              onClick={() => setShowAllChannels(false)}
              className="text-xs text-slate-500 hover:text-slate-900 transition-colors"
            >
              Hide unused
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {visibleChannels.flatMap(ch => [
            renderCard(ch, handleChannelClick),
            ...(expanded === ch.key ? [<div key={`${ch.key}-panel`} className="col-span-2 sm:col-span-3">{renderPanel()}</div>] : []),
          ])}
          {visibleChannels.length === 0 && (
            <div className="col-span-2 sm:col-span-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
              <p className="text-sm text-slate-500">No channels connected yet.</p>
              <button
                type="button"
                onClick={() => setShowAllChannels(true)}
                className="mt-2 text-sm text-slate-900 underline-offset-2 hover:underline"
              >
                Browse channels
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Payments & Services */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Payments</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {CONNECT_ITEMS.flatMap(item => [
            renderCard(item, openPanel),
            ...(expanded === item.key ? [<div key={`${item.key}-panel`} className="col-span-2 sm:col-span-3">{renderPanel()}</div>] : []),
          ])}
        </div>
      </section>

      {/* Practice Management Systems */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Practice Management System</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {PMS_SYSTEMS.flatMap(pms => [
            renderCard(pms, openPanel),
            ...(expanded === pms.key ? [<div key={`${pms.key}-panel`} className="col-span-2 sm:col-span-3">{renderPanel()}</div>] : []),
          ])}
        </div>
      </section>
    </div>
  );
}
