import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "transit",
  description:
    "Puget Sound transit, live — a bespoke WebGL map of every Link train, Sounder, streetcar and bus in motion.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
