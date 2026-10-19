import Image from "next/image";
import Link from "next/link";
import logoWhite from "../../public/brand/logo-white.svg";
import { PLATFORM_NOTE, RELEASES_URL, REPO_URL } from "@/lib/site/links";

const links = [
  { label: "Who it's for", href: "/web#who" },
  { label: "How it works", href: "/web#how" },
  { label: "Compare", href: "/web#compare" },
  { label: "Get started", href: "/web#start" },
];

export function SiteNav() {
  const publicSite = process.env.VYXO_PUBLIC_SITE === "1";

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--background)]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center gap-8 px-5 sm:px-8">
        <Link
          href="/web"
          aria-label="VYXO home"
          className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Image src={logoWhite} alt="VYXO" width={753} height={240} priority className="h-6 w-auto" />
        </Link>

        <nav aria-label="Site" className="hidden items-center gap-7 text-sm text-[var(--muted)] md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition hover:text-[var(--foreground)] focus-visible:text-[var(--foreground)] focus-visible:outline-none"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-sm">
          {publicSite ? null : (
            <Link href="/chat" className="hidden text-[var(--muted)] transition hover:text-[var(--foreground)] sm:inline">
              Open the app
            </Link>
          )}
          <a
            href={REPO_URL}
            className="hidden text-[var(--muted)] transition hover:text-[var(--foreground)] sm:inline"
          >
            GitHub
          </a>
          <a
            href={RELEASES_URL}
            title={PLATFORM_NOTE}
            aria-label={`Download. ${PLATFORM_NOTE}`}
            className="rounded-full bg-[var(--foreground)] px-4 py-2 font-medium text-[var(--background)] transition hover:bg-[var(--silver)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
          >
            Download
          </a>
        </div>
      </div>
    </header>
  );
}
