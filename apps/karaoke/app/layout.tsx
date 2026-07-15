import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "aubron karaoke",
  description:
    "Modern cloud-native karaoke — stem-split playback, live mic mixing, timed lyrics, and a retro CDG mode.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
