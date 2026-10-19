"use client";

import { useEffect } from "react";
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
  return (
    <ModalOverlay
      {...props}
      // Focus moves in, and the page behind goes inert, once the scrim has entered. The scrim runs
      // as long as the panel at every size, so that is when the panel lands. RAC's own Sheet does this.
      UNSTABLE_deferUntilEntered
      className="fixed inset-0 z-50 flex modal-scrim items-end justify-center bg-scrim/32 medium:items-center medium:p-6"
    >
      {({ isEntering, state }) => (
        <>
          {isEntering && !props.isKeyboardDismissDisabled ? (
            <CloseOnEscape onClose={() => state.close()} />
          ) : null}
          <AriaModal className="max-h-dvh w-full max-w-130 modal-panel overflow-y-auto rounded-t-xl bg-surface-container-high p-6 text-on-surface medium:rounded-xl">
            {children}
          </AriaModal>
        </>
      )}
    </ModalOverlay>
  );
}

/**
 * While the modal enters, focus is still on the trigger, outside the overlay that handles Escape,
 * so an Escape pressed mid-enter would be lost and the dialog would finish opening.
 */
function CloseOnEscape({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return null;
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
