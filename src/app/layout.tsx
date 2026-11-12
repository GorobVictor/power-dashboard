import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { themes, themeStorageKey } from "@/lib/themes";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Power Dashboard", template: "%s · Power Dashboard" },
  description: "Стан акумулятора Marstek і графіки відключень електроенергії.",
  appleWebApp: {
    capable: true,
    title: "Power Dashboard",
    statusBarStyle: "default",
  },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#11171f" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="uk"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Script id="theme-init" strategy="beforeInteractive">{`try { var theme = localStorage.getItem(${JSON.stringify(themeStorageKey)}); if (${JSON.stringify(themes.map(({ id }) => id))}.includes(theme)) document.documentElement.dataset.theme = theme; } catch {}`}</Script>
        {children}
      </body>
    </html>
  );
}
