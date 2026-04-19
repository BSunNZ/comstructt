import { useEffect, useMemo, useRef, useState } from "react";

/**
 * IOSKeyboard — presentation-grade iPhone QWERTZ keyboard.
 *
 * Renders only inside the desktop DeviceFrame. Detects focused inputs and
 * pushes app content up via the `--ios-kb-h` CSS variable on the screen
 * container so the focused field is never hidden under the keys.
 *
 * Faithful to a real iPhone in iOS 17:
 *   • 10/9/7-key staggered QWERTZ rows with proper edge gutters
 *   • Bottom row = 123 · 🌐 · spacebar (wide) · return/Search
 *   • Numeric pad with grouped digits and a wide return key
 *   • Light "system" key fills, white letter keys, blue action key
 *   • SF-ish geometry: 6-px gaps, ~10-px radius, 42-px tall keys
 *
 * Both interaction modes work simultaneously:
 *   1. Mouse/touch on a key dispatches a real `input` event so React
 *      `onChange` handlers fire normally.
 *   2. Hardware key presses pulse the matching on-screen key without
 *      intercepting the user's typing.
 */

type Layout = "alpha" | "numeric";

const ROWS_LOWER: string[][] = [
  ["q", "w", "e", "r", "t", "z", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["y", "x", "c", "v", "b", "n", "m"],
];
const ROWS_UPPER: string[][] = ROWS_LOWER.map((r) => r.map((k) => k.toUpperCase()));

const NUM_ROWS: string[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [",", "0", "."],
];

const isTypable = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement => {
  if (!el) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  const t = (el as HTMLInputElement).type;
  return ["text", "search", "email", "url", "tel", "password", "number"].includes(t);
};

const pickLayout = (el: HTMLInputElement | HTMLTextAreaElement): Layout => {
  if (el.tagName === "INPUT") {
    const inp = el as HTMLInputElement;
    if (inp.type === "number" || inp.type === "tel") return "numeric";
    const im = inp.getAttribute("inputmode");
    if (im && ["numeric", "decimal", "tel"].includes(im)) return "numeric";
  }
  return "alpha";
};

const isSearch = (el: HTMLInputElement | HTMLTextAreaElement): boolean => {
  if (el.tagName !== "INPUT") return false;
  const inp = el as HTMLInputElement;
  if (inp.type === "search") return true;
  if (inp.getAttribute("role") === "searchbox") return true;
  const form = el.closest("form");
  return form?.getAttribute("role") === "search";
};

/** Mutate the focused element's value via the native setter so React onChange fires. */
const insertText = (el: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  setter?.call(el, next);
  const caret = start + text.length;
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    /* number inputs disallow setSelectionRange */
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const deleteBack = (el: HTMLInputElement | HTMLTextAreaElement) => {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  let next: string;
  let caret: number;
  if (start !== end) {
    next = el.value.slice(0, start) + el.value.slice(end);
    caret = start;
  } else if (start > 0) {
    next = el.value.slice(0, start - 1) + el.value.slice(start);
    caret = start - 1;
  } else {
    return;
  }
  setter?.call(el, next);
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    /* ignore */
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

type Props = {
  /** Container the keyboard listens to and pushes up. */
  container: HTMLElement | null;
};

export const IOSKeyboard = ({ container }: Props) => {
  const [target, setTarget] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [layout, setLayout] = useState<Layout>("alpha");
  const [shift, setShift] = useState(true);
  const [pressed, setPressed] = useState<string | null>(null);
  const pressTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!container) return;
    const onFocus = (e: FocusEvent) => {
      const t = e.target as Element | null;
      if (!isTypable(t)) return;
      if ((t as HTMLInputElement).readOnly) return;
      setTarget(t);
      setLayout(pickLayout(t));
      setShift(t.value.length === 0);
    };
    const onBlur = (e: FocusEvent) => {
      const next = e.relatedTarget as Element | null;
      if (next && next.closest("[data-ios-keyboard]")) return;
      window.setTimeout(() => {
        const active = document.activeElement;
        if (!isTypable(active)) setTarget(null);
      }, 0);
    };
    container.addEventListener("focusin", onFocus);
    container.addEventListener("focusout", onBlur);
    return () => {
      container.removeEventListener("focusin", onFocus);
      container.removeEventListener("focusout", onBlur);
    };
  }, [container]);

  // Push content up while keyboard is visible.
  useEffect(() => {
    if (!container) return;
    const KB_HEIGHT = layout === "numeric" ? 260 : 291;
    container.style.setProperty("--ios-kb-h", target ? `${KB_HEIGHT}px` : "0px");
    return () => {
      container.style.setProperty("--ios-kb-h", "0px");
    };
  }, [container, target, layout]);

  // Hardware-key echo
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      let id: string | null = null;
      if (e.key === "Backspace") id = "delete";
      else if (e.key === " ") id = "space";
      else if (e.key === "Enter") id = "return";
      else if (e.key === "Shift") id = "shift";
      else if (e.key.length === 1) id = e.key.toLowerCase();
      if (!id) return;
      setPressed(id);
      if (pressTimer.current) window.clearTimeout(pressTimer.current);
      pressTimer.current = window.setTimeout(() => setPressed(null), 120);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target]);

  const onTapKey = (key: string) => {
    if (!target) return;
    target.focus();
    setPressed(key.toLowerCase());
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => setPressed(null), 120);

    if (key === "shift") {
      setShift((s) => !s);
      return;
    }
    if (key === "delete") {
      deleteBack(target);
      return;
    }
    if (key === "space") {
      insertText(target, " ");
      return;
    }
    if (key === "return") {
      const form = target.closest("form");
      if (form) form.requestSubmit?.();
      else {
        target.blur();
        setTarget(null);
      }
      return;
    }
    if (key === "123") {
      setLayout("numeric");
      return;
    }
    if (key === "ABC") {
      setLayout("alpha");
      return;
    }
    if (key === "globe") return; // decorative
    insertText(target, shift && layout === "alpha" ? key.toUpperCase() : key);
    if (shift && layout === "alpha") setShift(false);
  };

  const rows = useMemo(() => (shift ? ROWS_UPPER : ROWS_LOWER), [shift]);
  const returnLabel = target && isSearch(target) ? "Search" : "Return";

  if (!target) return null;

  return (
    <div
      data-ios-keyboard
      onMouseDown={(e) => e.preventDefault()}
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-40 animate-slide-in-bottom select-none"
      style={{
        // Real iOS keyboard background — light grey with a subtle vertical wash.
        background: "linear-gradient(180deg,#D1D5DB 0%,#CBD0D6 100%)",
        boxShadow: "0 -1px 0 rgba(0,0,0,0.08) inset",
        paddingTop: 6,
        paddingBottom: 8,
        // SF-ish system font stack.
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {layout === "alpha" ? (
        <AlphaLayout
          rows={rows}
          shift={shift}
          pressed={pressed}
          returnLabel={returnLabel}
          onKey={onTapKey}
        />
      ) : (
        <NumericLayout pressed={pressed} returnLabel={returnLabel} onKey={onTapKey} />
      )}

      {/* Home indicator bar — completes the iPhone illusion. */}
      <div className="mt-2 flex justify-center">
        <span className="h-[5px] w-[120px] rounded-full bg-black/70" />
      </div>
    </div>
  );
};

/* ───────────────────────────── key cap ───────────────────────────── */

type KeyVariant = "letter" | "system" | "action";

const KeyCap = ({
  id,
  pressed,
  flex = 1,
  variant = "letter",
  height = 42,
  fontSize = 22,
  fontWeight = 400,
  onPress,
  children,
  ariaLabel,
}: {
  id: string;
  pressed: string | null;
  flex?: number;
  variant?: KeyVariant;
  height?: number;
  fontSize?: number;
  fontWeight?: number;
  onPress: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
}) => {
  const active = pressed === id;
  const base =
    variant === "letter"
      ? { bg: "#FFFFFF", color: "#000" }
      : variant === "action"
        ? { bg: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }
        : { bg: "#ADB3BC", color: "#000" }; // iOS system grey key
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.preventDefault();
        onPress();
      }}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        flex,
        height,
        backgroundColor: base.bg,
        color: base.color,
        fontSize,
        fontWeight,
        borderRadius: 6,
        boxShadow: "0 1px 0 rgba(0,0,0,0.35)",
        transform: active ? "scale(0.94)" : "scale(1)",
        filter: active ? "brightness(0.92)" : "none",
        transition: "transform 90ms ease, filter 90ms ease",
      }}
      className="mx-[3px] grid place-items-center"
    >
      {children}
    </button>
  );
};

/* ─────────────────────────── alpha layout ────────────────────────── */

const AlphaLayout = ({
  rows,
  shift,
  pressed,
  returnLabel,
  onKey,
}: {
  rows: string[][];
  shift: boolean;
  pressed: string | null;
  returnLabel: string;
  onKey: (k: string) => void;
}) => (
  <div className="px-[3px]">
    {/* Row 1 — 10 keys, edge to edge */}
    <div className="mb-[11px] flex">
      {rows[0].map((k) => (
        <KeyCap key={k} id={k.toLowerCase()} pressed={pressed} onPress={() => onKey(k)}>
          {k}
        </KeyCap>
      ))}
    </div>

    {/* Row 2 — 9 keys, ~half-key indent on each side */}
    <div className="mb-[11px] flex" style={{ paddingLeft: 19, paddingRight: 19 }}>
      {rows[1].map((k) => (
        <KeyCap key={k} id={k.toLowerCase()} pressed={pressed} onPress={() => onKey(k)}>
          {k}
        </KeyCap>
      ))}
    </div>

    {/* Row 3 — Shift · 7 letters · Backspace */}
    <div className="mb-[11px] flex">
      <KeyCap
        id="shift"
        pressed={pressed}
        variant="system"
        flex={1.45}
        ariaLabel="Shift"
        onPress={() => onKey("shift")}
      >
        <ShiftIcon active={shift} />
      </KeyCap>
      <div className="flex flex-1">
        {rows[2].map((k) => (
          <KeyCap key={k} id={k.toLowerCase()} pressed={pressed} onPress={() => onKey(k)}>
            {k}
          </KeyCap>
        ))}
      </div>
      <KeyCap
        id="delete"
        pressed={pressed}
        variant="system"
        flex={1.45}
        ariaLabel="Backspace"
        onPress={() => onKey("delete")}
      >
        <BackspaceIcon />
      </KeyCap>
    </div>

    {/* Row 4 — 123 · 🌐 · spacebar · return */}
    <div className="flex">
      <KeyCap
        id="123"
        pressed={pressed}
        variant="system"
        flex={1.4}
        fontSize={16}
        fontWeight={500}
        onPress={() => onKey("123")}
      >
        123
      </KeyCap>
      <KeyCap
        id="globe"
        pressed={pressed}
        variant="system"
        flex={1}
        ariaLabel="Switch language"
        onPress={() => onKey("globe")}
      >
        <GlobeIcon />
      </KeyCap>
      <KeyCap
        id="space"
        pressed={pressed}
        variant="letter"
        flex={5.2}
        fontSize={15}
        fontWeight={400}
        onPress={() => onKey("space")}
      >
        space
      </KeyCap>
      <KeyCap
        id="return"
        pressed={pressed}
        variant="action"
        flex={2.4}
        fontSize={16}
        fontWeight={500}
        onPress={() => onKey("return")}
      >
        {returnLabel}
      </KeyCap>
    </div>
  </div>
);

/* ────────────────────────── numeric layout ───────────────────────── */

const NumericLayout = ({
  pressed,
  returnLabel,
  onKey,
}: {
  pressed: string | null;
  returnLabel: string;
  onKey: (k: string) => void;
}) => (
  <div className="px-[3px]">
    {NUM_ROWS.map((row, idx) => (
      <div key={idx} className="mb-[11px] flex">
        {row.map((k) => (
          <KeyCap
            key={k}
            id={k}
            pressed={pressed}
            variant="letter"
            fontSize={26}
            onPress={() => onKey(k)}
          >
            {k}
          </KeyCap>
        ))}
      </div>
    ))}
    <div className="flex">
      <KeyCap
        id="ABC"
        pressed={pressed}
        variant="system"
        flex={1}
        fontSize={16}
        fontWeight={500}
        onPress={() => onKey("ABC")}
      >
        ABC
      </KeyCap>
      <KeyCap
        id="delete"
        pressed={pressed}
        variant="system"
        flex={1}
        ariaLabel="Backspace"
        onPress={() => onKey("delete")}
      >
        <BackspaceIcon />
      </KeyCap>
      <KeyCap
        id="return"
        pressed={pressed}
        variant="action"
        flex={1}
        fontSize={16}
        fontWeight={500}
        onPress={() => onKey("return")}
      >
        {returnLabel}
      </KeyCap>
    </div>
  </div>
);

/* ──────────────────────────── glyph icons ────────────────────────── */

const ShiftIcon = ({ active }: { active: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? "#000" : "none"} stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3 L21 12 H16 V21 H8 V12 H3 Z" />
  </svg>
);

const BackspaceIcon = () => (
  <svg width="24" height="20" viewBox="0 0 24 20" fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 4 H9 L2 10 L9 16 H22 Z" />
    <path d="M14 8 L19 13 M19 8 L14 13" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12 H21" />
    <path d="M12 3 C16 7 16 17 12 21 C8 17 8 7 12 3 Z" />
  </svg>
);
