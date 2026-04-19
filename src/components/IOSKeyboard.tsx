import { useEffect, useMemo, useRef, useState } from "react";

/**
 * IOSKeyboard
 *
 * A presentation-grade fake iPhone keyboard. It is rendered ONLY inside
 * the desktop DeviceFrame (so real mobile users keep their native OS
 * keyboard) and slides up from the bottom of the phone screen whenever a
 * text/number input or textarea is focused.
 *
 * Behaviour
 * ─────────
 * - Detects focused <input>/<textarea> inside a given container and picks
 *   either the alphabetic or numeric layout based on type / inputmode.
 * - Mouse/touch on a key dispatches a real `input` event on the focused
 *   field so React `onChange` handlers fire normally.
 * - Hardware key presses on the user's real keyboard pulse the matching
 *   on-screen key for visual realism — without intercepting the typing.
 * - Pushes app content up via a CSS variable on the container so the
 *   focused input is never hidden under the keyboard.
 *
 * The component is purely visual layer + DOM event glue; no global state.
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
  [".", "0", "⌫"],
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

/**
 * Mutate the focused element's value by simulating user input so React's
 * synthetic onChange fires correctly (using the native value setter trick).
 */
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
  const [shift, setShift] = useState(true); // iOS auto-caps first letter
  const [pressed, setPressed] = useState<string | null>(null);
  const pressTimer = useRef<number | null>(null);

  // Track focus inside the container (capture phase to catch focus before
  // any custom blur handlers fire).
  useEffect(() => {
    if (!container) return;

    const onFocus = (e: FocusEvent) => {
      const t = e.target as Element | null;
      if (!isTypable(t)) return;
      // Skip hidden inputs (e.g. checkbox shells used by Radix).
      if ((t as HTMLInputElement).readOnly) return;
      setTarget(t);
      setLayout(pickLayout(t));
      setShift(t.value.length === 0);
    };
    const onBlur = (e: FocusEvent) => {
      // Delay so a click on a key (which steals focus briefly) doesn't
      // dismiss the keyboard.
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

  // Push container content up while keyboard is visible. We set a CSS var
  // on the container; it's consumed via inline padding-bottom on the inner
  // scroll wrapper without touching every page.
  useEffect(() => {
    if (!container) return;
    const KB_HEIGHT = layout === "numeric" ? 260 : 300;
    container.style.setProperty("--ios-kb-h", target ? `${KB_HEIGHT}px` : "0px");
    return () => {
      container.style.setProperty("--ios-kb-h", "0px");
    };
  }, [container, target, layout]);

  // Hardware-keyboard echo: pulse the matching on-screen key.
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
    if (key === "delete" || key === "⌫") {
      deleteBack(target);
      return;
    }
    if (key === "space") {
      insertText(target, " ");
      return;
    }
    if (key === "return") {
      // Submit the surrounding form if any, otherwise just blur.
      const form = target.closest("form");
      if (form) {
        form.requestSubmit?.();
      } else {
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
    insertText(target, shift && layout === "alpha" ? key.toUpperCase() : key);
    if (shift && layout === "alpha") setShift(false);
  };

  const rows = useMemo(() => (shift ? ROWS_UPPER : ROWS_LOWER), [shift]);

  if (!target) return null;

  return (
    <div
      data-ios-keyboard
      // Tapping on the keyboard chrome shouldn't steal focus from the input.
      onMouseDown={(e) => e.preventDefault()}
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-40 animate-slide-in-bottom select-none"
      style={{
        background: "linear-gradient(180deg,hsl(220 14% 86%) 0%,hsl(220 14% 82%) 100%)",
        boxShadow: "0 -8px 24px -10px rgba(0,0,0,0.25), 0 -1px 0 rgba(0,0,0,0.08) inset",
        paddingBottom: "10px",
      }}
    >
      {layout === "alpha" ? (
        <AlphaLayout
          rows={rows}
          shift={shift}
          pressed={pressed}
          onKey={onTapKey}
        />
      ) : (
        <NumericLayout pressed={pressed} onKey={onTapKey} />
      )}
    </div>
  );
};

/* ────────────────────────── sub-components ────────────────────────── */

const KeyCap = ({
  label,
  id,
  pressed,
  flex = 1,
  variant = "letter",
  onPress,
  children,
}: {
  label?: string;
  id: string;
  pressed: string | null;
  flex?: number;
  variant?: "letter" | "modifier" | "action";
  onPress: () => void;
  children?: React.ReactNode;
}) => {
  const active = pressed === id;
  const base =
    variant === "letter"
      ? "bg-white text-[hsl(200_25%_12%)] shadow-[0_1px_0_rgba(0,0,0,0.35)]"
      : "bg-[hsl(220_8%_70%)] text-[hsl(200_25%_12%)] shadow-[0_1px_0_rgba(0,0,0,0.3)]";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onPress();
      }}
      onMouseDown={(e) => e.preventDefault()}
      style={{ flex }}
      className={`mx-[2px] grid h-[42px] place-items-center rounded-[6px] text-[18px] font-normal transition-transform ${base} ${
        active ? "scale-95 brightness-90" : ""
      }`}
    >
      {children ?? label}
    </button>
  );
};

const AlphaLayout = ({
  rows,
  shift,
  pressed,
  onKey,
}: {
  rows: string[][];
  shift: boolean;
  pressed: string | null;
  onKey: (k: string) => void;
}) => (
  <div className="px-1 pt-2">
    {/* Row 1 — 10 letter keys */}
    <div className="mb-[10px] flex">
      {rows[0].map((k) => (
        <KeyCap key={k} id={k.toLowerCase()} label={k} pressed={pressed} onPress={() => onKey(k)} />
      ))}
    </div>
    {/* Row 2 — 9 letter keys with side gutters */}
    <div className="mb-[10px] flex px-[18px]">
      {rows[1].map((k) => (
        <KeyCap key={k} id={k.toLowerCase()} label={k} pressed={pressed} onPress={() => onKey(k)} />
      ))}
    </div>
    {/* Row 3 — shift + 7 letters + delete */}
    <div className="mb-[10px] flex">
      <KeyCap
        id="shift"
        pressed={pressed}
        variant="modifier"
        flex={1.4}
        onPress={() => onKey("shift")}
      >
        <span className={shift ? "text-[hsl(200_25%_12%)]" : "text-[hsl(200_25%_12%)]"}>
          {shift ? "⇧" : "⇧"}
        </span>
      </KeyCap>
      <div className="flex flex-1">
        {rows[2].map((k) => (
          <KeyCap
            key={k}
            id={k.toLowerCase()}
            label={k}
            pressed={pressed}
            onPress={() => onKey(k)}
          />
        ))}
      </div>
      <KeyCap
        id="delete"
        pressed={pressed}
        variant="modifier"
        flex={1.4}
        onPress={() => onKey("delete")}
      >
        ⌫
      </KeyCap>
    </div>
    {/* Row 4 — 123 / space / return */}
    <div className="flex">
      <KeyCap
        id="123"
        pressed={pressed}
        variant="modifier"
        flex={1.3}
        onPress={() => onKey("123")}
      >
        123
      </KeyCap>
      <KeyCap
        id="space"
        pressed={pressed}
        variant="letter"
        flex={5}
        onPress={() => onKey("space")}
      >
        space
      </KeyCap>
      <KeyCap
        id="return"
        pressed={pressed}
        variant="action"
        flex={1.6}
        onPress={() => onKey("return")}
      >
        <span className="text-[14px] font-semibold text-white">return</span>
      </KeyCap>
    </div>
  </div>
);

const NumericLayout = ({
  pressed,
  onKey,
}: {
  pressed: string | null;
  onKey: (k: string) => void;
}) => (
  <div className="px-2 pt-2">
    {NUM_ROWS.map((row, idx) => (
      <div key={idx} className="mb-[10px] flex">
        {row.map((k) => (
          <KeyCap
            key={k}
            id={k === "⌫" ? "delete" : k}
            label={k}
            pressed={pressed}
            variant={k === "⌫" ? "modifier" : "letter"}
            onPress={() => onKey(k === "⌫" ? "delete" : k)}
          />
        ))}
      </div>
    ))}
    <div className="flex">
      <KeyCap
        id="ABC"
        pressed={pressed}
        variant="modifier"
        flex={1}
        onPress={() => onKey("ABC")}
      >
        ABC
      </KeyCap>
      <KeyCap
        id="return"
        pressed={pressed}
        variant="action"
        flex={2}
        onPress={() => onKey("return")}
      >
        <span className="text-[14px] font-semibold text-white">return</span>
      </KeyCap>
    </div>
  </div>
);
