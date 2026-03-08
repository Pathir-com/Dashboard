import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Phone, MessageCircle, Mail, Bot, Globe, Facebook, Instagram, Loader2 } from 'lucide-react';

export default function IntegrationsTab({
  practice,
  integrations,
  setIntegrations,
  onAssignNumber,
  onReleaseNumber,
  isAssigningNumber,
}) {
  const twilioNumber = practice?.twilio_phone_number;
  const hasNumber = !!twilioNumber;

  return (
    <div className="space-y-8">
      {/* Voice AI */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Voice AI</h2>
        <div className="bg-white rounded-xl border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center">
              <Phone className="w-5 h-5 text-violet-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900">AI Receptionist</p>
              <p className="text-xs text-slate-400">AI receptionist answers calls, books appointments, and handles enquiries</p>
            </div>
            {hasNumber ? (
              <Badge className="border-transparent bg-emerald-50 text-emerald-700 shadow-none">Active</Badge>
            ) : (
              <Badge className="border-transparent bg-slate-100 text-slate-500 shadow-none">Inactive</Badge>
            )}
          </div>

          {hasNumber ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                <Phone className="w-4 h-4 text-slate-400" />
                <span className="text-base font-medium text-slate-900 tracking-wide">{twilioNumber}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onReleaseNumber}
                disabled={isAssigningNumber}
                className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
              >
                {isAssigningNumber ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Disable Voice AI'
                )}
              </Button>
            </div>
          ) : (
            <Button
              onClick={onAssignNumber}
              disabled={isAssigningNumber}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {isAssigningNumber ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Assigning number...
                </>
              ) : (
                <>
                  <Phone className="w-4 h-4" />
                  Enable Voice AI
                </>
              )}
            </Button>
          )}
        </div>
      </section>

      {/* ElevenLabs Agent */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Voice Engine</h2>
        <div className="bg-white rounded-xl border border-slate-100 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center">
              <Bot className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">ElevenLabs</p>
              <p className="text-xs text-slate-400">Voice synthesis agent for phone calls</p>
            </div>
          </div>
          <div>
            <Label className="text-slate-600">Agent ID</Label>
            <Input
              value={practice?.elevenlabs_agent_id || ''}
              onChange={e => setIntegrations({ ...integrations, elevenlabs_agent_id: e.target.value })}
              placeholder="agent_xxxxxxxxxxxxxxxx"
              className="mt-1.5 font-mono text-sm"
            />
          </div>
        </div>
      </section>

      {/* Web Chat */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Web Chat</h2>
        <div className="bg-white rounded-xl border border-slate-100 p-6 space-y-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900">Chatbase</p>
              <p className="text-xs text-slate-400">AI chat widget embedded on your practice website</p>
            </div>
            <Switch
              checked={integrations.web_chat_enabled}
              onCheckedChange={val => setIntegrations({ ...integrations, web_chat_enabled: val })}
            />
          </div>
          <div>
            <Label className="text-slate-600">Chatbase Agent ID</Label>
            <Input
              value={practice?.chatbase_agent_id || ''}
              onChange={e => setIntegrations({ ...integrations, chatbase_agent_id: e.target.value })}
              placeholder="chatbase_xxxxxxxxxxxxxxxx"
              className="mt-1.5 font-mono text-sm"
              disabled={!integrations.web_chat_enabled}
            />
          </div>
        </div>
      </section>

      {/* Channel Toggles */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Channels</h2>
        <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-50">
          {[
            { key: 'phone_enabled', icon: <Phone className="w-4 h-4 text-slate-500" />, label: 'Phone', description: 'AI handles incoming phone calls' },
            { key: 'sms_enabled', icon: <MessageCircle className="w-4 h-4 text-slate-500" />, label: 'SMS', description: 'Send and receive text messages' },
            { key: 'email_enabled', icon: <Mail className="w-4 h-4 text-slate-500" />, label: 'Email', description: 'AI handles incoming email enquiries' },
            { key: 'facebook_enabled', icon: <Facebook className="w-4 h-4 text-[#1877F2]" />, label: 'Facebook Messenger', description: 'AI handles Facebook Messenger enquiries' },
            { key: 'instagram_enabled', icon: <Instagram className="w-4 h-4 text-[#E1306C]" />, label: 'Instagram DMs', description: 'AI handles Instagram Direct Message enquiries' },
          ].map(({ key, icon, label, description }) => (
            <div key={key} className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-3">
                {icon}
                <div>
                  <p className="text-sm font-medium text-slate-900">{label}</p>
                  <p className="text-xs text-slate-400">{description}</p>
                </div>
              </div>
              <Switch
                checked={integrations[key]}
                onCheckedChange={val => setIntegrations({ ...integrations, [key]: val })}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
