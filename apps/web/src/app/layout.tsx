import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Serif, Newsreader } from "next/font/google";
import "./globals.css";
import { APPLE_TOUCH_ICON, BACKGROUND_COLOR, THEME_COLOR } from "@/lib/manifest";
import { SwRegister } from "@/components/sw-register";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "North",
    template: "%s · North",
  },
  description: "The operating system for a one-person company. You decide; agents execute.",
  applicationName: "North",
  // PWA-1: `app/manifest.ts` adds the manifest link; iOS reads these instead.
  appleWebApp: { capable: true, title: "North", statusBarStyle: "black" },
  icons: { apple: [{ url: APPLE_TOUCH_ICON, sizes: "180x180", type: "image/png" }] },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BACKGROUND_COLOR },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSerif.variable} ${newsreader.variable} ${geistMono.variable}`}>
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
