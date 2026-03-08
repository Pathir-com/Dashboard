import React, { useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { base44 } from '@/api/base44Client';
import { Upload, FileText, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function PracticeInfoTab({ usps, setUsps, practicePlan, setPracticePlan, financeDocUrl, setFinanceDocUrl }) {
  const fileRef = useRef();
  const [uploading, setUploading] = React.useState(false);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') { toast.error('Please upload a PDF file'); return; }
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setFinanceDocUrl(file_url);
    setUploading(false);
    toast.success('Finance document uploaded');
  };

  return (
    <div className="space-y-8">
      {/* USPs */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Unique Selling Points</h2>
        <div className="bg-white rounded-xl border border-slate-100 p-6">
          <Label className="text-slate-600 text-sm">What makes your practice special?</Label>
          <p className="text-xs text-slate-400 mb-3 mt-0.5">The AI will use this to promote your practice to potential patients.</p>
          <textarea
            value={usps}
            onChange={e => setUsps(e.target.value)}
            placeholder={`e.g.\n• Award-winning cosmetic dentist with 15 years experience\n• Same-day emergency appointments available\n• Interest-free payment plans\n• Specialist in nervous/anxious patients`}
            className="w-full h-36 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
          />
        </div>
      </section>

      {/* Practice Plan */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Practice Plan</h2>
        <div className="bg-white rounded-xl border border-slate-100 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900">Offer a patient practice plan?</p>
              <p className="text-xs text-slate-400">Monthly membership or subscription-style plan for patients</p>
            </div>
            <Switch
              checked={practicePlan.offered}
              onCheckedChange={val => setPracticePlan({ ...practicePlan, offered: val })}
            />
          </div>
          {practicePlan.offered && (
            <div>
              <Label className="text-slate-600 text-sm">Plan Terms & Details</Label>
              <p className="text-xs text-slate-400 mb-2 mt-0.5">Describe what's included, cost, and any conditions. The AI will use this when speaking to patients.</p>
              <textarea
                value={practicePlan.terms}
                onChange={e => setPracticePlan({ ...practicePlan, terms: e.target.value })}
                placeholder={`e.g. £15/month includes:\n• 2 check-ups per year\n• 1 scale & polish per year\n• 10% off all treatments\n• No joining fee`}
                className="w-full h-32 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
              />
            </div>
          )}
        </div>
      </section>

      {/* Finance Options */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Finance Options</h2>
        <div className="bg-white rounded-xl border border-slate-100 p-6">
          <p className="text-sm font-medium text-slate-900 mb-1">Finance Document (PDF)</p>
          <p className="text-xs text-slate-400 mb-4">Upload your patient finance options document so the AI can reference it.</p>

          {financeDocUrl ? (
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <FileText className="w-5 h-5 text-slate-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">Finance document uploaded</p>
                <a href={financeDocUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">View document →</a>
              </div>
              <button
                onClick={() => setFinanceDocUrl('')}
                className="p-1 text-slate-400 hover:text-red-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex flex-col items-center justify-center w-full py-8 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 hover:border-slate-400 hover:text-slate-600 transition-colors"
            >
              {uploading ? (
                <><Loader2 className="w-6 h-6 animate-spin mb-2" /><span className="text-sm">Uploading...</span></>
              ) : (
                <><Upload className="w-6 h-6 mb-2" /><span className="text-sm font-medium">Click to upload PDF</span><span className="text-xs mt-1">Finance options, 0% APR terms, etc.</span></>
              )}
            </button>
          )}
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleUpload} />
        </div>
      </section>
    </div>
  );
}