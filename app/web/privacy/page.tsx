import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/web/LegalPage";
import { CONTACT_EMAIL, REPO_URL, SITE_URL } from "@/lib/site/links";

export const metadata: Metadata = {
  title: "Privacy · VYXO",
  description: "What VYXO and this website do and do not collect. Short version: nothing.",
  alternates: { canonical: "/web/privacy" },
};

const siteHost = new URL(SITE_URL).host;

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="19 October 2026"
      summary="VYXO is built so that there is nothing to collect. The app runs on your computer and sends your content nowhere. This page says exactly what does and does not leave your machine."
    >
      <LegalSection number={1} heading="The short version">
        <p>
          We do not collect, receive, store, or sell your conversations, files, memories, or any other content. There
          are no accounts, no analytics, and no tracking in the app or on this website.
        </p>
      </LegalSection>

      <LegalSection number={2} heading="The VYXO app">
        <p>
          VYXO runs entirely on your computer and talks to models served by{" "}
          <strong>Ollama on your own machine</strong>. Your messages go from the app to Ollama over a local connection
          (<code className="font-mono text-[13px]">127.0.0.1</code>) and nowhere else.
        </p>
        <p>The app stores the following in a folder on your computer, readable only by your user account:</p>
        <ul>
          <li>Conversations and their messages</li>
          <li>Projects, including the notes you write for each one and the folder you connected</li>
          <li>Memories you save</li>
          <li>Your settings, such as the selected model</li>
          <li>Edit proposals and recovery copies, if you use project edits</li>
        </ul>
        <p>
          On macOS this folder is <code className="font-mono text-[13px]">~/Library/Application Support/VYXO Data</code>
          . You can open it, copy it, or delete it at any time. Deleting it removes everything VYXO has saved.
        </p>
        <p>
          Project folders are read-only. Files you select are read by the app and shown to your local model for that
          request. They are not copied elsewhere.
        </p>
      </LegalSection>

      <LegalSection number={3} heading="The only times the app uses the internet">
        <ul>
          <li>
            <strong>Research.</strong> When you run the Research tool, the app makes a plain HTTPS request for each
            documentation page you list. It only accepts pages from a short built-in list of sites (React, Next.js,
            MDN, Node.js, Python docs, npm docs, TypeScript, Tailwind CSS, and Ollama), and you can add more yourself
            with a setting. Those sites can see your IP address and which page was requested, as with any browser.
            The request contains only the plain page address (addresses with a query string are rejected): your
            research question and your files stay on your computer and go only to your local model. Redirects are
            not followed.
          </li>
          <li>
            <strong>Update checks.</strong> The desktop app periodically asks GitHub Releases whether a newer version
            exists. GitHub receives a request from your IP address and can see the app version, under{" "}
            <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement">
              GitHub&apos;s privacy statement
            </a>
            . Set <code className="font-mono text-[13px]">VYXO_DISABLE_UPDATES=1</code> to turn this off.
          </li>
          <li>
            <strong>Links.</strong> When you click a link, it opens in your normal browser, which is then governed by
            that site&apos;s own policy.
          </li>
          <li>
            <strong>Downloading models.</strong> Ollama downloads models when you ask it to. That is Ollama&apos;s
            software, covered by its own terms and privacy policy.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number={4} heading="This website">
        <p>
          The website at {siteHost} is a set of static pages. It sets no cookies, runs no analytics or advertising
          scripts, and does not ask you for any information. Its fonts are served from the same site, so your browser
          does not contact a font provider.
        </p>
        <p>
          The site is hosted on Vercel. Like any web host, Vercel keeps standard server logs (such as IP address,
          browser type, and the pages requested) for security and operations. We do not use these logs to identify
          you. See{" "}
          <a href="https://vercel.com/legal/privacy-policy">Vercel&apos;s privacy policy</a> for how it handles them.
        </p>
        <p>
          If you email us, we receive your email address and message, and we use them only to reply. Links to GitHub
          take you to a service with its own privacy practices.
        </p>
      </LegalSection>

      <LegalSection number={5} heading="Models and their output">
        <p>
          The models you run locally are provided by third parties under their own licenses. Running them on your
          machine means your prompts are not sent to those third parties, but their output can still be inaccurate or
          biased. Review anything important before you rely on it.
        </p>
      </LegalSection>

      <LegalSection number={6} heading="Sensitive and regulated information">
        <p>
          Keeping data on your own computer can help with confidentiality, but it does not by itself satisfy any legal
          or professional duty. If you handle privileged, health, financial, or personal data, you remain responsible
          for your obligations, including securing your device (for example with disk encryption and a screen lock)
          and following your employer&apos;s or client&apos;s rules.
        </p>
      </LegalSection>

      <LegalSection number={7} heading="Children">
        <p>VYXO is a general-purpose tool and is not directed at children.</p>
      </LegalSection>

      <LegalSection number={8} heading="Changes to this page">
        <p>
          If the app starts doing anything that changes the above, we will update this page and the date at the top.
          The full source is public at <a href={REPO_URL}>{REPO_URL.replace("https://", "")}</a>, so you can check
          any claim here against the code.
        </p>
      </LegalSection>

      <LegalSection number={9} heading="Contact">
        <p>
          Questions about this page: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
