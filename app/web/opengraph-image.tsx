import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

export const alt = "VYXO: an AI workspace that never leaves your computer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand values from public/brand and app/globals.css.
const BACKGROUND = "#09080c";
const FOREGROUND = "#f5f4fa";
const MUTED = "#8d8b9a";
const VIOLET = "#8259ff";

export default async function OpenGraphImage() {
  const [font, logo] = await Promise.all([
    readFile(path.join(process.cwd(), "app/web/fonts/SpaceGrotesk-SemiBold.ttf")),
    readFile(path.join(process.cwd(), "public/brand/logo-white.svg")),
  ]);
  const logoSrc = `data:image/svg+xml;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: BACKGROUND,
          backgroundImage:
            "radial-gradient(circle at 88% 8%, rgba(130,89,255,0.35) 0%, rgba(130,89,255,0) 55%)",
          color: FOREGROUND,
          fontFamily: "Space Grotesk",
        }}
      >
        <img src={logoSrc} width={188} height={60} alt="" />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 84,
              lineHeight: 1.04,
              letterSpacing: "-0.04em",
            }}
          >
            <span>An AI workspace that</span>
            <span>never leaves</span>
            <span style={{ color: VIOLET }}>your computer.</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            fontSize: 30,
            color: MUTED,
          }}
        >
          <span>Private</span>
          <span style={{ color: VIOLET }}>·</span>
          <span>Runs on Ollama</span>
          <span style={{ color: VIOLET }}>·</span>
          <span>Free and open source</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Space Grotesk", data: font, weight: 600, style: "normal" }],
    },
  );
}
