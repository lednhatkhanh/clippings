"use client";

import { createContext, use, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Heading as AriaHeading,
  Modal as AriaModal,
  ModalOverlay,
  Sheet,
  SheetBackdrop,
  SheetContent,
  SheetOverlay,
} from "react-aria-components";
import type { DialogProps as AriaDialogProps, ModalOverlayProps } from "react-aria-components";

import { cn } from "../cn.ts";

export { DialogTrigger };

export interface ModalProps extends Omit<
  ModalOverlayProps,
  "className" | "isOpen" | "defaultOpen"
> {
  /**
   * Controlled only: the modal settles on sheet or dialog while closed and keeps that shape until
   * it closes again, which needs to know when it is open.
   */
  isOpen: boolean;
  /**
   * On a phone's sheet, a swipe, Escape and a tap outside all close it or none does: without
   * `isDismissable`, or with `isKeyboardDismissDisabled`, the sheet can't be dismissed at all.
   */
  isDismissable?: boolean;
  /**
   * `dialog` (default): a bottom sheet on phones that swipes down to close, centered from the
   * medium size class up, with padding. `palette`: a wide panel near the top at every size and no
   * padding, for a `CommandMenu`.
   */
  variant?: "dialog" | "palette";
}

/** Whether a `Dialog` sits in a sheet, where it renders as the sheet's content. */
const InSheetContext = createContext(false);

/**
 * A float-glass dialog on a blurred scrim. Its motion lives in `styles/modal.css`; children stay
 * mounted until the exit animation ends.
 */
export function Modal({ variant = "dialog", ...props }: ModalProps) {
  const isCompact = useIsCompact();
  // The shape is chosen as the modal opens and kept while it is open, so turning a phone sideways
  // doesn't swap sheet for dialog and throw away what was typed.
  const [isSheet, setIsSheet] = useState(isCompact);
  if (!props.isOpen && isSheet !== isCompact) setIsSheet(isCompact);

  return variant === "dialog" && isSheet ? (
    <BottomSheet {...props} />
  ) : (
    <Centered variant={variant} {...props} />
  );
}

/**
 * A phone's bottom sheet, on React Aria's Sheet: the page scrolls it in, and swiping it down past
 * its edge closes it, natively and off the main thread. Its content pads itself by
 * `--sheet-scroll-padding-y`, so it scrolls clear of an on-screen keyboard.
 */
function BottomSheet({
  children,
  isDismissable,
  isKeyboardDismissDisabled,
  ...props
}: Omit<ModalProps, "variant">) {
  return (
    <SheetOverlay
      {...props}
      preventDismissal={!isDismissable || isKeyboardDismissDisabled}
      className="z-50"
    >
      <SheetBackdrop className="modal-scrim bg-scrim" swipeAnimation="modal-fade-in" />
      <Sheet
        overscrollPadding
        className="modal-sheet w-full max-w-130 rounded-t-xl-increased glass-float text-ink"
      >
        {(renderProps) => (
          <>
            <div aria-hidden className="modal-sheet-handle" />
            <InSheetContext value>
              {typeof children === "function" ? children(renderProps) : children}
            </InSheetContext>
          </>
        )}
      </Sheet>
    </SheetOverlay>
  );
}

function Centered({ children, variant, ...props }: ModalProps) {
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <ModalOverlay
      {...props}
      ref={scrimRef}
      // Focus moves in, and the page behind goes inert, once the scrim has entered. The scrim runs
      // as long as the panel at every size, so that is when the panel lands. RAC's own Sheet does
      // this; the prop is `UNSTABLE_`, so a change to it lands here.
      UNSTABLE_deferUntilEntered
      className="modal-page z-50 modal-scrim bg-scrim"
    >
      {({ isEntering, state }) => (
        // The panel sits in the visible part of the page, above an on-screen keyboard, so a
        // focused field stays in view.
        <div
          className={cn(
            "modal-viewport flex justify-center",
            variant === "palette" ? "items-start p-4 pt-16 medium:pt-24" : "items-center p-6",
          )}
        >
          {isEntering && !props.isKeyboardDismissDisabled ? (
            <CloseOnEscape scrimRef={scrimRef} panelRef={panelRef} onClose={() => state.close()} />
          ) : null}
          <AriaModal
            ref={panelRef}
            className={cn(
              "max-h-full w-full modal-panel-float rounded-xl-increased glass-float text-ink",
              // The palette fits below the overlay's top padding and clips to its corners; its
              // command list is the one scroller and shrinks on a short screen (a phone held
              // sideways), so the field and footer stay in view.
              variant === "palette"
                ? "flex max-w-150 flex-col overflow-hidden"
                : "max-w-130 overflow-y-auto p-6",
            )}
          >
            {children}
          </AriaModal>
        </div>
      )}
    </ModalOverlay>
  );
}

/** Below the medium size class (`--breakpoint-medium` in theme.css), where a dialog is a sheet. */
const COMPACT_QUERY = "(width < 37.5rem)";

function subscribeToCompact(onChange: () => void) {
  const query = matchMedia(COMPACT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useIsCompact() {
  return useSyncExternalStore(
    subscribeToCompact,
    () => matchMedia(COMPACT_QUERY).matches,
    // A modal opens only after hydration, so the server's answer is never shown.
    () => false,
  );
}

/**
 * While the modal enters, focus is still on the trigger, outside the overlay that handles Escape,
 * so an Escape pressed mid-enter would be lost and the dialog would finish opening. This closes it,
 * first pinning the pose the scrim and panel have reached so the exit leaves from there.
 */
function CloseOnEscape({
  scrimRef,
  panelRef,
  onClose,
}: {
  scrimRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      for (const element of [scrimRef.current, panelRef.current]) {
        if (element instanceof HTMLElement) pinPose(element);
      }
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [scrimRef, panelRef, onClose]);
  return null;
}

/** Writes an element's animated opacity, translate and scale inline, where its exit starts from. */
function pinPose(element: HTMLElement) {
  const { opacity, translate, scale } = getComputedStyle(element);
  element.style.opacity = opacity;
  element.style.translate = translate;
  element.style.scale = scale;
}

export function Dialog({
  className,
  ...props
}: Omit<AriaDialogProps, "className"> & { className?: string }) {
  const isInSheet = use(InSheetContext);
  const DialogElement = isInSheet ? SheetContent : AriaDialog;
  return (
    <DialogElement
      {...props}
      className={cn("flex flex-col gap-4", isInSheet && "modal-sheet-content", className)}
    />
  );
}

export function Heading({ children }: { children: string }) {
  return (
    <AriaHeading slot="title" className="typescale-headline-sm text-ink">
      {children}
    </AriaHeading>
  );
}
