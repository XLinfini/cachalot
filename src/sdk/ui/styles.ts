/** Presentation-only recipes. Keep complete class names so Tailwind can scan
 * them; choose conflicting variants explicitly instead of constructing names.
 * Shared colors, shadows and breakpoints live in styles/app.css (@theme).
 */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const actionButton =
  "inline-flex min-h-[36px] items-center justify-center gap-2 rounded-button px-4 text-[12px] font-bold whitespace-nowrap";
const eyebrow = "text-[10px] font-bold tracking-[.16em]";

export const ui = {
  primaryButton: cx(
    actionButton,
    "border border-brand bg-brand text-white shadow-button hover:bg-brand-hover",
  ),
  secondaryButton: cx(
    actionButton,
    "border border-[#dce5f0] bg-white text-[#355071] hover:bg-[#f3f7fc]",
  ),
  iconButton:
    "inline-flex size-[30px] flex-none items-center justify-center rounded-lg border-0 bg-transparent text-[#69809e] hover:bg-[#edf3fb] hover:text-[#245fba]",
  backLink:
    "inline-flex items-center gap-[6px] border-0 bg-transparent py-2 text-[12px] text-[#657994] hover:text-[#2765bd]",
  eyebrow: cx(eyebrow, "text-muted"),
  eyebrowBlue: cx(eyebrow, "text-[#3c75cf]"),
  searchBox:
    "flex items-center gap-2 rounded-lg border border-[#e6ecf4] bg-canvas px-[10px] text-[#8fa0b4]",
  searchInput:
    "w-full border-0 bg-transparent text-[11px] text-[#263f5b] outline-none placeholder:text-[#a7b4c5]",
  navButton:
    "flex h-[38px] w-full items-center gap-3 rounded-lg border-0 bg-transparent px-[13px] text-left text-[12px] text-[#687d98] hover:bg-[#e4edfa] hover:font-bold hover:text-[#2062bd] aria-pressed:bg-[#e4edfa] aria-pressed:font-bold aria-pressed:text-[#2062bd]",
  toolbarButton:
    "flex items-center gap-[5px] rounded-[6px] border-0 bg-transparent p-[7px] text-[10px] text-[#71849c] hover:bg-brand-soft hover:text-[#2868be] aria-pressed:bg-brand-soft aria-pressed:text-[#2868be] max-compact:gap-0 max-compact:text-[0px] max-compact:[&>svg]:w-4",
  settingsPage: "min-w-0 flex-1 overflow-y-auto overscroll-contain px-7 pt-7 pb-8 max-compact:px-5",
  settingsNavButton:
    "flex min-h-[39px] w-full items-center gap-2.5 rounded-r-md border-0 border-l-2 border-transparent bg-transparent px-3 text-left text-[12px] text-[#607590] hover:bg-[#edf2f9] hover:text-ink aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:font-semibold aria-pressed:text-brand",
  surface: "rounded-xl border border-border bg-white shadow-surface",
  fieldLabel: "mb-4 block text-[10px] font-semibold text-[#607590]",
  fieldInput:
    "mt-2 w-full rounded-[7px] border border-[#dce5ef] bg-white px-[10px] py-[9px] text-[11px] text-[#2e4866] placeholder:text-[#b1bdcb]",
  formError:
    "rounded-[7px] bg-[#fff0f1] p-[10px] text-[11px] whitespace-pre-wrap break-words text-danger [overflow-wrap:anywhere]",
  settingsActions: "flex items-center justify-end gap-2",
  settingsNotice: "mx-[23px] mb-5 text-[10px] text-[#497cb9]",
  avatar: "grid flex-none place-items-center rounded-lg font-bold",
} as const;
