/**
 * Purpose: Data Deletion page required by Meta. Explains how a user can
 * request deletion of the personal data Pathir holds on behalf of a
 * practice. Complements the Privacy Policy page.
 *
 * Dependencies: react-router-dom.
 * Used by: App.jsx route "/data-deletion" (public).
 * Changes: 2026-04-24 Initial creation for Meta App Review.
 */

import React from 'react';
import { Link } from 'react-router-dom';

export default function DataDeletion() {
  const contactEmail = 'admin2025@pathir.com';
  const lastUpdated = '24 April 2026';

  return (
    <div className="min-h-screen bg-white text-slate-800">
      <div className="max-w-3xl mx-auto px-6 py-12 md:py-16">
        <header className="mb-10 border-b border-slate-200 pb-6">
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-700">← Pathir</Link>
          <h1 className="mt-4 text-3xl font-semibold text-slate-900">Data Deletion</h1>
          <p className="mt-1 text-sm text-slate-500">Last updated: {lastUpdated}</p>
        </header>

        <section className="space-y-4 text-[15px] leading-relaxed">
          <p>
            This page explains how to request deletion of personal data that
            Pathir holds about you on behalf of a dental practice. See our{' '}
            <Link to="/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>{' '}
            for the broader context.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">What gets deleted</h2>
          <ul className="list-disc pl-6 space-y-1 text-[15px] leading-relaxed">
            <li>Your contact record (name, phone, email, linked social identifiers).</li>
            <li>All enquiry records generated from your communication.</li>
            <li>All message history across voice calls, SMS, Facebook Messenger, Instagram, and website chat.</li>
            <li>Any appointment bookings or payment references linked to you.</li>
          </ul>
          <p className="text-[15px] leading-relaxed">
            Deletion is permanent. We cannot restore deleted records later.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">How to request deletion</h2>
          <p className="text-[15px] leading-relaxed">
            Email <a className="text-blue-600 hover:underline" href={`mailto:${contactEmail}?subject=Data%20Deletion%20Request`}>{contactEmail}</a> with the subject line "Data Deletion Request" and include:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-[15px] leading-relaxed">
            <li>The name of the dental practice you communicated with.</li>
            <li>The phone number, email address, or Facebook/Instagram handle you used.</li>
            <li>Confirmation that you are the owner of the contact details provided.</li>
          </ul>
          <p className="text-[15px] leading-relaxed">
            If you connected via Facebook Messenger or Instagram, you can also
            trigger a deletion by revoking Pathir's access in Facebook
            Settings → Apps and Websites. We will receive Meta's deauthorisation
            callback and remove the linked identifiers; any other records under
            the same contact remain until you email us.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Timeline</h2>
          <p className="text-[15px] leading-relaxed">
            We acknowledge requests within 2 working days and complete deletion
            within 30 days of receipt, as required by UK GDPR Article 12. You
            will receive written confirmation once deletion is complete.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Limits</h2>
          <p className="text-[15px] leading-relaxed">
            Some minimal records may be retained where a legal obligation
            requires it (for example, financial records tied to a payment you
            made). These are kept for the shortest period permitted and are
            never used for any other purpose.
          </p>
        </section>

        <footer className="mt-16 pt-6 border-t border-slate-200 text-xs text-slate-400">
          If you do not receive a response within 2 working days, or if you
          wish to complain about how we handled your request, you can contact
          the UK Information Commissioner's Office (ICO) at{' '}
          <a href="https://ico.org.uk/make-a-complaint/" className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">ico.org.uk/make-a-complaint</a>.
        </footer>
      </div>
    </div>
  );
}
