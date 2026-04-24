/**
 * Purpose: Terms of Service page. Meta's OAuth flow requires a Terms URL
 * alongside the Privacy Policy before an app can receive production
 * permissions. Minimal B2B-SaaS terms covering use of the Pathir dashboard.
 *
 * Dependencies: react-router-dom.
 * Used by: App.jsx route "/terms" (public).
 * Changes: 2026-04-24 Initial creation for Meta App Review.
 */

import React from 'react';
import { Link } from 'react-router-dom';

export default function Terms() {
  const lastUpdated = '24 April 2026';
  const contactEmail = 'admin2025@pathir.com';

  return (
    <div className="min-h-screen bg-white text-slate-800">
      <div className="max-w-3xl mx-auto px-6 py-12 md:py-16">
        <header className="mb-10 border-b border-slate-200 pb-6">
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-700">← Pathir</Link>
          <h1 className="mt-4 text-3xl font-semibold text-slate-900">Terms of Service</h1>
          <p className="mt-1 text-sm text-slate-500">Last updated: {lastUpdated}</p>
        </header>

        <section className="space-y-4 text-[15px] leading-relaxed">
          <p>
            These terms govern your use of Pathir, an AI-powered assistant for
            dental practices. By using Pathir, you agree to these terms.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Who these terms apply to</h2>
          <p className="text-[15px] leading-relaxed">
            These terms apply to the dental practice operating a Pathir account
            ("the Practice") and to its staff who access the dashboard. Patients
            communicating through a practice's connected channels are governed
            by the Practice's own patient agreement and our{' '}
            <Link to="/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Use of the service</h2>
          <ul className="list-disc pl-6 space-y-1 text-[15px] leading-relaxed">
            <li>The Practice may use Pathir to handle enquiries, book appointments, and communicate with patients over any connected channel.</li>
            <li>The Practice is responsible for the accuracy of practitioner names, service descriptions, prices, and opening hours configured in the dashboard.</li>
            <li>The Practice must not use Pathir for marketing to individuals who have not consented, or for any unlawful communication.</li>
          </ul>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">AI-generated replies</h2>
          <p className="text-[15px] leading-relaxed">
            Pathir uses large language models to generate replies. While we
            configure the assistant to behave within practice guidelines, the
            Practice is responsible for reviewing booked appointments, payment
            requests, and any clinical information the assistant may have
            volunteered.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Availability</h2>
          <p className="text-[15px] leading-relaxed">
            We aim for continuous availability but do not guarantee it.
            Downtime may be caused by upstream providers (Supabase, ElevenLabs,
            Twilio, TextMagic, Meta). The Practice should maintain its own
            voice and email fallbacks for patient communication.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Termination</h2>
          <p className="text-[15px] leading-relaxed">
            Either party may terminate at any time. On termination the Practice
            may export enquiry and appointment data; we delete operational
            records within 30 days unless a longer retention is legally
            required.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Liability</h2>
          <p className="text-[15px] leading-relaxed">
            Pathir is provided on an "as is" basis. Our aggregate liability for
            any claim is limited to fees paid in the twelve months preceding
            the claim. Nothing in these terms limits liability that cannot be
            excluded under English law.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Governing law</h2>
          <p className="text-[15px] leading-relaxed">
            These terms are governed by the laws of England and Wales. Disputes
            are subject to the exclusive jurisdiction of the English courts.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Contact</h2>
          <p className="text-[15px] leading-relaxed">
            <a className="text-blue-600 hover:underline" href={`mailto:${contactEmail}`}>{contactEmail}</a>
          </p>
        </section>
      </div>
    </div>
  );
}
