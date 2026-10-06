import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import SecurityIcon from "@mui/icons-material/Security";
import { IconButton, Stack, Tooltip, Typography } from "@mui/material";

import type * as api from "../../api";
import { Amount } from "../../components/Amount";
import { MemberNameWithRepresentation } from "../../components/MemberNameWithRepresentation";

const memberActionButtonSx = {
  border: 0,
  bgcolor: "transparent",
  "&:hover": { bgcolor: "action.hover" },
  "&.Mui-disabled": { border: 0, bgcolor: "transparent" },
};

/**
 * One member with balance and, in manage mode, the actions the viewer may take. Owners always see
 * unlink and delete (disabled when not allowed); other managers only see edit where permitted.
 */
export function MemberSettingsRow({
  member,
  balance,
  isCurrentMember,
  isOwnerMember,
  showEmail,
  manage,
  viewerIsOwner,
  canEdit,
  canUnlink,
  canDelete,
  onEdit,
  onUnlink,
  onDelete,
}: {
  member: api.ProjectMemberFull;
  balance: number;
  isCurrentMember: boolean;
  isOwnerMember: boolean;
  showEmail: boolean;
  manage: boolean;
  viewerIsOwner: boolean;
  canEdit: boolean;
  canUnlink: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onUnlink: () => void;
  onDelete: () => void;
}) {
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: "flex-start",
        gap: 1.25,
        py: 0.5,
      }}
    >
      <Stack sx={{ minWidth: 0, flex: "1 1 auto", gap: 0.2 }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, minWidth: 0 }}>
          <MemberNameWithRepresentation
            member={member}
            nameSx={{
              fontWeight: isCurrentMember ? 850 : 600,
              overflowWrap: "anywhere",
            }}
          />
          {isOwnerMember ? (
            <Tooltip title="Owner">
              <SecurityIcon
                aria-label="Owner"
                fontSize="small"
                sx={{ color: "text.secondary", flex: "0 0 auto" }}
              />
            </Tooltip>
          ) : null}
        </Stack>
        {showEmail ? (
          <Typography color="text.secondary" sx={{ fontSize: 12.5, lineHeight: 1.3 }}>
            {member.linkedEmail ?? "Not yet joined"}
          </Typography>
        ) : null}
        {member.config?.paymentMethod ? (
          <Typography sx={{ color: "text.secondary", fontSize: 12.5, lineHeight: 1.3 }}>
            Transfer method: {member.config.paymentMethod}
          </Typography>
        ) : null}
      </Stack>
      <Stack direction="row" sx={{ alignItems: "center", gap: 0.5, flex: "0 0 auto" }}>
        <Amount amount={balance} />
        {manage && canEdit ? (
          <IconButton aria-label={`Edit ${member.name}`} onClick={onEdit} sx={memberActionButtonSx}>
            <EditIcon fontSize="small" />
          </IconButton>
        ) : null}
        {manage && viewerIsOwner ? (
          <>
            <Tooltip title={canUnlink ? "Unlink email" : "Cannot unlink"}>
              <span>
                <IconButton
                  color="warning"
                  aria-label={`Unlink ${member.name}`}
                  disabled={!canUnlink}
                  onClick={onUnlink}
                  sx={memberActionButtonSx}
                >
                  <LinkOffIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <IconButton
              color="error"
              aria-label={`Delete ${member.name}`}
              disabled={!canDelete}
              onClick={onDelete}
              sx={memberActionButtonSx}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </>
        ) : null}
      </Stack>
    </Stack>
  );
}
