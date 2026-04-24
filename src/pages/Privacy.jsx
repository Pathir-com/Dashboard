/**
 * Purpose: Privacy Policy page required by Meta, TextMagic, and Apple/Google
 * review processes for any integration that handles patient communication.
 * Content focuses on what data flows through Pathir and how it's stored in
 * Supabase.
 *
 * Dependencies: react-router-dom (for <Link>), Vite/React baseline.
 * Used by: App.jsx route "/privacy" (public).
 * Changes: 2026-04-24 Initial creation for Meta App Review.
 */

import React from 'react';
import { Link } from 'react-router-dom';

export default function Privacy() {
  const lastUpdated = '24 April 2026';
  const contactEmail = 'admin2025@pathir.com';

  return (
    <div className="min-h-screen bg-white text-slate-800">
      <div className="max-w-3xl mx-auto px-6 py-12 md:py-16">
        <header className="mb-10 border-b border-slate-200 pb-6">
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-700">← Pathir</Link>
          <h1 className="mt-4 text-3xl font-semibold text-slate-900">Privacy Policy</h1>
          <p className="mt-1 text-sm text-slate-500">Last updated: {lastUpdated}</p>
        </header>

        <section className="space-y-4 text-[15px] leading-relaxed">
          <p>
            Pathir provides an AI-powered assistant that handles patient enquiries
            for dental practices across voice calls, SMS, Facebook Messenger,
            Instagram direct messages, and the practice's website chat. This
            policy describes what personal data we process on behalf of a
            practice, how it is stored, and your rights.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Who is the data controller</h2>
          <p className="text-[15px] leading-relaxed">
            The dental practice you contacted is the data controller for any
            conversation you have through their Pathir-powered channels. Pathir
            acts as a data processor on their behalf. Queries about your own
            data should go to the practice first; if they direct you to us,
            contact <a className="text-blue-600 hover:underline" href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">What we collect</h2>
          <ul className="list-disc pl-6 text-[15px] leading-relaxed space-y-1">
            <li>Your name, phone number, and email address when you provide them.</li>
            <li>The content of messages you send through any connected channel (voice transcripts, SMS bodies, chat messages, social DMs).</li>
            <li>Appointment preferences, service requests, and booking confirmations you generate.</li>
            <li>Basic channel metadata — the phone number, Facebook page, or Instagram account the message arrived on, and its timestamp.</li>
          </ul>
          <p className="text-[15px] leading-relaxed">
            We do not collect location data, device identifiers, advertising IDs, or any special-category health data beyond what you volunteer in your messages.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Where it is stored</h2>
          <p className="text-[15px] leading-relaxed">
            All enquiry, contact, conversation, and appointment records are
            stored in Supabase (hosted in the EU, region <code>eu-west-1</code>).
            Access is restricted by row-level security so each practice only
            sees its own data. Practice staff authenticate with their own
            credentials; Pathir administrators have service-role access only
            for support and debugging.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Who processes it on our behalf</h2>
          <ul className="list-disc pl-6 text-[15px] leading-relaxed space-y-1">
            <li><strong>Supabase</strong> — database, authentication, file storage (eu-west-1).</li>
            <li><strong>ElevenLabs</strong> — generates the AI assistant's replies from your message content.</li>
            <li><strong>Twilio</strong> and <strong>TextMagic</strong> — carry SMS and voice to and from your phone.</li>
            <li><strong>Meta</strong> — carries Facebook Messenger and Instagram messages.</li>
            <li><strong>Resend / Gmail SMTP</strong> — delivers appointment confirmation and reminder emails.</li>
            <li><strong>Stripe</strong> — processes any payment you make via a link sent by the practice.</li>
          </ul>
          <p className="text-[15px] leading-relaxed">
            Each processor has its own privacy practices. We share only the
            minimum data needed for them to carry out their function.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">How long we keep it</h2>
          <p className="text-[15px] leading-relaxed">
            Enquiries, contact records, and message history are retained for
            the lifetime of your relationship with the practice so staff can
            reference prior conversations. You may request deletion at any
            time (see below). We delete records sooner if the practice
            instructs us to.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Your rights</h2>
          <p className="text-[15px] leading-relaxed">
            Under UK GDPR and comparable EEA rules you have the right to:
          </p>
          <ul className="list-disc pl-6 text-[15px] leading-relaxed space-y-1">
            <li>Access a copy of the personal data we hold about you.</li>
            <li>Correct anything inaccurate.</li>
            <li>Request deletion (erasure).</li>
            <li>Restrict or object to certain processing.</li>
            <li>Receive your data in a portable format.</li>
            <li>Lodge a complaint with the UK ICO or your national supervisor.</li>
          </ul>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">How to delete your data</h2>
          <p className="text-[15px] leading-relaxed">
            See our <Link className="text-blue-600 hover:underline" to="/data-deletion">Data Deletion</Link> page for a step-by-step process, or email <a className="text-blue-600 hover:underline" href={`mailto:${contactEmail}`}>{contactEmail}</a> from the address or phone number you used to contact the practice. We confirm deletion within 30 days.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Contact</h2>
          <p className="text-[15px] leading-relaxed">
            Privacy questions: <a className="text-blue-600 hover:underline" href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </p>
        </section>

        <footer className="mt-16 pt-6 border-t border-slate-200 text-xs text-slate-400">
          Pathir is operated on behalf of individual dental practices. This policy is subject to change; material revisions will be announced via email to practices who will pass updates to their patients.
        </footer>
      </div>
    </div>
  );
}
