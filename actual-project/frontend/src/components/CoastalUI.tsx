import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ChevronRight, Close } from "./Icon";
import { BackButton, GhostButton } from "./ui";
import { C } from "../theme";
import { useAppBack } from "../navigation";
import { actionTitle } from "../presentation";

export function CoastalPage({
  children,
  title,
  eyebrow,
  subtitle,
  back,
  backMode = "history",
  backDisabled = false,
  action,
  tabs = true,
  className = "",
}: {
  children: ReactNode;
  title?: string;
  eyebrow?: string;
  subtitle?: string;
  back?: string;
  backMode?: "history" | "destination";
  backDisabled?: boolean;
  action?: ReactNode;
  tabs?: boolean;
  className?: string;
}) {
  const nav = useNavigate();
  const goBack = useAppBack(!back || back === "back" ? "/home" : back);
  return (
    <main className={`screen scroll-y coastal-screen ${className}`}>
      <div className={`coastal-page measure ${tabs ? "with-tabs" : ""}`}>
        {(title || back) && (
          <header className="coastal-header">
            {back && (
              <BackButton
                disabled={backDisabled}
                onClick={() => backMode === "destination"
                  ? nav(back === "back" ? "/home" : back, { replace: true })
                  : goBack()}
              />
            )}
            <div className="grow">
              {eyebrow && <p className="eyebrow">{eyebrow}</p>}
              {title && <h1>{title}</h1>}
              {subtitle && <p className="subtle">{subtitle}</p>}
            </div>
            {action}
          </header>
        )}
        {children}
      </div>
    </main>
  );
}
export function WhiteCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`coastal-card ${className}`}>{children}</section>;
}
export function SummaryCard({
  eyebrow,
  value,
  description,
  children,
}: {
  eyebrow: string;
  value?: string | number;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <section className="coastal-summary">
      <p className="eyebrow">{eyebrow}</p>
      {(value !== undefined || description) && (
        <div className="summary-headline">
          {value !== undefined && <strong>{value}</strong>}
          <span>{description}</span>
        </div>
      )}
      {children}
    </section>
  );
}
export function SummaryStats({
  items,
}: {
  items: { label: string; value: string | number }[];
}) {
  return (
    <div className="summary-stats">
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
export function ActionTile({
  title,
  subtitle,
  icon,
  onClick,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="action-tile press" onClick={onClick}>
      <span className="tile-icon">{icon}</span>
      <ChevronRight color={C.lime} />
      <strong>{actionTitle(title)}</strong>
      <span>{subtitle}</span>
    </button>
  );
}
export function LinkRow({
  title,
  subtitle,
  onClick,
  href,
  leading,
  trailing,
}: {
  title: string;
  subtitle?: string;
  onClick?: () => void;
  href?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const content = (
    <>
      {leading}
      <span className="grow">
        <strong>{title}</strong>
        {subtitle && <small>{subtitle}</small>}
      </span>
      {trailing}
      <ChevronRight color={C.dim} />
    </>
  );
  // Use a real anchor for mailto: links so the browser can open the
  // user's chosen email app without scripting or sending mail itself.
  return href ? (
    <a className="coastal-link-row" href={href}>{content}</a>
  ) : (
    <button type="button" className="coastal-link-row" onClick={onClick}>{content}</button>
  );
}
export function SectionHeading({
  children,
  action,
  onAction,
}: {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-heading">
      <h2>{children}</h2>
      {action && (
        <button onClick={onAction}>
          {action.replace(/\s*→$/, "")} <ArrowRight color={C.navy} size={14} />
        </button>
      )}
    </div>
  );
}
export function Sheet({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab" || !el) return;
      const items = Array.from(
        el.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]',
        ),
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === el)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, []);
  const modal = (
    <div className="coastal-backdrop" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`coastal-sheet ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Close size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
  const container =
    typeof document !== "undefined"
      ? document.querySelector(".app-shell")
      : null;
  return container ? createPortal(modal, container) : modal;
}
export function DataUnavailable({
  title = "No data available yet",
  children,
  retry,
}: {
  title?: string;
  children?: ReactNode;
  retry?: () => void;
}) {
  return (
    <WhiteCard className="data-message">
      <span className="empty-symbol">≈</span>
      <h2>{title}</h2>
      <div className="subtle">
        {children ??
          "There is not enough recorded information to show this view yet."}
      </div>
      {retry && <GhostButton onClick={retry}>Try again</GhostButton>}
    </WhiteCard>
  );
}
