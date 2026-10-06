import type * as api from "../../api";
import { ExpenseComposer } from "./ExpenseComposer";
import { PromiseComposer } from "./PromiseComposer";
import { TransferComposer } from "./TransferComposer";
import type { TransferPrefill } from "./transferForm";
import type { RecordComposerKind, RecordComposerProps } from "./types";

type RecordComposerSwitchProps = Omit<
  RecordComposerProps<RecordComposerKind>,
  "initialDescription"
> & {
  kind: RecordComposerKind;
  initialDescription?: api.WritableRecordDescription;
  categories: api.Category[];
  transferPrefill?: TransferPrefill | null;
};

/** Renders the composer for `kind`, passing `initialDescription` through only when it matches. */
export function RecordComposer({
  kind,
  initialDescription,
  categories,
  transferPrefill,
  ...props
}: RecordComposerSwitchProps) {
  switch (kind) {
    case "expense":
      return (
        <ExpenseComposer
          {...props}
          categories={categories}
          initialDescription={
            initialDescription?.type === "expense" ? initialDescription : undefined
          }
        />
      );
    case "transfer":
      return (
        <TransferComposer
          {...props}
          prefill={transferPrefill}
          initialDescription={
            initialDescription?.type === "transfer" ? initialDescription : undefined
          }
        />
      );
    case "promise":
      return (
        <PromiseComposer
          {...props}
          initialDescription={
            initialDescription?.type === "promise" ? initialDescription : undefined
          }
        />
      );
  }
}
