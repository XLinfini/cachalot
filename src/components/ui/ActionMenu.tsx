import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";
import { cx, ui } from "../../sdk/ui/styles";

export const menuItem =
  "flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-3 py-2 text-left text-[12px] text-[#466484] hover:bg-[#edf3fb] focus:bg-[#edf3fb] focus:outline-none";

/** A portal avoids clipping by document cards and the scrolling category list.
 * Outside clicks, scrolling and Escape close the menu. No library data is held. */
export function ActionMenu({
  label,
  kind,
  triggerClassName,
  triggerIcon,
  disabled,
  children,
}: {
  label: string;
  kind: "document" | "category" | "sort";
  triggerClassName?: string;
  triggerIcon?: ReactNode;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const bounds = menu.current.getBoundingClientRect();
    const below = anchor.bottom + 6;
    setPosition({
      top:
        below + bounds.height <= innerHeight - 8
          ? below
          : Math.max(8, anchor.top - bounds.height - 6),
      left: Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8)),
    });
    menu.current
      .querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        (menu.current?.contains(event.target) || trigger.current?.contains(event.target))
      )
        return;
      setOpen(false);
    };
    const resize = () => setOpen(false);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        data-ui={`${kind}-actions`}
        className={cx(ui.iconButton, triggerClassName, open && "opacity-100")}
        aria-label={label}
        title={label}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {triggerIcon || <MoreVertical size={18} />}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            data-ui="action-menu"
            data-menu-kind={kind}
            role="menu"
            aria-label={label}
            className="fixed z-50 w-max max-w-[calc(100vw-16px)] min-w-[180px] rounded-lg border border-border bg-white p-1 shadow-surface"
            style={position}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              const items = Array.from(
                menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ||
                  [],
              );
              const index = items.indexOf(window.document.activeElement as HTMLElement);
              if (event.key === "Escape" || event.key === "Tab") {
                setOpen(false);
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  trigger.current?.focus();
                }
              } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                        items.length;
                items[next]?.focus();
              }
            }}
          >
            {children(close)}
          </div>,
          window.document.body,
        )}
    </>
  );
}
