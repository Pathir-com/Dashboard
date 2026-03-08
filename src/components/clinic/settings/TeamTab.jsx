import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, ChevronDown, ChevronUp, User } from 'lucide-react';

const TITLE_OPTIONS = ['Dr', 'Mr', 'Mrs', 'Ms', 'Miss', 'Prof', 'Other'];

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function PractitionerCard({ p, onChange, onDelete, isOpen, onToggle }) {
  const [open, setOpen] = useState(false);
  const effectiveOpen = isOpen !== undefined ? isOpen : open;
  const toggleOpen = () => {
    if (isOpen !== undefined) onToggle();
    else setOpen(o => !o);
  };
  const [serviceInput, setServiceInput] = useState('');

  const addService = () => {
    const s = serviceInput.trim();
    if (!s) return;
    onChange({ ...p, services: [...(p.services || []), s] });
    setServiceInput('');
  };

  const removeService = (idx) => {
    onChange({ ...p, services: p.services.filter((_, i) => i !== idx) });
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 cursor-pointer select-none" onClick={toggleOpen}>
        <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-slate-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">
            {p.title ? `${p.title} ` : ''}{p.name || <span className="text-slate-400 font-normal">New Practitioner</span>}
          </p>
          {p.credentials && <p className="text-xs text-slate-400 truncate">{p.credentials}</p>}
        </div>
        <div className="flex items-center gap-2">
          {p.services?.length > 0 && (
            <span className="text-xs text-slate-400">{p.services.length} service{p.services.length !== 1 ? 's' : ''}</span>
          )}
          {effectiveOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </div>

      {effectiveOpen && (
        <div className="px-5 pb-5 space-y-4 border-t border-slate-50">
          <div className="grid grid-cols-3 gap-3 pt-4">
            <div>
              <Label className="text-slate-600 text-xs">Title</Label>
              <select
                value={p.title || ''}
                onChange={e => onChange({ ...p, title: e.target.value })}
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">—</option>
                {TITLE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <Label className="text-slate-600 text-xs">Full Name</Label>
              <Input value={p.name || ''} onChange={e => onChange({ ...p, name: e.target.value })} placeholder="Jane Smith" className="mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-slate-600 text-xs">Credentials / GDC Number</Label>
            <Input value={p.credentials || ''} onChange={e => onChange({ ...p, credentials: e.target.value })} placeholder="GDC 123456 · BDS, MJDF" className="mt-1" />
          </div>
          <div>
            <Label className="text-slate-600 text-xs">About This Practitioner</Label>
            <p className="text-[11px] text-slate-400 mb-1.5">A short bio that highlights what makes them special — used by the AI when speaking to patients.</p>
            <textarea
              value={p.bio || ''}
              onChange={e => onChange({ ...p, bio: e.target.value })}
              placeholder="e.g. Dr Smith has over 12 years of experience specialising in nervous patients and cosmetic dentistry. She is known for her gentle approach and has helped hundreds of patients achieve their perfect smile..."
              className="w-full h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
            />
          </div>
          <div>
            <Label className="text-slate-600 text-xs">Services Offered</Label>
            <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
              {(p.services || []).map((s, idx) => (
                <span key={idx} className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded-full">
                  {s}
                  <button onClick={() => removeService(idx)} className="text-slate-400 hover:text-red-500 leading-none">×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={serviceInput}
                onChange={e => setServiceInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addService(); } }}
                placeholder="e.g. Invisalign, Implants..."
                className="text-sm"
              />
              <Button type="button" variant="outline" size="sm" onClick={addService}>Add</Button>
            </div>
          </div>
          <div className="pt-1 flex items-center justify-between">
            <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
              <Trash2 className="w-3 h-3" /> Remove practitioner
            </button>
            <Button type="button" size="sm" onClick={() => { setOpen(false); onToggle?.(); }}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TeamTab({ practitioners, setPractitioners }) {
  const [openId, setOpenId] = useState(null);

  const addPractitioner = () => {
    const id = generateId();
    setPractitioners(prev => [...prev, { id, name: '', title: '', credentials: '', services: [] }]);
    setOpenId(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Practitioners</h2>
          <p className="text-xs text-slate-400">Each practitioner will appear as a column in the diary view.</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addPractitioner} className="gap-1.5">
          <Plus className="w-4 h-4" /> Add Practitioner
        </Button>
      </div>
      {practitioners.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-200">
          <User className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No practitioners yet</p>
          <button onClick={addPractitioner} className="mt-2 text-xs text-slate-600 underline">Add your first practitioner</button>
        </div>
      ) : (
        <div className="space-y-3">
          {practitioners.map((p, i) => (
            <PractitionerCard
              key={p.id}
              p={p}
              onChange={updated => setPractitioners(prev => prev.map((x, idx) => idx === i ? updated : x))}
              onDelete={() => setPractitioners(prev => prev.filter((_, idx) => idx !== i))}
              isOpen={openId === p.id}
              onToggle={() => setOpenId(prev => prev === p.id ? null : p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}