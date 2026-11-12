import { fieldErrors } from "@billy/core";
import { type FormEvent, useState } from "react";
import type { z } from "zod";
import { toast } from "../components/ui/toast.tsx";
import { ApiError } from "./api.ts";

/**
 * Form state validated by the same zod schema the API uses. Field messages come from the
 * schema on the client and from `ApiError.fields` when the server rejects the input.
 */
export function useForm<S extends z.ZodType<unknown, Record<string, unknown>>>(schema: S, initial: z.input<S>) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof z.input<S>>(key: K, value: z.input<S>[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors(({ [key as string]: _cleared, ...rest }) => rest);
  }

  function onSubmit(save: (data: z.output<S>) => Promise<unknown>) {
    return async (event: FormEvent) => {
      event.preventDefault();
      const parsed = schema.safeParse(values);
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error));
        return;
      }
      setErrors({});
      setSubmitting(true);
      try {
        await save(parsed.data);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        setErrors(err.fields);
        toast(err.message, "down");
      } finally {
        setSubmitting(false);
      }
    };
  }

  return { values, set, setValues, errors, submitting, onSubmit };
}
