import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Workplace & Day Off Calendar",
  description: "Team workplace and day off calendar",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
