"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Heading as AriaHeading,
  Modal as AriaModal,
  ModalOverlay,
} from "react-aria-components";
import type { DialogProps as AriaDialogProps, ModalOverlayProps } from "react-aria-components";

import { cn } from "../cn.ts";

export { DialogTrigger };

/**
 * A dialog on a scrim: a bottom sheet on phones, centered from the medium size class up. Its motion
 * lives in `styles/modal.css`; children stay mounted until the exit animation ends.
 */
export function Modal({ children, ...props }: Omit<ModalOverlayProps, "className">) {
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
      className="fixed inset-0 z-50 flex modal-scrim items-end justify-center bg-scrim/32 medium:items-center medium:p-6"
    >
      {({ isEntering, state }) => (
        <>
          {isEntering && !props.isKeyboardDismissDisabled ? (
            <CloseOnEscape scrimRef={scrimRef} panelRef={panelRef} onClose={() => state.close()} />
          ) : null}
          <AriaModal
            ref={panelRef}
            className="max-h-dvh w-full max-w-130 modal-panel overflow-y-auto rounded-t-xl bg-surface-container-high p-6 text-on-surface medium:rounded-xl"
          >
            {children}
          </AriaModal>
        </>
      )}
    </ModalOverlay>
  );
}

/**
 * While the modal enters, focus is still on the trigger, outside the overlay that handles Escape,
 * so an Escape pressed mid-enter would be lost and the dialog would finish opening. This closes it,
 * first pinning the pose the scrim, panel and content have reached so the exit leaves from there.
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
      const panel = panelRef.current;
      for (const element of [scrimRef.current, panel, ...(panel?.children ?? [])]) {
        if (element instanceof HTMLElement) pinPose(element);
      }
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [scrimRef, panelRef, onClose]);
  return null;
}

/** Writes an element's animated opacity, translate and clip inline, where its exit starts from. */
function pinPose(element: HTMLElement) {
  const { opacity, translate, clipPath } = getComputedStyle(element);
  element.style.opacity = opacity;
  element.style.translate = translate;
  element.style.clipPath = clipPath;
}

export function Dialog({
  className,
  ...props
}: Omit<AriaDialogProps, "className"> & { className?: string }) {
  return <AriaDialog {...props} className={cn("flex flex-col gap-4", className)} />;
}

export function Heading({ children }: { children: string }) {
  return (
    <AriaHeading slot="title" className="typescale-headline-sm">
      {children}
    </AriaHeading>
  );
}
