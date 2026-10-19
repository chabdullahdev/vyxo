import Image from "next/image";
import Link from "next/link";
import logoWhite from "../../public/brand/logo-white.svg";
import { CONTACT_EMAIL, DOWNLOAD_URL, ISSUES_URL, PLATFORM_NOTE, REPO_URL } from "@/lib/site/links";

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">{title}</h2>
      <ul className="mt-4 space-y-2.5 text-sm">{children}</ul>
    </div>
  );
}

const linkClass =
  "text-[var(--silver)] transition hover:text-[var(--foreground)] focus-visible:text-[var(--foreground)] focus-visible:outline-none";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)]">
      <div className="mx-auto grid w-full max-w-[1240px] gap-12 px-5 py-16 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Image src={logoWhite} alt="VYXO" width={753} height={240} className="h-6 w-auto" />
          <p className="mt-5 max-w-xs text-sm leading-6 text-[var(--muted)]">
            A private AI workspace that runs on your own computer.
          </p>
        </div>
        <Column title="Product">
          <li><a className={linkClass} href={DOWNLOAD_URL}>Download</a></li>
          <li className="max-w-[22ch] text-xs leading-5 text-[var(--muted)]">{PLATFORM_NOTE}</li>
          <li><a className={linkClass} href={REPO_URL}>Source code</a></li>
          <li><a className={linkClass} href={ISSUES_URL}>Report an issue</a></li>
        </Column>
        <Column title="Legal">
          <li><Link className={linkClass} href="/web/terms">Terms</Link></li>
          <li><Link className={linkClass} href="/web/privacy">Privacy</Link></li>
          <li><a className={linkClass} href={`${REPO_URL}/blob/main/LICENSE`}>MIT license</a></li>
        </Column>
        <Column title="Contact">
          <li><a className={linkClass} href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></li>
        </Column>
      </div>
      <div className="border-t border-[var(--line)]">
        <p className="mx-auto w-full max-w-[1240px] px-5 py-6 text-xs leading-5 text-[var(--muted)] sm:px-8">
          © 2026 Muhammad Abdullah. Free software under the MIT license. VYXO is an independent project and is not
          affiliated with Ollama or any model provider.
        </p>
      </div>
    </footer>
  );
}
