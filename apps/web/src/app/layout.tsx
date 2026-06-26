import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';
import '../styles/globals.css';
import { CommandPalette } from '@/components/CommandPalette';
import { DocumentTitle } from '@/components/DocumentTitle';
import { RecentPagesRecorder } from '@/components/RecentPagesRecorder';
import { PwaInstall } from '@/components/PwaInstall';
import { ShortcutHelp } from '@/components/ShortcutHelp';
import { ToastProvider } from '@clawmind/ui';

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--font-fraunces',
});

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'ClawMind',
  description: 'A quiet, local place to ask questions of your own workspace.',
  manifest: '/manifest.webmanifest',
  applicationName: 'ClawMind',
  appleWebApp: {
    capable: true,
    title: 'ClawMind',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
      { url: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
    ],
    apple: '/icon-192.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#7c5cff',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${fraunces.variable} ${inter.variable} ${mono.variable}`}
    >
      <body>
        <ToastProvider>
          <DocumentTitle />
          <RecentPagesRecorder />
          {children}
          <CommandPalette />
          <ShortcutHelp />
          <PwaInstall />
        </ToastProvider>
      </body>
    </html>
  );
}
