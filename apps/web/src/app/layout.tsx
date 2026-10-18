import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'PharmacyOS — Modern Pharmacy Management & POS',
  description: 'Point-of-sale, batch-level FEFO inventory, purchasing, and reporting system for community pharmacies in Pakistan.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-[#F4F7F6] text-[#122A36]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
