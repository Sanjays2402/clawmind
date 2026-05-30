import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import '../styles/globals.css';
import { CommandPalette } from '@/components/CommandPalette';

export const metadata: Metadata = {
  title: 'ClawMind',
  description: 'Local-first RAG over your OpenClaw workspace.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        {children}
        <CommandPalette />
      </body>
    </html>
  );
}
