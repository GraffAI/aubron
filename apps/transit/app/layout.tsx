import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Puget Sound Transit — Live",
  description:
    "Puget Sound transit, live — a bespoke WebGL map of every Link train, Sounder, streetcar and bus in motion.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Transit",
  },
  formatDetection: { telephone: false },
};

// A full-screen map: the canvas owns pinch/drag (so no page zoom), edge-to-edge
// under notches (viewport-fit=cover; overlays pad with safe-area insets).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#05070a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
