import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Sparkles, CheckCircle2, AlertCircle, Globe } from 'lucide-react';

/**
 * WebsiteScraper — paste a URL, hit "Auto-fill from website", and get back
 * a structured clinic summary. Pure presentational + a single function call;
 * the caller decides what to do with the extracted data via onExtracted.
 *
 * Pathir slate-anchored palette throughout — no shadcn `bg-card` /
 * `border-border` tokens. Spinner uses the same border-t-{slate,white}
 * pattern as the rest of the dashboard.
 *
 * Props:
 *   practiceId   string  — required (server-side ownership check)
 *   initialUrl   string  — pre-fill the URL input
 *   industry     string  — 'dental' | 'hair_transplant' (optional hint)
 *   onExtracted  (data, mode) => void — called with the extracted JSON
 *                  on success; `mode` is 'live' or 'stub' so the caller can
 *                  show a notice when running without ANTHROPIC_API_KEY
 *   variant      'compact' | 'full' — compact = single-line button, full =
 *                  the full progress card and result summary
 */
export default function WebsiteScraper({
  practiceId,
  initialUrl = '',
  industry,
  onExtracted,
  variant = 'full',
}) {
  const [url, setUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async () => {
    if (!url.trim() || !practiceId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress(15);
    setStep('Reading the website…');

    /* The progress bar is cosmetic — the real work is one round-trip. We
       step it forward at predictable points so the user has feedback that
       the request is alive. The function itself takes 5–15s. */
    const tick = setInterval(() => {
      setProgress((p) => (p < 80 ? p + 5 : p));
    }, 600);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('scrape-website', {
        body: { practiceId, url: url.trim(), industry },
      });
      if (fnErr) throw fnErr;
      if (!data?.ok) throw new Error(data?.error || 'Scrape failed');

      setStep('Tidying up the details…');
      setProgress(95);
      setResult({ extracted: data.extracted, mode: data.mode });
      setProgress(100);
      setStep('Done');
      onExtracted?.(data.extracted, data.mode);
    } catch (e) {
      setError(e.message || 'Could not scrape that URL.');
    } finally {
      clearInterval(tick);
      setLoading(false);
    }
  };

  if (variant === 'compact') {
    return (
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 relative">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourclinic.co.uk"
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent text-sm"
            disabled={loading}
          />
        </div>
        <button
          type="button"
          onClick={run}
          disabled={!url.trim() || loading}
          className="px-4 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
        >
          {loading ? (
            <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Scraping…</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Auto-fill</>
          )}
        </button>
        {error && <p className="text-xs text-red-600 sm:basis-full">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yourclinic.co.uk"
              className="w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              disabled={loading}
            />
          </div>
          <button
            type="button"
            onClick={run}
            disabled={!url.trim() || loading}
            className="px-5 py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Scraping…</>
            ) : (
              <><Sparkles className="w-4 h-4" /> Auto-fill from website</>
            )}
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          We&apos;ll read your website and pre-fill clinic details, services, hours and staff. You can edit everything afterwards.
        </p>
      </div>

      {loading && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-4 h-4 border-2 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
            <p className="text-sm font-medium text-slate-700">{step}</p>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-slate-900 h-1.5 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">Couldn&apos;t scrape that page</p>
            <p className="text-sm text-red-600 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <div className="flex items-start gap-3 mb-4">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-emerald-900">
                {result.mode === 'stub'
                  ? 'Sample fill (Anthropic key not set — using stub data)'
                  : `Read ${result.extracted.name || 'your website'} successfully`}
              </p>
              <p className="text-sm text-emerald-700 mt-0.5">
                Review the pre-filled fields below — anything missing or wrong, edit before continuing.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="Services" value={result.extracted.services?.length || 0} />
            <Stat label="Staff" value={result.extracted.staff?.length || 0} />
            <Stat label="FAQs"  value={result.extracted.faqs?.length || 0} />
            <Stat label="Hours rows" value={result.extracted.business_hours?.length || 0} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-white/70 rounded-lg p-2.5">
      <p className="text-xs text-emerald-700">{label}</p>
      <p className="text-lg font-semibold text-emerald-900 leading-tight">{value}</p>
    </div>
  );
}
