"use client";

import { Fragment, memo, useMemo } from "react";
import { CopyButton } from "@/components/chat/CopyButton";
import {
  parseMarkdown,
  type BlockNode,
  type InlineNode,
} from "@/lib/chat/markdown";

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "text":
            return <Fragment key={index}>{node.text}</Fragment>;
          case "strong":
            return (
              <strong key={index} className="font-semibold">
                <Inline nodes={node.children} />
              </strong>
            );
          case "em":
            return (
              <em key={index}>
                <Inline nodes={node.children} />
              </em>
            );
          case "code":
            return (
              <code
                key={index}
                className="rounded bg-[var(--surface-deep)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--silver)]"
              >
                {node.text}
              </code>
            );
          case "link":
            return (
              <a
                key={index}
                href={node.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] underline underline-offset-2 hover:text-[var(--foreground)]"
              >
                <Inline nodes={node.children} />
              </a>
            );
        }
      })}
    </>
  );
}

function Block({ block }: { block: BlockNode }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className="whitespace-pre-line">
          <Inline nodes={block.children} />
        </p>
      );
    case "heading": {
      const size =
        block.level === 1 ? "text-lg" : block.level === 2 ? "text-base" : "text-sm";
      return (
        <p
          role="heading"
          aria-level={block.level + 2}
          className={`font-[family-name:var(--font-display)] ${size} font-semibold text-[var(--foreground)]`}
        >
          <Inline nodes={block.children} />
        </p>
      );
    }
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          start={block.ordered ? block.start : undefined}
          className={`space-y-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-[var(--muted)]`}
        >
          {block.items.map((item, index) => (
            <li key={index} className="whitespace-pre-line pl-1">
              <Inline nodes={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote className="whitespace-pre-line border-l-2 border-[var(--accent-border)] pl-4 text-[var(--silver)]">
          <Inline nodes={block.children} />
        </blockquote>
      );
    case "rule":
      return <hr className="border-[var(--line)]" />;
    case "code":
      return (
        <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-deep)]/70">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">
              {block.language ?? "code"}
            </span>
            <CopyButton text={block.content} label="Copy code" />
          </div>
          <pre className="max-w-full overflow-x-auto whitespace-pre p-3 font-mono text-[12px] leading-5 text-[var(--foreground)] [overflow-wrap:normal]">
            {block.content}
          </pre>
        </div>
      );
  }
}

function MarkdownContentBase({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="space-y-3 text-sm leading-6 [overflow-wrap:anywhere]">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}

export const MarkdownContent = memo(MarkdownContentBase);
