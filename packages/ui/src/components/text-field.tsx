"use client";

import {
  FieldError,
  Input,
  Label,
  TextArea,
  TextField as AriaTextField,
} from "react-aria-components";
import type { TextFieldProps as AriaTextFieldProps } from "react-aria-components";

import { cn } from "../cn.ts";

export interface TextFieldProps extends Omit<AriaTextFieldProps, "className" | "children"> {
  label: string;
  placeholder?: string;
  /** Shown under the field and marks it invalid. */
  errorMessage?: string;
  /** A resizable text area instead of a single line. */
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  /** Layout only: placement in the parent, not appearance. */
  className?: string;
}

// The well draws its own focus ring (`field-indicator`), so the global one stays off.
const CONTROL =
  "field-indicator rounded-lg px-3.5 py-2.5 typescale-body-lg text-ink outline-none placeholder:text-ink-faint data-disabled:opacity-40";

export function TextField({
  label,
  placeholder,
  errorMessage,
  multiline = false,
  rows = 3,
  maxLength,
  className,
  ...props
}: TextFieldProps) {
  return (
    <AriaTextField
      {...props}
      isInvalid={errorMessage ? true : props.isInvalid}
      className={cn("flex flex-col gap-1.5", className)}
    >
      <Label className="typescale-label-md text-ink-muted">{label}</Label>
      {multiline ? (
        <TextArea
          rows={rows}
          placeholder={placeholder}
          maxLength={maxLength}
          className={cn(CONTROL, "min-h-24 resize-y")}
        />
      ) : (
        <Input
          placeholder={placeholder}
          maxLength={maxLength}
          className={cn(CONTROL, "min-h-11")}
        />
      )}
      <FieldError className="typescale-body-sm text-danger">{errorMessage}</FieldError>
    </AriaTextField>
  );
}
