import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <ErrorBoundary>
          <NetworkStatus />
          {children}
        </ErrorBoundary>
      </body>
    </html>
  )
}
