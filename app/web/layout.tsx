import { Instrument_Serif } from "next/font/google";
import { SiteFooter } from "@/components/web/SiteFooter";
import { SiteNav } from "@/components/web/SiteNav";

// One editorial italic for emphasis; everything else is the brand's Space Grotesk and DM Sans.
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export default function WebLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${serif.variable} web-root`}>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-[var(--foreground)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--background)]"
      >
        Skip to content
      </a>
      <SiteNav />
      <main id="content">{children}</main>
      <SiteFooter />
    </div>
  );
}
