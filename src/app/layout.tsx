import type { Metadata, Viewport } from 'next';
import './globals.css';

// Fonts are loaded exactly as in reference/add-more-check-demo.html (same Google Fonts stylesheet, same weights,
// same unicode ranges), so glyphs such as ₹ render from Inter and line breaks match the approved design.
export const metadata: Metadata = {
  title: 'Add-More Check — Upstox Pro',
  description: 'What a BUY order does to a position you already hold — on the live Upstox Developer API.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- must match the reference stylesheet byte for byte */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
