"use client";

import { useEffect } from "react";

import { useOpenNewClipping } from "@/components/clippings/new-clipping-dialog.tsx";

import { droppedUrl } from "./dropped-url.ts";

/** Fields where dropped text belongs to the field, as the browser normally handles it. */
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

const carriesText = (event: DragEvent) => {
  const types = event.dataTransfer?.types ?? [];
  return types.includes("text/uri-list") || types.includes("text/plain");
};

const isOnField = (event: DragEvent) =>
  event.target instanceof Element && event.target.closest(EDITABLE) !== null;

/**
 * Dropping a link or a tab's URL anywhere on the app opens "New clipping" with it filled in,
 * instead of the browser leaving the app for it. Drops on a text field, drags that started on the
 * page, and text that isn't a web address keep the browser's own behavior, which for text is to do
 * nothing.
 */
export function LinkDrop() {
  const open = useOpenNewClipping();

  useEffect(() => {
    // A link dragged within the app is moved, not saved.
    let fromPage = false;
    const onDragStart = () => {
      fromPage = true;
    };
    const onDragEnd = () => {
      fromPage = false;
    };

    const accepts = (event: DragEvent) => !fromPage && carriesText(event) && !isOnField(event);

    const onDragOver = (event: DragEvent) => {
      if (!accepts(event)) return;
      // The data can't be read until the drop, so any text is accepted here and checked there.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    const onDrop = (event: DragEvent) => {
      if (!accepts(event) || !event.dataTransfer) return;
      event.preventDefault();
      const url = droppedUrl({
        uriList: event.dataTransfer.getData("text/uri-list"),
        text: event.dataTransfer.getData("text/plain"),
      });
      if (url) open({ url });
    };

    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragend", onDragEnd);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragend", onDragEnd);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [open]);

  return null;
}
