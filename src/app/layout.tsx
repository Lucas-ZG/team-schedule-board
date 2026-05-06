import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Team Schedule",
  description: "Team workplace and day off calendar",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
