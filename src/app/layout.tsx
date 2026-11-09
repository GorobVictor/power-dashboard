import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Power Dashboard", template: "%s · Power Dashboard" },
  description: "Стан акумулятора Marstek і графіки відключень електроенергії.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="uk"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
