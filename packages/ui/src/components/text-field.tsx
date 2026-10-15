"use client";

import {
  FieldError,
  Input,
  Label,
  TextArea,
  TextField as AriaTextField,
} from "react-aria-components";
import type { TextFieldProps as AriaTextFieldProps } from "react-aria-components";

import { cn } from "../cn";

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

const CONTROL =
  "rounded-xs border border-outline bg-surface-container-high px-4 py-3 typescale-body-lg text-on-surface placeholder:text-on-surface-variant data-focused:border-primary data-invalid:border-error";

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
      className={cn("flex flex-col gap-1", className)}
    >
      <Label className="typescale-label-md text-on-surface-variant">{label}</Label>
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
          className={cn(CONTROL, "min-h-14")}
        />
      )}
      <FieldError className="typescale-body-sm text-error">{errorMessage}</FieldError>
    </AriaTextField>
  );
}
