import { ReactNode, useEffect, useState } from "react";
import { PortalContainerContext } from "./PortalContainer";

/**
 * DeviceFrame
 *
 * Wraps children in a realistic iPhone 17 Pro–style hardware shell on
 * desktop / tablet (md and up), and renders them edge-to-edge on phones
 * so the actual app on a real phone is never letterboxed.
 *
 * Visual layers (back → front):
 *   1. Soft contact + drop shadow (under the frame)
 *   2. Brushed-metal outer band (titanium gradient + 1px highlight ring)
 *   3. Inner black bezel (~3px) — separates the screen from the metal edge
 *   4. Screen surface (the app)
 *   5. Glass overlay: gentle gradient + diagonal highlight sweep
 *   6. Dynamic Island pill, centered, floating above the app
 *   7. Side hardware: silence switch, volume buttons (left), power (right)
 *
 * The frame sizes itself to comfortably fit the app at the project's
 * existing 430px content width, with a 9:19.5 device aspect ratio that
 * scales down on smaller desktop windows via clamp().
 */
export const DeviceFrame = ({ children }: { children: ReactNode }) => {
  // The DOM node that Radix portals (sheets, dialogs, popovers, …) will
  // render into so they stay clipped inside the phone screen instead of
  // covering the surrounding desk background. Captured via callback ref
  // so consumers re-render once the node is mounted.
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  // Compute scale so the entire phone fits the viewport with margin.
  // We clamp by BOTH height and width — otherwise narrow desktop panes
  // (e.g. when a side panel is open) let the 430-px-wide phone overflow
  // horizontally even though it fits vertically.
  const PHONE_W = 430;
  const PHONE_H = 931;
  const VERTICAL_MARGIN = 48;
  const HORIZONTAL_MARGIN = 48;
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => {
      const availH = window.innerHeight - VERTICAL_MARGIN;
      const availW = window.innerWidth - HORIZONTAL_MARGIN;
      setScale(Math.min(availH / PHONE_H, availW / PHONE_W, 1));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <>
      {/* Mobile / tablet portrait: render the app full-bleed, no frame. */}
      <div className="md:hidden">{children}</div>

      {/* Desktop: realistic iPhone shell.
          Uses CSS scale to shrink the fixed-size phone (430 × 931px) so the
          whole device is always visible, while keeping the in-app 430px
          layout pixel-perfect. The outer wrapper uses calculated width/height
          so the page never needs to scroll. */}
      <div className="hidden md:flex h-screen w-full items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,hsl(200_25%_18%)_0%,hsl(200_30%_8%)_70%)] p-4">
        <div
          style={{
            width: `${PHONE_W * scale}px`,
            height: `${PHONE_H * scale}px`,
          }}
        >
          <div
            className="relative"
            style={{
              width: `${PHONE_W}px`,
              height: `${PHONE_H}px`,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
          {/* Outer drop shadow + contact shadow */}
          <div
            aria-hidden
            className="absolute -inset-4 rounded-[68px] blur-2xl opacity-70"
            style={{
              background:
                "radial-gradient(ellipse at 50% 92%, hsla(0,0%,0%,0.55) 0%, hsla(0,0%,0%,0) 65%)",
            }}
          />

          {/* Titanium outer band */}
          <div
            className="absolute inset-0 rounded-[60px] p-[3px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6),0_0_0_0.5px_rgba(255,255,255,0.06)_inset]"
            style={{
              background:
                "linear-gradient(135deg,#5a5e63 0%,#9aa0a6 18%,#3e4247 32%,#7a8085 52%,#2e3236 70%,#8b9197 88%,#4a4e53 100%)",
            }}
          >
            {/* Subtle highlight ring just inside the metal */}
            <div
              aria-hidden
              className="absolute inset-[2px] rounded-[58px] pointer-events-none"
              style={{
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.45)",
              }}
            />

            {/* Inner black bezel — the deep gap between metal and screen */}
            <div
              className="relative h-full w-full rounded-[57px] p-[3px]"
              style={{
                background:
                  "linear-gradient(180deg,#0a0a0b 0%,#050506 50%,#0a0a0b 100%)",
              }}
            >
              {/* Screen surface — clips the app to a phone-shaped rectangle.
                  This is also the portal container: any Radix Sheet / Dialog /
                  Popover rendered while the DeviceFrame is mounted on desktop
                  will appear inside this box, never outside it. */}
              <div
                ref={setPortalEl}
                className="relative h-full w-full overflow-hidden rounded-[54px] bg-background"
                style={{
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
                  // Make this the containing block for any `position: fixed`
                  // descendants — including portaled overlays/sheets — so they
                  // pin to the phone screen, not the desktop viewport.
                  transform: "translateZ(0)",
                }}
              >
                {/* The actual app content.
                    NOTE: do NOT put `transform` on this scroll wrapper —
                    that would make it the containing block for any
                    `position: fixed` children inside the app, causing
                    bottom-pinned bars (cart CTA, action footers) to stick
                    to the bottom of the SCROLLED content instead of the
                    phone screen. The OUTER wrapper above already has
                    `translateZ(0)` to anchor fixed descendants to the
                    phone screen, which is what we want. */}
                <div className="absolute inset-0 overflow-y-auto overflow-x-hidden">
                  <PortalContainerContext.Provider value={portalEl}>
                    {children}
                  </PortalContainerContext.Provider>
                </div>

                {/* iPhone 14-style notch — attached to the top edge,
                    narrower than a Dynamic Island, with rounded bottom corners. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-0 z-30 h-[26px] w-[150px] -translate-x-1/2 rounded-b-[18px]"
                  style={{
                    background: "#000",
                    boxShadow: "0 0 0 0.5px rgba(255,255,255,0.04)",
                  }}
                >
                  {/* Speaker slit */}
                  <span
                    className="absolute left-1/2 top-[10px] h-[5px] w-[42px] -translate-x-1/2 rounded-full"
                    style={{
                      background:
                        "linear-gradient(180deg,#0a0a0c 0%,#1a1d20 50%,#0a0a0c 100%)",
                    }}
                  />
                  {/* Camera lens to the right of the speaker */}
                  <span
                    className="absolute right-4 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
                    style={{
                      background:
                        "radial-gradient(circle at 30% 30%, #2a3a4a 0%, #06080a 60%, #000 100%)",
                      boxShadow:
                        "0 0 0 1px rgba(40,60,80,0.35), inset 0 0 2px rgba(80,140,200,0.4)",
                    }}
                  />
                </div>

                {/* Glass reflection sweep — very subtle */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-20 mix-blend-screen opacity-[0.06]"
                  style={{
                    background:
                      "linear-gradient(115deg, transparent 0%, transparent 35%, rgba(255,255,255,0.9) 45%, transparent 55%, transparent 100%)",
                  }}
                />

                {/* Top vignette under the island for depth */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, transparent 100%)",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Side hardware — left side: silence switch + volume up / down */}
          <span
            aria-hidden
            className="absolute left-[-3px] top-[110px] h-7 w-[3px] rounded-l-sm"
            style={{ background: "linear-gradient(90deg,#1a1d20,#3a3e43)" }}
          />
          <span
            aria-hidden
            className="absolute left-[-3px] top-[170px] h-14 w-[3px] rounded-l-sm"
            style={{ background: "linear-gradient(90deg,#1a1d20,#3a3e43)" }}
          />
          <span
            aria-hidden
            className="absolute left-[-3px] top-[240px] h-14 w-[3px] rounded-l-sm"
            style={{ background: "linear-gradient(90deg,#1a1d20,#3a3e43)" }}
          />

          {/* Right side: power / sleep button */}
          <span
            aria-hidden
            className="absolute right-[-3px] top-[200px] h-20 w-[3px] rounded-r-sm"
            style={{ background: "linear-gradient(270deg,#1a1d20,#3a3e43)" }}
          />
          </div>
        </div>
      </div>
    </>
  );
};
