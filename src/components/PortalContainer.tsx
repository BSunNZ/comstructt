import { createContext, useContext } from "react";

/**
 * PortalContainerContext
 *
 * Holds a DOM element that Radix portals (Dialog, Sheet, Popover, etc.)
 * should render into instead of `document.body`. This is used by
 * `DeviceFrame` on desktop to keep modals/sheets/popovers visually
 * inside the simulated phone screen rather than escaping to the full
 * viewport.
 *
 * On mobile (no frame), the context value stays `null` and Radix falls
 * back to its default `document.body` portal — exactly what we want on
 * a real device.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

/** Hook returning the current portal container, or null for default body. */
export const usePortalContainer = (): HTMLElement | null => {
  return useContext(PortalContainerContext);
};
