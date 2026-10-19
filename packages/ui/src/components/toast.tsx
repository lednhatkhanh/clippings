"use client";

import {
  Button as AriaButton,
  Text,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as AriaToastRegion,
} from "react-aria-components";

import { Icon } from "../icons/icon.tsx";

// React Aria's Toast is still `UNSTABLE_`: only this file touches it, so an API change lands here.

export interface ToastMessage {
  message: string;
  /** One action, such as "Undo". Pressing it also closes the toast. */
  action?: { label: string; onAction: () => void };
}

/**
 * How long a toast stays before closing on its own, paused while hovered or focused. At least
 * 5 s, or it is gone before everyone can read it or reach it with F6.
 */
const TIMEOUT_MS = 8000;

const queue = new ToastQueue<ToastMessage>({ maxVisibleToasts: 3 });

/** The app's one toast queue. `ToastRegion` shows what is shown here. */
export const toasts = {
  /**
   * Shows a toast and returns its key, for `close`. A `persistent` toast stays until it is acted
   * on or dismissed, for a message that matters until then.
   */
  show(toast: ToastMessage, { persistent = false }: { persistent?: boolean } = {}): string {
    return queue.add(toast, persistent ? {} : { timeout: TIMEOUT_MS });
  },
  close(key: string): void {
    queue.close(key);
  },
};

/**
 * Where toasts appear: a landmark, so F6 reaches it from anywhere. Render it once, in a layout
 * that stays mounted across navigation. On phones it sits above the navigation bar.
 */
export function ToastRegion() {
  return (
    <AriaToastRegion
      queue={queue}
      className="fixed inset-x-4 bottom-24 z-40 flex flex-col-reverse gap-2 rounded-xs medium:start-30 medium:end-auto medium:bottom-6 large:start-68"
    >
      {({ toast }) => (
        <AriaToast
          toast={toast}
          className="flex min-h-12 w-full items-center gap-1 rounded-xs bg-inverse-surface ps-4 pe-1 text-inverse-on-surface shadow-3 medium:w-auto medium:max-w-140 medium:min-w-86"
        >
          <AriaToastContent className="min-w-0 flex-1 py-3">
            <Text slot="title" className="typescale-body-md">
              {toast.content.message}
            </Text>
          </AriaToastContent>
          {toast.content.action ? (
            <AriaButton
              onPress={() => {
                toast.content.action?.onAction();
                queue.close(toast.key);
              }}
              className="state-layer min-h-12 shrink-0 rounded-full px-3 typescale-label-lg text-inverse-primary"
            >
              {toast.content.action.label}
            </AriaButton>
          ) : null}
          <AriaButton
            slot="close"
            aria-label="Dismiss"
            className="state-layer flex size-12 shrink-0 items-center justify-center rounded-full"
          >
            <Icon name="close" />
          </AriaButton>
        </AriaToast>
      )}
    </AriaToastRegion>
  );
}
