import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/web/LegalPage";
import { CONTACT_EMAIL, REPO_URL, SITE_URL } from "@/lib/site/links";

export const metadata: Metadata = {
  title: "Terms · VYXO",
  description: "The terms for using the VYXO software and website.",
  alternates: { canonical: "/web/terms" },
};

const siteHost = new URL(SITE_URL).host;

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      updated="19 October 2026"
      summary="VYXO is free, open-source software. You can use, change, and share it under the MIT license. It comes as it is, without warranties, and you are responsible for how you use it."
    >
      <LegalSection number={1} heading="What these terms cover">
        <p>
          These terms apply to the VYXO desktop and web software (&ldquo;VYXO&rdquo;) and to the website at {siteHost}.
          By downloading, installing, or using them you agree to these terms. If you do not agree, do not use them.
        </p>
      </LegalSection>

      <LegalSection number={2} heading="License">
        <p>
          The VYXO source code is released under the{" "}
          <a href={`${REPO_URL}/blob/main/LICENSE`}>MIT license</a>. That license is what gives you the right to use,
          copy, modify, merge, publish, distribute, sublicense, and sell copies of the software. These terms do not
          take any of those rights away. If anything here conflicts with the MIT license, the MIT license wins for the
          source code.
        </p>
        <p>
          The VYXO name and logo identify this project. You may use them to refer to it accurately, but please do not
          suggest that a modified version is the official one.
        </p>
      </LegalSection>

      <LegalSection number={3} heading="Your content and your data">
        <p>
          Everything you create or load in VYXO stays on your computer and belongs to you. We do not receive it, and we
          claim no rights in it. You are responsible for the content you put in, and for having the right to use it
          this way.
        </p>
        <p>
          You are also responsible for backing it up. VYXO does not sync to any server, so if you delete the data
          folder or lose the device, we cannot recover it. See the <a href="/web/privacy">Privacy page</a> for what is
          stored and where.
        </p>
      </LegalSection>

      <LegalSection number={4} heading="Using VYXO responsibly">
        <ul>
          <li>Use it lawfully, and do not use it to harm others or to break anyone&apos;s rights.</li>
          <li>
            <strong>AI output can be wrong.</strong> Models can state false things with confidence, miss details, and
            reflect bias. Check anything that matters before you rely on it.
          </li>
          <li>
            <strong>Not professional advice.</strong> Nothing VYXO produces is legal, medical, financial, or other
            professional advice, and it does not create any professional relationship.
          </li>
          <li>
            <strong>Review changes before you approve them.</strong> VYXO can propose edits to files in a folder you
            connect, and only writes them after you approve. You are responsible for what you approve.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number={5} heading="Confidential and regulated work">
        <p>
          VYXO is designed so that your content is processed on your own machine. That is a tool, not a guarantee of
          compliance. Whether using VYXO is permitted for privileged, personal, health, financial, or contractually
          confidential material depends on your own duties, your employer&apos;s policies, and your clients&apos;
          requirements. Check those before you use it, and keep your device secure.
        </p>
      </LegalSection>

      <LegalSection number={6} heading="Third-party software and models">
        <p>
          VYXO works with software we do not control, including Ollama, the language models you choose to run, Electron,
          and Next.js. They are provided under their own licenses and terms, which you must follow. We are not
          affiliated with their authors, and we do not control or guarantee them.
        </p>
      </LegalSection>

      <LegalSection number={7} heading="Updates">
        <p>
          The desktop app checks for new versions and asks before installing one. You can turn checking off. We may
          change or stop providing VYXO at any time.
        </p>
      </LegalSection>

      <LegalSection number={8} heading="No warranty">
        <p>
          <strong>
            VYXO and this website are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranty of
            any kind, express or implied,
          </strong>{" "}
          including warranties of merchantability, fitness for a particular purpose, accuracy, and non-infringement. We
          do not promise that VYXO will be uninterrupted, error-free, or secure, or that its output will be correct.
        </p>
      </LegalSection>

      <LegalSection number={9} heading="Limitation of liability">
        <p>
          To the fullest extent the law allows, the authors and contributors are not liable for any indirect,
          incidental, special, consequential, or punitive damages, or for any loss of data, profits, or goodwill,
          arising from your use of or inability to use VYXO, even if we were told it was possible. Nothing in these
          terms limits liability that cannot be limited by law.
        </p>
      </LegalSection>

      <LegalSection number={10} heading="Changes to these terms">
        <p>
          We may update these terms. The date at the top shows when they last changed, and the history is public in the
          project&apos;s repository. Continuing to use VYXO after a change means you accept the new terms.
        </p>
      </LegalSection>

      <LegalSection number={11} heading="Contact">
        <p>
          Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. To report a security
          problem, use{" "}
          <a href={`${REPO_URL}/security/advisories/new`}>GitHub&apos;s private reporting</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
