import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // sign-ai-media/@contentauth/c2pa-node ships native bindings, die ihren eigenen Bundle-Pfad
  // relativ auflösen - Turbopacks Server-Action-Bundling bricht diese Auflösung (Fehler
  // "path argument must be of type string ... Received an instance of URL"). Native require
  // statt Bundling umgeht das, gleiches Muster wie sharp/bcrypt etc. "sharp" kam mit
  // image-compositing.ts dazu (erster echter Einsatz im Server-Code) und braucht denselben Eintrag
  // - ohne ihn crasht jede Server-Component, die es importiert (z.B. products/[id]/page.tsx über
  // hasCompositingSupport), mit Internal Server Error, weil Turbopack sharps native .node-Bindings
  // falsch bündelt.
  serverExternalPackages: ["sign-ai-media", "@contentauth/c2pa-node", "sharp"],
  // sharp lädt seine native libvips-Bibliothek zur Laufzeit per dlopen() nach - das kann Next.js'
  // statisches File-Tracing (@vercel/nft, folgt nur import/require/fs-Aufrufen im JS) nicht
  // erkennen, weil der dlopen()-Aufruf innerhalb der kompilierten .node-Binärdatei passiert, nicht
  // im JS selbst. Ergebnis auf Vercel: "ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open
  // shared object file" - der Serverless-Bundle enthält die .so-Datei schlicht nicht. Explizites
  // outputFileTracingIncludes zwingt Next.js, sharp + die zugehörigen libvips-Linux-Binaries für
  // JEDE Route (Glob "/**") mit einzupacken, unabhängig davon, wo Compositing aufgerufen wird.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/@img/sharp-linux-x64/**/*", "./node_modules/@img/sharp-libvips-linux-x64/**/*"],
  },
  images: {
    // Diamond-Group-Bildserver liefert nur HTTP (Mixed-Content auf HTTPS-Seiten) -
    // next/image holt die Bilder serverseitig und liefert sie same-origin über HTTPS aus.
    remotePatterns: [
      {
        protocol: "http",
        hostname: "195.4.159.226",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
