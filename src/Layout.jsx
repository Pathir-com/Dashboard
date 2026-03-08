import React from 'react';

export default function Layout({ children, currentPageName }) {
  return (
    <>
      <style>{`
        /* Hide Base44 branding popup */
        #base44-branding,
        [id*="base44-badge"],
        [class*="base44-badge"],
        [class*="base44-branding"] {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }
      `}</style>
      {children}
    </>
  );
}