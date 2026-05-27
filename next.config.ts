import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // User-uploaded evidence (menu photos / PDFs) is served from our own origin.
        // Defense in depth so a file that slips past validation can never execute as
        // our origin: never sniff the type, sandbox it, and force download rather than
        // inline render. Images still display when opened directly; scripts/PDF JS
        // can't touch the app's cookies or DOM.
        source: "/uploads/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: "default-src 'none'; sandbox" },
          { key: "Content-Disposition", value: "attachment" },
        ],
      },
    ];
  },
};

export default nextConfig;
