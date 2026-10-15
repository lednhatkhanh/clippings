"use client";

import {
  Dialog as AriaDialog,
  DialogTrigger,
  Heading as AriaHeading,
  Modal as AriaModal,
  ModalOverlay,
} from "react-aria-components";
import type { DialogProps as AriaDialogProps, ModalOverlayProps } from "react-aria-components";

import { cn } from "../cn";

export { DialogTrigger };

/** A dialog on a scrim: a bottom sheet on phones, centered from the medium size class up. */
export function Modal({ children, ...props }: Omit<ModalOverlayProps, "className">) {
  return (
    <ModalOverlay
      {...props}
      className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/40 medium:items-center medium:p-6"
    >
      <AriaModal className="max-h-dvh w-full max-w-130 overflow-y-auto rounded-t-xl bg-surface-container-high p-6 text-on-surface medium:rounded-xl">
        {children}
      </AriaModal>
    </ModalOverlay>
  );
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
