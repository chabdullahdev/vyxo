/**
 * Starting points for a new workspace project. Each one is a handful of plain files the user
 * can read and edit. Nothing here loads anything from the internet.
 *
 * Folder names avoid the ones VYXO's file policy treats as build output (tmp, temp, build, out,
 * dist, vendor, env, target), so everything created here can be read and edited by the assistant.
 */

export type TemplateId = "blank" | "documents" | "client-matter" | "research" | "website-nextjs" | "website";

export interface WorkspaceTemplate {
  id: TemplateId;
  label: string;
  tagline: string;
  /** Who it suits, shown under the name. */
  suits: string;
  /** True when the project is a web page the Preview tab can show. */
  previewable: boolean;
  /** True when the project is built with the Next.js tools that ship with VYXO. */
  needsSiteDeps?: boolean;
  /** Extra instructions for Build mode, for projects that need more than plain files. */
  builderGuide?: string;
  files: (name: string) => Record<string, string>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Markdown headings can't hold line breaks; keep a project name to one safe line. */
function titleLine(name: string): string {
  return name.replace(/[\r\n]+/g, " ").trim();
}

const HOW_VYXO_HELPS = `## How to use this project

- **Chat** asks questions about your files. The assistant only sees this project.
- **Build** asks the assistant to create or change files. It shows you every change first, and nothing is written until you approve it.
- **Files** lets you add, rename, and delete files. Deleted files go to a trash you can restore from.
- **History** shows what was changed and lets you undo it.

Everything stays on your computer.
`;

const NEXTJS_BUILDER_GUIDE = `This project is a Next.js website. Its words and choices are in site/content.ts. The page design in app/page.tsx is finished: do not change it.

To change the site, write the whole file site/content.ts. It must keep this shape: export const site = { ... } as const; with these fields:
- name: the business name from the request. If the request names none, use the project title in README.md.
- tagline: one short line shown beside the hero.
- theme.accent: exactly one of "stone", "amber", "emerald", "rose", "indigo", "sky". Pick the one that fits: amber or emerald for food, sky for health or technology, stone for law or consulting, rose for beauty or design.
- nav: links to the sections, for example { label: "Menu", href: "#menu" }.
- cta: { label, href } for the main button.
- hero: { eyebrow, headline, subhead }.
- sections: 4 to 6 sections. Each has a unique id (the nav links use it) and one of these types:
  - { id, type: "features", title, intro, items: [{ title, text }] } (three items work best)
  - { id, type: "list", title, intro, items: [{ name, detail, price }] } (menus, services with prices)
  - { id, type: "steps", title, items: [{ title, text }] } (three steps for how it works)
  - { id, type: "hours", title, rows: [{ label, value }], note } (opening hours)
  - { id, type: "text", title, body: ["paragraph", "paragraph"] } (about, story)
- contact: { title, text, details: [{ label, value }] }, for example Email, Phone, Address.

Writing rules:
- Use the business name and the details the request gives. Item names and short descriptions may come from general knowledge of that kind of business.
- Write plain, specific sentences for a real customer. No lorem ipsum, no buzzwords, no emoji.
- Never invent a phone number, email address, street address, price, opening time, delivery or ordering option, or claim (awards, years in business, number of customers, days closed). For any of these the request does not give, write a clear placeholder such as "Add your price", "Add your opening hours", or "Add your phone number".
- Keep the file valid TypeScript: double quotes around strings, commas between items.
- Change other files only when the request needs something the content file cannot do, such as a new page. Otherwise leave them as they are.`;

const NEXTJS_PAGE = `import { site } from "../site/content";

// The layout is designed once, here. A site's words and choices live in site/content.ts.
const ACCENTS = {
  stone: { button: "bg-stone-900 hover:bg-stone-700", text: "text-stone-700", soft: "bg-stone-200", dot: "bg-stone-900" },
  amber: { button: "bg-amber-600 hover:bg-amber-700", text: "text-amber-700", soft: "bg-amber-100", dot: "bg-amber-500" },
  emerald: { button: "bg-emerald-700 hover:bg-emerald-800", text: "text-emerald-700", soft: "bg-emerald-100", dot: "bg-emerald-600" },
  rose: { button: "bg-rose-600 hover:bg-rose-700", text: "text-rose-700", soft: "bg-rose-100", dot: "bg-rose-500" },
  indigo: { button: "bg-indigo-600 hover:bg-indigo-700", text: "text-indigo-700", soft: "bg-indigo-100", dot: "bg-indigo-500" },
  sky: { button: "bg-sky-600 hover:bg-sky-700", text: "text-sky-700", soft: "bg-sky-100", dot: "bg-sky-500" },
};

function SectionHeading({ title, intro }) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">{title}</h2>
      {intro ? <p className="mt-4 text-lg leading-relaxed text-stone-600">{intro}</p> : null}
    </div>
  );
}

function SectionBody({ section, accent }) {
  const items = section.items ?? [];
  if (section.type === "features") {
    return (
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {items.map((item, i) => (
          <div key={i} className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <div className={"h-2 w-10 rounded-full " + accent.dot} />
            <h3 className="mt-5 text-lg font-semibold text-stone-900">{item.title}</h3>
            <p className="mt-2 leading-relaxed text-stone-600">{item.text}</p>
          </div>
        ))}
      </div>
    );
  }
  if (section.type === "list") {
    return (
      <ul className="mt-12 divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white">
        {items.map((item, i) => (
          <li key={i} className="flex flex-wrap items-start justify-between gap-4 px-6 py-5">
            <div>
              <p className="font-medium text-stone-900">{item.name}</p>
              {item.detail ? <p className="mt-1 text-sm leading-relaxed text-stone-600">{item.detail}</p> : null}
            </div>
            {item.price ? <p className={"font-semibold " + accent.text}>{item.price}</p> : null}
          </li>
        ))}
      </ul>
    );
  }
  if (section.type === "steps") {
    return (
      <ol className="mt-12 grid gap-8 md:grid-cols-3">
        {items.map((item, i) => (
          <li key={i}>
            <span className={"flex h-10 w-10 items-center justify-center rounded-full font-semibold text-white " + accent.dot}>
              {i + 1}
            </span>
            <h3 className="mt-5 text-lg font-semibold text-stone-900">{item.title}</h3>
            <p className="mt-2 leading-relaxed text-stone-600">{item.text}</p>
          </li>
        ))}
      </ol>
    );
  }
  if (section.type === "hours") {
    return (
      <div className="mt-12 max-w-xl">
        <dl className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white">
          {(section.rows ?? []).map((row, i) => (
            <div key={i} className="flex justify-between gap-6 px-6 py-4">
              <dt className="text-stone-700">{row.label}</dt>
              <dd className="font-medium text-stone-900">{row.value}</dd>
            </div>
          ))}
        </dl>
        {section.note ? <p className="mt-4 text-sm text-stone-600">{section.note}</p> : null}
      </div>
    );
  }
  return (
    <div className="mt-8 max-w-2xl space-y-5 text-lg leading-relaxed text-stone-700">
      {(section.body ?? []).map((paragraph, i) => (
        <p key={i}>{paragraph}</p>
      ))}
    </div>
  );
}

export default function Home() {
  const accent = ACCENTS[site.theme?.accent] ?? ACCENTS.stone;
  const hero = site.hero ?? { headline: site.name, subhead: "" };
  const contact = site.contact ?? { title: "Contact", text: "", details: [] };

  return (
    <div>
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-4">
          <a href="#top" className="text-lg font-semibold tracking-tight text-stone-900">{site.name}</a>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-600">
            {(site.nav ?? []).map((item) => (
              <a key={item.href} href={item.href} className="hover:text-stone-900">{item.label}</a>
            ))}
          </nav>
        </div>
      </header>

      <section id="top" className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-[1.2fr_1fr] md:items-center md:py-28">
        <div>
          {hero.eyebrow ? <p className={"text-sm font-semibold uppercase tracking-widest " + accent.text}>{hero.eyebrow}</p> : null}
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-stone-900 sm:text-6xl">{hero.headline}</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone-600">{hero.subhead}</p>
          {site.cta ? (
            <a href={site.cta.href} className={"mt-8 inline-flex rounded-full px-6 py-3 text-sm font-semibold text-white transition " + accent.button}>
              {site.cta.label}
            </a>
          ) : null}
        </div>
        <div className={"flex aspect-[4/3] items-end rounded-3xl p-8 " + accent.soft}>
          <p className="text-2xl font-semibold leading-snug text-stone-900">{site.tagline}</p>
        </div>
      </section>

      {(site.sections ?? []).map((section, index) => (
        <section
          key={index}
          id={section.id ?? "section-" + index}
          className={"px-6 py-20 sm:px-10 " + (index % 2 === 0 ? "bg-white" : "bg-stone-50")}
        >
          <div className="mx-auto max-w-6xl">
            <SectionHeading title={section.title} intro={section.intro} />
            <SectionBody section={section} accent={accent} />
          </div>
        </section>
      ))}

      <section id="contact" className="bg-white px-6 py-20 sm:px-10">
        <div className="mx-auto max-w-6xl">
          <SectionHeading title={contact.title} intro={contact.text} />
          <dl className="mt-12 grid gap-6 sm:grid-cols-3">
            {(contact.details ?? []).map((detail, i) => (
              <div key={i} className="rounded-2xl border border-stone-200 p-6">
                <dt className="text-sm font-semibold uppercase tracking-widest text-stone-500">{detail.label}</dt>
                <dd className="mt-2 text-lg text-stone-900">{detail.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <footer className="border-t border-stone-200 px-6 py-8 text-sm text-stone-500 sm:px-10">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4">
          <p>&copy; {new Date().getFullYear()} {site.name}</p>
        </div>
      </footer>
    </div>
  );
}
`;

const NEXT_CONFIG = `// Builds a static website. The Preview sets VYXO_PREVIEW_BASE so that links and files work inside VYXO.
const previewBase = process.env.VYXO_PREVIEW_BASE || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: previewBase,
  assetPrefix: previewBase || undefined,
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
`;

const NEXT_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
`;

/** The words and choices a new Next.js website starts with. The Build mode rewrites this file. */
function starterSiteFile(title: string): string {
  const site = {
    name: title,
    tagline: "A short line about what you do.",
    theme: { accent: "stone" },
    nav: [
      { label: "About", href: "#about" },
      { label: "Services", href: "#services" },
      { label: "Hours", href: "#hours" },
      { label: "Contact", href: "#contact" },
    ],
    cta: { label: "Get in touch", href: "#contact" },
    hero: { eyebrow: "Welcome", headline: title, subhead: "Say what you do in one clear sentence, and who it is for." },
    sections: [
      {
        id: "about",
        type: "text",
        title: "About",
        body: [
          "Tell people who you are, what you care about, and why you do this work.",
          "A second short paragraph helps visitors trust you.",
        ],
      },
      {
        id: "services",
        type: "features",
        title: "What we offer",
        intro: "Three things people come to you for.",
        items: [
          { title: "First service", text: "Describe it in one or two sentences." },
          { title: "Second service", text: "Describe it in one or two sentences." },
          { title: "Third service", text: "Describe it in one or two sentences." },
        ],
      },
      {
        id: "hours",
        type: "hours",
        title: "Opening hours",
        rows: [
          { label: "Monday to Friday", value: "Add your hours" },
          { label: "Saturday", value: "Add your hours" },
          { label: "Sunday", value: "Closed" },
        ],
      },
    ],
    contact: {
      title: "Contact",
      text: "The best way to reach us.",
      details: [
        { label: "Email", value: "Add your email" },
        { label: "Phone", value: "Add your phone number" },
        { label: "Address", value: "Add your address" },
      ],
    },
  };
  return "export const site = " + JSON.stringify(site, null, 2) + " as const;\n";
}

const TEMPLATES: WorkspaceTemplate[] = [
  {
    id: "blank",
    label: "Blank",
    tagline: "An empty project with a notes file.",
    suits: "Anyone",
    previewable: false,
    files: (name) => ({
      "README.md": `# ${titleLine(name)}

Describe what this project is for here, so the assistant has the context it needs.

${HOW_VYXO_HELPS}`,
    }),
  },
  {
    id: "documents",
    label: "Documents and notes",
    tagline: "Notes, drafts, and a running summary.",
    suits: "Lawyers, consultants, writers",
    previewable: false,
    files: (name) => ({
      "README.md": `# ${titleLine(name)}

A place for notes and drafts, with a running summary the assistant can keep current.

${HOW_VYXO_HELPS}`,
      "summary.md": `# Summary

Keep a short, current summary here: what this is about, where things stand, and what happens next.
`,
      "notes/notes.md": `# Notes

Capture facts, questions, and ideas as they come up. Date your entries.
`,
      "drafts/first-draft.md": `# First draft

Write or paste a draft here. Ask the assistant to tighten it, check it for gaps, or suggest a structure.
`,
    }),
  },
  {
    id: "client-matter",
    label: "Client or case",
    tagline: "Overview, timeline, checklist, and source documents.",
    suits: "Lawyers, consultants, finance",
    previewable: false,
    files: (name) => ({
      "README.md": `# ${titleLine(name)}

One workspace for one client or matter. Nothing in here is shared with any other project, including memories and chats.

${HOW_VYXO_HELPS}
Source documents go in \`sources/\`. VYXO reads plain text and Markdown today; for other formats, paste the text into a \`.md\` file.
`,
      "overview.md": `# Overview

- **Client:**
- **Matter / engagement:**
- **Opened:**
- **Key contacts:**
- **Objective:**

## Background

Summarise the situation in a few paragraphs.

## Open questions

-
`,
      "timeline.md": `# Timeline

| Date | Event | Source |
|------|-------|--------|
|      |       |        |
`,
      "checklist.md": `# Checklist

- [ ] Confirm scope and parties
- [ ] Collect source documents into \`sources/\`
- [ ] Review key terms and risks
- [ ] Prepare first draft in \`drafts/\`
- [ ] Final review
`,
      "sources/README.md": `# Sources

Put source material here as text or Markdown, one file per document. Name files so they sort sensibly, for example \`2026-03-14-lease-draft.md\`.
`,
      "drafts/README.md": `# Drafts

Work in progress goes here. Ask the assistant to draft from the files in \`sources/\`, then review every change before it is applied.
`,
    }),
  },
  {
    id: "research",
    label: "Research",
    tagline: "Question, sources, interviews, and an outline.",
    suits: "Researchers, journalists",
    previewable: false,
    files: (name) => ({
      "README.md": `# ${titleLine(name)}

A workspace for working out an answer: collect sources, keep interview notes, and build an outline.

${HOW_VYXO_HELPS}`,
      "question.md": `# The question

State what you are trying to find out, in one or two sentences.

## What would count as an answer?

-

## What is already known?

-
`,
      "outline.md": `# Outline

1.
2.
3.
`,
      "sources/README.md": `# Sources

One file per source, with where it came from, when you read it, and the parts that matter.
`,
      "interviews/README.md": `# Interviews

One file per conversation: who, when, and your notes. Mark anything said off the record.
`,
    }),
  },
  {
    id: "website-nextjs",
    label: "Next.js website",
    tagline: "Styled with Tailwind CSS. The Preview builds it, and you can change it by asking.",
    suits: "Best for web apps and sites you will publish",
    previewable: true,
    needsSiteDeps: true,
    builderGuide: NEXTJS_BUILDER_GUIDE,
    files: (name) => {
      const title = titleLine(name);
      return {
        "README.md": `# ${title}

A website made with Next.js and Tailwind CSS. Open the **Preview** tab to see it. After each change you approve, the Preview builds the site again.

Pages live in \`app/\`. The home page is \`app/page.tsx\`.

The build runs on your computer and cannot reach the internet, so keep everything in these files (no external fonts, scripts, or images).

${HOW_VYXO_HELPS}`,
        "package.json": `${JSON.stringify(
          { name: "vyxo-site", private: true, version: "0.1.0", scripts: { build: "next build --webpack" } },
          null,
          2,
        )}\n`,
        "next.config.mjs": NEXT_CONFIG,
        "postcss.config.mjs": `export default {
  plugins: { "@tailwindcss/postcss": {} },
};
`,
        "tsconfig.json": NEXT_TSCONFIG,
        "app/globals.css": `@import "tailwindcss";
`,
        "app/layout.tsx": `import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: ${JSON.stringify(title)} };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  );
}
`,
        "app/page.tsx": NEXTJS_PAGE,
        "site/content.ts": starterSiteFile(title),
      };
    },
  },
  {
    id: "website",
    label: "HTML, CSS and JS website",
    tagline: "A plain site with no framework or build step. Open the Preview to see it.",
    suits: "Anyone",
    previewable: true,
    files: (name) => {
      const title = escapeHtml(titleLine(name));
      return {
        "README.md": `# ${titleLine(name)}

A small website. Open the **Preview** tab to see it, then use **Build** to change it, for example "make the header dark" or "add a contact section".

The preview runs on your computer and cannot reach the internet, so keep everything in these files (no external fonts, scripts, or images).

${HOW_VYXO_HELPS}`,
        "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="#top">${title}</a>
      <nav>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </nav>
    </header>

    <main id="top">
      <section class="hero">
        <h1>${title}</h1>
        <p>Say what you do in one clear sentence.</p>
        <a class="button" href="#contact">Get in touch</a>
      </section>

      <section id="about" class="section">
        <h2>About</h2>
        <p>Tell people who you are and what you can do for them.</p>
      </section>

      <section id="contact" class="section">
        <h2>Contact</h2>
        <p>Add the best way to reach you.</p>
      </section>
    </main>

    <footer class="site-footer">
      <p>&copy; <span id="year"></span> ${title}</p>
    </footer>

    <script src="script.js"></script>
  </body>
</html>
`,
        "styles.css": `:root {
  --ink: #17151c;
  --paper: #faf9fb;
  --muted: #6b6775;
  --accent: #6b46e0;
  --line: rgba(23, 21, 28, 0.12);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ink);
  background: var(--paper);
  line-height: 1.6;
}

.site-header,
.site-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem clamp(1rem, 5vw, 4rem);
  border-bottom: 1px solid var(--line);
}

.site-footer {
  border-top: 1px solid var(--line);
  border-bottom: 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.brand {
  font-weight: 700;
  color: inherit;
  text-decoration: none;
}

nav a {
  margin-left: 1.5rem;
  color: var(--muted);
  text-decoration: none;
}

nav a:hover {
  color: var(--ink);
}

.hero {
  padding: clamp(3rem, 12vw, 8rem) clamp(1rem, 5vw, 4rem);
}

.hero h1 {
  margin: 0 0 1rem;
  max-width: 14ch;
  font-size: clamp(2.5rem, 7vw, 5rem);
  line-height: 1;
  letter-spacing: -0.03em;
}

.hero p {
  max-width: 34rem;
  color: var(--muted);
  font-size: 1.15rem;
}

.button {
  display: inline-block;
  margin-top: 1rem;
  padding: 0.8rem 1.4rem;
  border-radius: 999px;
  background: var(--accent);
  color: white;
  text-decoration: none;
}

.section {
  padding: 3rem clamp(1rem, 5vw, 4rem);
  border-top: 1px solid var(--line);
}

.section h2 {
  margin-top: 0;
}
`,
        "script.js": `document.getElementById("year").textContent = new Date().getFullYear();
`,
      };
    },
  },
];

export function listTemplates(): WorkspaceTemplate[] {
  return TEMPLATES;
}

export function getTemplate(id: unknown): WorkspaceTemplate | null {
  return TEMPLATES.find((template) => template.id === id) ?? null;
}

/**
 * Files a template's design depends on. The Build mode may not change them: for a Next.js website only
 * the words and choices in site/content.ts are edited, so the designed layout always stays intact.
 */
const LOCKED_FILES: Partial<Record<TemplateId, string[]>> = {
  "website-nextjs": [
    "app/page.tsx",
    "app/layout.tsx",
    "app/globals.css",
    "next.config.mjs",
    "postcss.config.mjs",
    "tsconfig.json",
    "package.json",
  ],
};

/** Keep only the operations a project's template allows the Build mode to change. */
export function keepEditableOperations<T extends { path: string }>(
  id: unknown,
  operations: T[],
): { kept: T[]; dropped: T[] } {
  const locked = new Set(LOCKED_FILES[id as TemplateId] ?? []);
  return {
    kept: operations.filter((operation) => !locked.has(operation.path)),
    dropped: operations.filter((operation) => locked.has(operation.path)),
  };
}

/** Extra Build-mode instructions for a project's template, or null when plain files are enough. */
export function builderGuideFor(id: unknown): string | null {
  return getTemplate(id)?.builderGuide ?? null;
}
