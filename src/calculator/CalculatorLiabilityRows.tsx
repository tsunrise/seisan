import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import {
  Box,
  Checkbox,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";

import { formatCents } from "../domain";
import {
  MAX_CALCULATOR_MEMBER_NAME_LENGTH,
  memberIssueMessage,
  type CalculatorDraft,
  type CalculatorIssue,
} from "./groupExpenseCalculator";
import type { LiabilityNameEditor } from "./useGroupExpenseCalculator";

const compactInputSx = {
  minWidth: 0,
  "& .MuiInputBase-root": { height: 36 },
  "& .MuiInputBase-input": { px: { xs: 0.75, sm: 1 }, textAlign: "right" },
} as const;

const shareTextSx = {
  fontSize: { xs: 13.5, sm: 14.5 },
  fontVariantNumeric: "tabular-nums",
  fontWeight: 750,
  textAlign: "right",
} as const;

/**
 * Flat liability rows: participation checkbox, name, Equal/Ratio share preview, optional ratio or
 * custom input, and Edit/Delete actions. Payer names are owned by "Who paid?", so payers cannot be
 * renamed or deleted here. At most one name editor (existing or new member) is open at a time.
 */
export function CalculatorLiabilityRows({
  draft,
  issues,
  payerMemberIds,
  selectedMemberIds,
  allocation,
  editor,
  onSelected,
  onRatio,
  onCustom,
  onStartEdit,
  onDelete,
  onEditorValue,
  onCancelEditor,
  onConfirmEditor,
}: {
  draft: CalculatorDraft;
  issues: CalculatorIssue[];
  payerMemberIds: Set<number>;
  selectedMemberIds: Set<number>;
  allocation: Record<string, number>;
  editor: LiabilityNameEditor | null;
  onSelected: (memberId: number, selected: boolean) => void;
  onRatio: (memberId: number, value: string) => void;
  onCustom: (memberId: number, value: string) => void;
  onStartEdit: (memberId: number, name: string) => void;
  onDelete: (memberId: number) => void;
  onEditorValue: (value: string) => void;
  onCancelEditor: () => void;
  onConfirmEditor: () => void;
}) {
  const rowColumns =
    draft.splitMode === "equal"
      ? "32px minmax(36px, 1fr) minmax(62px, auto) 32px 32px"
      : draft.splitMode === "ratio"
        ? "32px minmax(36px, 1fr) minmax(62px, auto) minmax(58px, 76px) 32px 32px"
        : "32px minmax(36px, 1fr) minmax(78px, 100px) 32px 32px";
  const rowSx = {
    display: "grid",
    gridTemplateColumns: rowColumns,
    columnGap: { xs: 0.25, sm: 0.75 },
    alignItems: "center",
    minHeight: 46,
    py: 0.375,
  } as const;
  const editorHandlers = {
    onValue: onEditorValue,
    onCancel: onCancelEditor,
    onConfirm: onConfirmEditor,
  };

  return (
    <Stack spacing={0}>
      {draft.members.length === 0 && editor?.kind !== "new" ? (
        <Typography color="text.secondary" sx={{ py: 0.75, fontSize: 13.5 }}>
          Name a payer or add a member to build the group.
        </Typography>
      ) : null}

      {draft.members.map((member) => {
        const isPayer = payerMemberIds.has(member.id);
        const selected = selectedMemberIds.has(member.id);
        const isEditing = editor?.kind === "member" && editor.memberId === member.id;
        const anotherEditorOpen = editor !== null && !isEditing;
        const splitIssue =
          draft.splitMode === "ratio" || draft.splitMode === "custom"
            ? memberIssueMessage(issues, member.id, draft.splitMode)
            : null;
        const issueId = `calculator-member-${member.id}-issue`;
        const share = allocation[member.id] ?? 0;

        return (
          <Box key={member.id} sx={rowSx}>
            <Checkbox
              size="small"
              checked={selected}
              disabled={isEditing}
              slotProps={{
                input: {
                  "aria-label": `${selected ? "Exclude" : "Include"} ${member.name} ${
                    selected ? "from" : "in"
                  } the split`,
                },
              }}
              onChange={(event) => onSelected(member.id, event.target.checked)}
              sx={{ p: 0.5 }}
            />

            {isEditing ? (
              <NameEditorField
                ariaLabel={`Edit ${member.name} member name`}
                editor={editor}
                {...editorHandlers}
              />
            ) : (
              <Typography
                title={member.name}
                sx={{
                  minWidth: 0,
                  overflow: "hidden",
                  color: selected ? "text.primary" : "text.secondary",
                  fontWeight: selected ? 550 : 450,
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {member.name}
              </Typography>
            )}

            {draft.splitMode !== "custom" ? (
              <Typography
                aria-label={`${member.name} allocated share ${formatCents(share)}`}
                sx={{
                  ...shareTextSx,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {formatCents(share)}
              </Typography>
            ) : null}

            {draft.splitMode === "ratio" ? (
              <Tooltip title={splitIssue ?? ""}>
                <TextField
                  size="small"
                  inputMode="decimal"
                  value={draft.ratios[member.id] ?? "1"}
                  disabled={isEditing}
                  error={Boolean(splitIssue)}
                  onChange={(event) => onRatio(member.id, event.target.value)}
                  slotProps={{
                    htmlInput: {
                      "aria-label": `${member.name} ratio`,
                      "aria-describedby": splitIssue ? issueId : undefined,
                    },
                  }}
                  sx={compactInputSx}
                />
              </Tooltip>
            ) : null}

            {draft.splitMode === "custom" ? (
              <Tooltip title={splitIssue ?? ""}>
                <TextField
                  size="small"
                  inputMode="decimal"
                  value={draft.customAmounts[member.id] ?? ""}
                  disabled={isEditing}
                  error={Boolean(splitIssue)}
                  onChange={(event) => onCustom(member.id, event.target.value)}
                  slotProps={{
                    input: {
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    },
                    htmlInput: {
                      "aria-label": `${member.name} custom share`,
                      "aria-describedby": splitIssue ? issueId : undefined,
                    },
                  }}
                  sx={{
                    ...compactInputSx,
                    "& .MuiInputAdornment-root": { mr: 0.25 },
                    "& .MuiInputBase-root": { height: 36, pl: 0.75 },
                    "& .MuiInputBase-input": {
                      px: { xs: 0.25, sm: 0.5 },
                      textAlign: "right",
                    },
                  }}
                />
              </Tooltip>
            ) : null}

            {isEditing ? (
              <>
                <RowActionButton
                  title="Cancel name edit"
                  label={`Cancel editing ${member.name}`}
                  icon={<CloseIcon fontSize="small" />}
                  onClick={onCancelEditor}
                />
                <RowActionButton
                  title="Save member name"
                  label={`Save ${member.name} member name`}
                  icon={<CheckIcon fontSize="small" />}
                  onClick={onConfirmEditor}
                />
              </>
            ) : (
              <>
                <RowActionButton
                  title={
                    isPayer
                      ? "Edit this payer's name in Who paid."
                      : anotherEditorOpen
                        ? "Finish editing the current member first."
                        : "Edit member name"
                  }
                  label={
                    isPayer
                      ? `Cannot edit ${member.name} here while they are a payer`
                      : `Edit ${member.name}`
                  }
                  icon={<EditOutlinedIcon fontSize="small" />}
                  disabled={isPayer || anotherEditorOpen}
                  onClick={() => onStartEdit(member.id, member.name)}
                />
                <RowActionButton
                  title={
                    isPayer
                      ? "Remove this person from Who paid before deleting them."
                      : anotherEditorOpen
                        ? "Finish editing the current member first."
                        : "Delete member"
                  }
                  label={
                    isPayer
                      ? `Cannot delete ${member.name} while they are a payer`
                      : `Delete ${member.name}`
                  }
                  icon={<DeleteOutlineIcon fontSize="small" />}
                  disabled={isPayer || anotherEditorOpen}
                  onClick={() => onDelete(member.id)}
                />
              </>
            )}

            {isEditing && editor.issue ? (
              <RowIssue>{editor.issue}</RowIssue>
            ) : splitIssue ? (
              <RowIssue id={issueId}>{splitIssue}</RowIssue>
            ) : null}
          </Box>
        );
      })}

      {editor?.kind === "new" ? (
        <Box sx={rowSx}>
          <Checkbox
            size="small"
            checked
            disabled
            slotProps={{ input: { "aria-label": "New member included in the split" } }}
            sx={{ p: 0.5 }}
          />
          <NameEditorField ariaLabel="New member name" editor={editor} {...editorHandlers} />
          {draft.splitMode !== "custom" ? (
            <Typography
              aria-label="New member allocated share $0.00"
              sx={{ ...shareTextSx, whiteSpace: "nowrap" }}
            >
              {formatCents(0)}
            </Typography>
          ) : null}
          {draft.splitMode === "ratio" ? (
            <TextField
              size="small"
              value="1"
              disabled
              slotProps={{ htmlInput: { "aria-label": "New member ratio" } }}
              sx={compactInputSx}
            />
          ) : null}
          {draft.splitMode === "custom" ? (
            <TextField
              size="small"
              value=""
              disabled
              slotProps={{ htmlInput: { "aria-label": "New member custom share" } }}
              sx={compactInputSx}
            />
          ) : null}
          <RowActionButton
            title="Cancel new member"
            label="Cancel new member"
            icon={<CloseIcon fontSize="small" />}
            onClick={onCancelEditor}
          />
          <RowActionButton
            title="Add member"
            label="Confirm new member"
            icon={<CheckIcon fontSize="small" />}
            onClick={onConfirmEditor}
          />
          {editor.issue ? <RowIssue>{editor.issue}</RowIssue> : null}
        </Box>
      ) : null}
    </Stack>
  );
}

/** Inline name input: Enter confirms and Escape cancels. */
function NameEditorField({
  ariaLabel,
  editor,
  onValue,
  onCancel,
  onConfirm,
}: {
  ariaLabel: string;
  editor: LiabilityNameEditor;
  onValue: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <TextField
      autoFocus
      size="small"
      placeholder="Member name"
      value={editor.value}
      error={Boolean(editor.issue)}
      onChange={(event) => onValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onConfirm();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      slotProps={{
        htmlInput: {
          "aria-label": ariaLabel,
          maxLength: MAX_CALCULATOR_MEMBER_NAME_LENGTH + 1,
        },
      }}
      sx={{
        minWidth: 0,
        "& .MuiInputBase-root": { height: 36 },
        "& .MuiInputBase-input": { px: 1 },
      }}
    />
  );
}

/**
 * Borderless row icon button with a tooltip. Passing `disabled` (even `false`) wraps the button in
 * a span so the tooltip still shows while it is disabled.
 */
function RowActionButton({
  title,
  label,
  icon,
  disabled,
  onClick,
}: {
  title: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  const button = (
    <IconButton
      type="button"
      size="small"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      sx={{
        width: 32,
        height: 32,
        p: 0.5,
        border: 0,
        color: "text.secondary",
        "&:hover": { bgcolor: "action.hover", color: "text.primary" },
        "&.Mui-disabled": { color: "action.disabled" },
      }}
    >
      {icon}
    </IconButton>
  );

  return (
    <Tooltip title={title}>
      {disabled === undefined ? button : <span style={{ display: "flex" }}>{button}</span>}
    </Tooltip>
  );
}

function RowIssue({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <Typography
      id={id}
      role="alert"
      color="error"
      sx={{ gridColumn: "2 / -1", mt: 0.125, fontSize: 12 }}
    >
      {children}
    </Typography>
  );
}
