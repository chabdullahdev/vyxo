"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { ModelBadge } from "@/components/workspace/ModelBadge";

import logoWhite from "../../public/brand/logo-white.svg";

type IconName =
  | "agents"
  | "about"
  | "chat"
  | "folder"
  | "memory"
  | "menu"
  | "panel"
  | "plus"
  | "research"
  | "settings";

interface NavigationItem {
  label: string;
  href: string;
  icon: IconName;
}

const workspaceNavigation: NavigationItem[] = [
  { label: "Chat", href: "/chat", icon: "chat" },
  { label: "Agents", href: "/agents", icon: "agents" },
  { label: "Projects", href: "/projects", icon: "folder" },
  { label: "Memory", href: "/memory", icon: "memory" },
];

const systemNavigation: NavigationItem[] = [
  { label: "Research", href: "/research", icon: "research" },
  { label: "Settings", href: "/settings", icon: "settings" },
  { label: "About", href: "/about", icon: "about" },
];

function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  const common = {
    className,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.6,
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  };

  switch (name) {
    case "chat":
      return (
        <svg {...common}>
          <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4.1A2.5 2.5 0 0 1 5 12.5v-6Z" />
          <path d="M9 8.5h6M9 11.5h3.5" />
        </svg>
      );
    case "agents":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.5" />
          <circle cx="16" cy="8" r="2.5" />
          <path d="M4.5 17c.8-2.2 2-3.5 3.5-3.5s2.7 1.3 3.5 3.5M12.5 17c.8-2.2 2-3.5 3.5-3.5s2.7 1.3 3.5 3.5" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M4.5 7.5h5l1.7 2h8.3v7.3a2.2 2.2 0 0 1-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2V7.5Z" />
          <path d="M4.5 7.5V6.2A1.7 1.7 0 0 1 6.2 4.5h3l1.7 2h5.9" />
        </svg>
      );
    case "memory":
      return (
        <svg {...common}>
          <path d="M7 5.5h8.5A2.5 2.5 0 0 1 18 8v9.5H8.5A2.5 2.5 0 0 1 6 15V6.5a1 1 0 0 1 1-1Z" />
          <path d="M6 8.5h-1a1 1 0 0 0-1 1v7a2.5 2.5 0 0 0 2.5 2.5H16M9.5 10h5M9.5 13h5" />
        </svg>
      );
    case "research":
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="5.5" />
          <path d="m15 15 4.5 4.5M10.5 8v5M8 10.5h5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M5 6.5h14M5 12h14M5 17.5h14" />
          <circle cx="9" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="11" cy="17.5" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "about":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "menu":
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case "panel":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M9 5v14" />
        </svg>
      );
  }
}

function NavigationLink({
  item,
  collapsed,
  onNavigate,
  pathname,
}: {
  item: NavigationItem;
  collapsed: boolean;
  onNavigate: () => void;
  pathname: string;
}) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-deep)] lg:justify-start ${
        collapsed ? "lg:justify-center lg:px-2.5" : ""
      } ${
        active
          ? "bg-[var(--accent-soft)] text-[var(--foreground)] shadow-[inset_0_0_0_1px_var(--accent-border)]"
          : "text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
      }`}
    >
      <span className={active ? "text-[var(--accent)]" : "text-[var(--muted)] group-hover:text-[var(--foreground)]"}>
        <Icon name={item.icon} />
      </span>
      <span className={collapsed ? "lg:hidden" : ""}>{item.label}</span>
      {active ? <span className="absolute right-2 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> : null}
    </Link>
  );
}

function navigationLabel(pathname: string): string {
  const item = [...workspaceNavigation, ...systemNavigation].find(
    ({ href }) => pathname === href || pathname.startsWith(`${href}/`),
  );
  return item?.label ?? "Workspace";
}

export function WorkspaceShell({
  children,
  bare = false,
}: {
  children: React.ReactNode;
  /** Public site mode: render the page alone, without the app sidebar and header. */
  bare?: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeLabel = navigationLabel(pathname);

  const closeMobile = () => setMobileOpen(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  if (bare) {
    return (
      <main id="main" className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)] sm:px-6 lg:px-8">
        {children}
      </main>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-[var(--foreground)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--background)]"
      >
        Skip to content
      </a>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={closeMobile}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      ) : null}

      <div className="flex h-screen min-h-0 w-full">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-[280px] shrink-0 -translate-x-full flex-col overflow-y-auto border-r border-[var(--line)] bg-[var(--surface-deep)] p-3 transition-[width,transform] duration-200 lg:static lg:z-auto lg:translate-x-0 ${
            collapsed ? "lg:w-[78px]" : "lg:w-[256px]"
          } ${mobileOpen ? "translate-x-0" : ""}`}
        >
          <div className={`flex h-12 items-center gap-3 px-2 ${collapsed ? "lg:justify-center" : ""}`}>
            <Image
              src={logoWhite}
              alt="VYXO"
              width={753}
              height={240}
              priority
              className="object-contain block"
              style={{
                height: collapsed ? 20 : 30,
                width: "auto",
                maxWidth: collapsed ? 60 : 94,
              }}
            />
          </div>

          <Link
            href="/chat"
            onClick={closeMobile}
            className={`mt-5 flex items-center gap-3 rounded-xl bg-[var(--foreground)] px-3 py-2.5 text-sm font-medium text-[var(--background)] transition hover:bg-[var(--silver)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-deep)] ${
              collapsed ? "lg:justify-center lg:px-2.5" : ""
            }`}
            title={collapsed ? "New chat" : undefined}
          >
            <Icon name="plus" />
            <span className={collapsed ? "lg:hidden" : ""}>New chat</span>
          </Link>

          <nav aria-label="Workspace navigation" className="mt-7 flex-1 space-y-7">
            <div>
              <p className={`mb-2 px-3 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--muted)] ${collapsed ? "lg:hidden" : ""}`}>
                Workspace
              </p>
              <div className="space-y-1">
                {workspaceNavigation.map((item) => (
                  <NavigationLink
                    key={item.href}
                    item={item}
                    collapsed={collapsed}
                    onNavigate={closeMobile}
                    pathname={pathname}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className={`mb-2 px-3 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--muted)] ${collapsed ? "lg:hidden" : ""}`}>
                System
              </p>
              <div className="space-y-1">
                {systemNavigation.map((item) => (
                  <NavigationLink
                    key={item.href}
                    item={item}
                    collapsed={collapsed}
                    onNavigate={closeMobile}
                    pathname={pathname}
                  />
                ))}
              </div>
            </div>
          </nav>

          <div className={`border-t border-[var(--line)] pt-3 ${collapsed ? "lg:text-center" : ""}`}>
            <div className={`mb-3 flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              <span className={`text-[10px] uppercase tracking-[0.16em] text-[var(--muted)] ${collapsed ? "lg:hidden" : ""}`}>
                Local mode
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:flex"
            >
              <Icon name="panel" />
              <span className={collapsed ? "lg:hidden" : ""}>Collapse sidebar</span>
            </button>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="z-20 shrink-0 border-b border-[var(--line)] bg-[var(--background)]/90 backdrop-blur-xl">
            <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
              <button
                type="button"
                aria-label="Open navigation"
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen(true)}
                className="rounded-lg p-2 text-[var(--muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:hidden"
              >
                <Icon name="menu" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
                  VYXO / Local workspace
                </p>
                <h1 className="truncate font-[family-name:var(--font-display)] text-sm font-medium text-[var(--foreground)]">
                  {activeLabel}
                </h1>
              </div>
              <ModelBadge />
            </div>
          </header>

          <main id="main" className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
