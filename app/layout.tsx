import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import ErrorBoundary from '@/components/ErrorBoundary'
import NetworkStatus from '@/components/NetworkStatus'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'ArenaGrade — Book Your Court Online',
  description: 'ArenaGrade designs and constructs world-class sports courts across Sri Lanka. Book basketball, squash, netball courts online.',
  keywords: 'court booking, basketball court, Sri Lanka, ArenaGrade, sports court',
  openGraph: {
    title: 'ArenaGrade — Book Your Court Online',
    description: 'Book world-class sports courts across Sri Lanka',
    type: 'website',
  },
}

const GA_ID = 'G-6NCWDQCP50'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        {/* Google Analytics */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_ID}', {
              page_path: window.location.pathname,
            });
          `}
        </Script>
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ErrorBoundary>
          <NetworkStatus />
          {children}
        </ErrorBoundary>
      </body>
    </html>
  )
}
