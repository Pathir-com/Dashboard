import React, { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Phone, MessageCircle, Mail, Globe, Facebook, Instagram,
  CreditCard, Loader2, Check, AlertCircle, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

export default function IntegrationsTab({
  practice,
  integrations,
  setIntegrations,
  onAssignNumber,
  isAssigningNumber,
}) {
  const twilioNumber = practice?.twilio_phone_number;
  const hasNumber = !!twilioNumber;

  const [expanded, setExpanded] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // Form state
  const [stripeKey, setStripeKey] = useState(integrations.stripe_publishable_key || '');
  const [stripeSecret, setStripeSecret] = useState(integrations.stripe_secret_key || '');
  const [fbPageId, setFbPageId] = useState(integrations.facebook_page_id || '');
  const [fbAccessToken, setFbAccessToken] = useState(integrations.facebook_access_token || '');
  const [igBusinessId, setIgBusinessId] = useState(integrations.instagram_business_id || '');
  const [igAccessToken, setIgAccessToken] = useState(integrations.instagram_access_token || '');

  const connected = {
    phone_enabled: hasNumber,
    sms_enabled: hasNumber,
    web_chat_enabled: !!practice?.chatbase_agent_id,
    email_enabled: false,
    facebook_enabled: !!integrations.facebook_page_id,
    instagram_enabled: !!integrations.instagram_business_id,
    stripe: !!integrations.stripe_connected,
  };

  function toggle(key) {
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (key === 'stripe') { setStripeKey(integrations.stripe_publishable_key || ''); setStripeSecret(integrations.stripe_secret_key || ''); }
    if (key === 'facebook_enabled') { setFbPageId(integrations.facebook_page_id || ''); setFbAccessToken(integrations.facebook_access_token || ''); }
    if (key === 'instagram_enabled') { setIgBusinessId(integrations.instagram_business_id || ''); setIgAccessToken(integrations.instagram_access_token || ''); }
  }

  // ── Handlers ──
  async function handleStripeConnect() {
    const pk = stripeKey.trim();
    const sk = stripeSecret.trim();
    if (!pk.startsWith('pk_test_') && !pk.startsWith('pk_live_')) { toast.error('Publishable key must start with pk_test_ or pk_live_'); return; }
    if (!sk.startsWith('sk_test_') && !sk.startsWith('sk_live_') && !sk.startsWith('rk_test_') && !sk.startsWith('rk_live_')) { toast.error('Secret key must start with sk_test_ or sk_live_'); return; }
    const skMode = sk.includes('_test_') ? 'test' : 'live';
    setIntegrations({ ...integrations, stripe_publishable_key: pk, stripe_secret_key: sk, stripe_connected: true, stripe_mode: skMode });
    toast.success(`Stripe connected (${skMode} mode)`); setExpanded(null);
  }

  function handleStripeDisconnect() {
    const { stripe_publishable_key, stripe_secret_key, stripe_connected, stripe_mode, ...rest } = integrations;
    setIntegrations(rest);
    setStripeKey(''); setStripeSecret('');
    toast.success('Stripe disconnected'); setExpanded(null);
  }

  async function handleFacebookConnect() {
    if (!fbPageId.trim() || !fbAccessToken.trim()) { toast.error('Page ID and Access Token are required'); return; }
    setIsVerifying(true);
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${fbPageId}?access_token=${fbAccessToken}`);
      if (!res.ok) throw new Error('Invalid Page ID or Access Token');
      const page = await res.json();
      setIntegrations({ ...integrations, facebook_page_id: fbPageId.trim(), facebook_access_token: fbAccessToken.trim(), facebook_page_name: page.name || '', facebook_enabled: true });
      toast.success(`Facebook connected: ${page.name || fbPageId}`); setExpanded(null);
    } catch (err) { toast.error(err.message); } finally { setIsVerifying(false); }
  }

  async function handleInstagramConnect() {
    if (!igBusinessId.trim() || !igAccessToken.trim()) { toast.error('Business Account ID and Access Token are required'); return; }
    setIsVerifying(true);
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${igBusinessId}?fields=name,username&access_token=${igAccessToken}`);
      if (!res.ok) throw new Error('Invalid Business Account ID or Access Token');
      const account = await res.json();
      setIntegrations({ ...integrations, instagram_business_id: igBusinessId.trim(), instagram_access_token: igAccessToken.trim(), instagram_username: account.username || '', instagram_enabled: true });
      toast.success(`Instagram connected: @${account.username || igBusinessId}`); setExpanded(null);
    } catch (err) { toast.error(err.message); } finally { setIsVerifying(false); }
  }

  // ── All items in one flat list ──
  const items = [
    {
      key: 'phone_enabled',
      icon: <Phone className="w-4 h-4 text-violet-600" />,
      label: 'Voice',
      desc: hasNumber ? `Assigned: ${twilioNumber}` : 'Answers calls, books appointments, and handles enquiries',
      type: 'toggle',
      onToggle: async (val) => { if (val && !hasNumber) await onAssignNumber(); setIntegrations({ ...integrations, phone_enabled: val }); },
    },
    {
      key: 'sms_enabled',
      icon: <MessageCircle className="w-4 h-4 text-slate-500" />,
      label: 'SMS',
      desc: hasNumber
        ? integrations.sms_enabled ? `Receiving via ${twilioNumber}` : `Off — callers will be asked to call ${twilioNumber} instead`
        : 'Appointment confirmations and reminders',
      type: 'toggle',
    },
    {
      key: 'web_chat_enabled',
      icon: <Globe className="w-4 h-4 text-blue-600" />,
      label: 'Web Chat',
      desc: practice?.chatbase_agent_id ? 'Poppy — AI chat widget on your practice website' : 'AI chat widget on your practice website',
      type: 'toggle',
    },
    {
      key: 'email_enabled',
      icon: <Mail className="w-4 h-4 text-slate-400" />,
      label: 'Email',
      desc: 'Requires email verification — coming soon',
      type: 'toggle',
      disabled: true,
    },
    {
      key: 'stripe',
      icon: <CreditCard className="w-4 h-4 text-[#635BFF]" />,
      label: 'Stripe',
      desc: connected.stripe
        ? (!integrations.stripe_publishable_key || !integrations.stripe_secret_key
          ? `Connected (${integrations.stripe_mode || 'test'}) — missing keys, click Settings to fix`
          : `Connected (${integrations.stripe_mode || 'test'}) — payments and deposits active`)
        : 'Accept payments, deposits, and payment links',
      type: 'connect',
      isConnected: connected.stripe,
    },
    {
      key: 'facebook_enabled',
      icon: <Facebook className="w-4 h-4 text-[#1877F2]" />,
      label: 'Facebook Messenger',
      desc: connected.facebook_enabled ? `Connected${integrations.facebook_page_name ? ` — ${integrations.facebook_page_name}` : ''}` : 'Receive Messenger enquiries in your inbox',
      type: 'connect',
      isConnected: connected.facebook_enabled,
    },
    {
      key: 'instagram_enabled',
      icon: <Instagram className="w-4 h-4 text-[#E1306C]" />,
      label: 'Instagram DMs',
      desc: connected.instagram_enabled ? `Connected${integrations.instagram_username ? ` — @${integrations.instagram_username}` : ''}` : 'Receive Instagram DMs in your inbox',
      type: 'connect',
      isConnected: connected.instagram_enabled,
    },
  ];

  function getBadge(item) {
    if (item.type === 'connect') {
      return item.isConnected ? 'Connected' : null;
    }
    const toggled = item.key === 'phone_enabled' ? integrations.phone_enabled !== false : !!integrations[item.key];
    const isConn = connected[item.key];
    if (toggled && isConn) return 'Active';
    if (toggled && !isConn) return 'Not connected';
    if (!toggled && isConn) return 'Paused';
    return null;
  }

  const badgeColors = {
    Active: 'bg-emerald-50 text-emerald-700',
    Connected: 'bg-emerald-50 text-emerald-700',
    Paused: 'bg-amber-50 text-amber-700',
    'Not connected': 'bg-slate-100 text-slate-500',
  };

  return (
    <div>
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Integrations</h2>
      <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50">
        {items.map((item) => {
          const badge = getBadge(item);
          const isExpanded = expanded === item.key;
          return (
            <div key={item.key}>
              {/* Row */}
              <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-3">
                  {item.icon}
                  <div>
                    <p className="text-sm font-medium text-slate-900">{item.label}</p>
                    <p className="text-xs text-slate-400">{item.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {badge && (
                    <Badge className={`border-transparent shadow-none text-xs ${badgeColors[badge] || ''}`}>
                      {badge}
                    </Badge>
                  )}
                  {item.type === 'toggle' ? (
                    <Switch
                      checked={item.key === 'phone_enabled' ? integrations.phone_enabled !== false : !!integrations[item.key]}
                      disabled={(item.key === 'phone_enabled' && isAssigningNumber) || item.disabled}
                      onCheckedChange={item.onToggle || (val => setIntegrations({ ...integrations, [item.key]: val }))}
                    />
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className={`text-xs h-7 gap-1 ${isExpanded ? 'bg-slate-50' : ''}`}
                      onClick={() => toggle(item.key)}
                    >
                      {item.isConnected ? 'Settings' : 'Connect'}
                      <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </Button>
                  )}
                </div>
              </div>

              {/* Inline expand panel */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-6 pb-5 pt-1 ml-7 border-t border-slate-50">
                      {/* ── Stripe ── */}
                      {item.key === 'stripe' && (
                        <div className="space-y-3 max-w-sm">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500">Publishable Key</Label>
                            <Input placeholder="pk_test_..." value={stripeKey} onChange={(e) => setStripeKey(e.target.value)} className="font-mono text-xs h-8" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500">Secret Key</Label>
                            <Input type="password" placeholder="sk_test_..." value={stripeSecret} onChange={(e) => setStripeSecret(e.target.value)} className="font-mono text-xs h-8" />
                          </div>
                          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 text-xs text-slate-400">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                              Find your keys in the{' '}
                              <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer" className="text-[#635BFF] underline underline-offset-2">Stripe Dashboard</a>.
                              Use test keys first.
                            </span>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <Button size="sm" className="h-7 text-xs bg-[#635BFF] hover:bg-[#5851ea] text-white"
                              disabled={isVerifying || !stripeKey || !stripeSecret} onClick={handleStripeConnect}>
                              {isVerifying ? <><Loader2 className="w-3 h-3 animate-spin mr-1.5" /> Verifying</> :
                                connected.stripe ? <><Check className="w-3 h-3 mr-1.5" /> Update</> : 'Connect'}
                            </Button>
                            {connected.stripe && (
                              <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                                onClick={handleStripeDisconnect}>
                                Disconnect
                              </Button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ── Facebook ── */}
                      {item.key === 'facebook_enabled' && (
                        <div className="space-y-3 max-w-sm">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500">Page ID</Label>
                            <Input placeholder="123456789012345" value={fbPageId} onChange={(e) => setFbPageId(e.target.value)} className="font-mono text-xs h-8" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500">Page Access Token</Label>
                            <Input type="password" placeholder="EAAGm..." value={fbAccessToken} onChange={(e) => setFbAccessToken(e.target.value)} className="font-mono text-xs h-8" />
                          </div>
                          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 text-xs text-slate-400">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                              Get credentials from the{' '}
                              <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="text-[#1877F2] underline underline-offset-2">Meta Graph API Explorer</a>.
                              Needs <code className="bg-slate-200 px-1 rounded">pages_messaging</code>.
                            </span>
                          </div>
                          <Button size="sm" className="h-7 text-xs bg-[#1877F2] hover:bg-[#166ad8] text-white"
                            disabled={isVerifying || !fbPageId || !fbAccessToken} onClick={handleFacebookConnect}>
                            {isVerifying ? <><Loader2 className="w-3 h-3 animate-spin mr-1.5" /> Verifying</> : 'Connect'}
                          </Button>
                        </div>
                      )}

                      {/* ── Instagram ── */}
                      {item.key === 'instagram_enabled' && (
                        <div className="space-y-3 max-w-sm">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500">Business Account ID</Label>
                            <Input placeholder="17841400..." value={igBusinessId} onChange={(e) => setIgBusinessId(e.target.value)} className="font-mono text-xs h-8" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500">Access Token</Label>
                            <Input type="password" placeholder="EAAGm..." value={igAccessToken} onChange={(e) => setIgAccessToken(e.target.value)} className="font-mono text-xs h-8" />
                          </div>
                          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 text-xs text-slate-400">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                              Must be a Business/Creator account linked to a Facebook Page. Get credentials from the{' '}
                              <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="text-[#E1306C] underline underline-offset-2">Graph API Explorer</a>.
                              Needs <code className="bg-slate-200 px-1 rounded">instagram_manage_messages</code>.
                            </span>
                          </div>
                          <Button size="sm" className="h-7 text-xs bg-[#E1306C] hover:bg-[#c72c60] text-white"
                            disabled={isVerifying || !igBusinessId || !igAccessToken} onClick={handleInstagramConnect}>
                            {isVerifying ? <><Loader2 className="w-3 h-3 animate-spin mr-1.5" /> Verifying</> : 'Connect'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
