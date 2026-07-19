import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { Box, Button, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Link } from "react-router";

import * as api from "../api";
import { MoneyTable } from "../components/MoneyTable";
import { PanelFrame } from "../components/PanelFrame";
import {
  formatRecordDetailTimestamp,
  memberName,
  recordDetailTitle,
  recordSubtitle,
} from "../domain";
import { ledgerColors, ledgerFonts } from "../theme";
import { recordReferencesDeletedMember, writableRecordDescription } from "./recordEditing";

export function RecordDetail({
  project,
  record,
  currentMember,
}: {
  project: api.Project;
  record: api.ProjectRecord;
  currentMember: api.ProjectMember | null;
}) {
  const writableDescription = writableRecordDescription(record);
  const referencesDeletedMember = recordReferencesDeletedMember(record, project.members);
  const editPath = `/project/${project.id}/records/${record.id}/edit`;

  return (
    <PanelFrame title="Record detail" backTo={`/project/${project.id}`}>
      <Box component="article">
        <Stack spacing={2.25}>
          <Stack spacing={0.5}>
            <Typography color="text.secondary" sx={{ fontWeight: 650 }}>
              #{record.id}
            </Typography>
            <Typography
              component="h2"
              sx={{
                fontFamily: ledgerFonts.serif,
                fontSize: { xs: "2rem", md: "2.25rem" },
                fontWeight: 500,
                letterSpacing: "-0.035em",
                lineHeight: 1.08,
              }}
            >
              {record.description.type === "deleted" ? (
                "Post deleted"
              ) : record.description.type === "revert" ? (
                <>
                  Reverted{" "}
                  <RecordDetailLink projectId={project.id} recordId={record.description.id}>
                    #{record.description.id}
                  </RecordDetailLink>
                </>
              ) : (
                recordDetailTitle(record, project.members)
              )}
            </Typography>
            <Typography color="text.secondary">
              {record.description.type === "deleted"
                ? `Originally posted by ${memberName(project.members, record.authorMemberId)}`
                : recordSubtitle(record, project.members)}
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              {formatRecordDetailTimestamp(record.createdAt)}
            </Typography>
            {record.updatedAt !== undefined && record.updatedByMemberId !== undefined ? (
              <Stack spacing={0.15} sx={{ pt: 0.5 }}>
                <Typography color="text.secondary" sx={{ fontSize: 13, fontWeight: 650 }}>
                  {record.description.type === "deleted" ? "Deleted" : "Edited"} by{" "}
                  {memberName(project.members, record.updatedByMemberId)}
                </Typography>
                <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                  {formatRecordDetailTimestamp(record.updatedAt)}
                </Typography>
              </Stack>
            ) : null}
            {currentMember && writableDescription ? (
              <Stack spacing={0.5} sx={{ alignItems: "flex-start", pt: 0.75 }}>
                <Button
                  component={Link}
                  to={editPath}
                  variant="outlined"
                  startIcon={<EditOutlinedIcon />}
                  disabled={referencesDeletedMember}
                >
                  Edit
                </Button>
                {referencesDeletedMember ? (
                  <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                    Records involving deleted project members cannot be edited.
                  </Typography>
                ) : null}
              </Stack>
            ) : null}
          </Stack>
          {record.description.type !== "revert" && record.description.type !== "deleted" ? (
            <>
              <Divider sx={{ borderColor: ledgerColors.line }} />
              <MoneyTable title="Balance change" project={project} map={record.delta} />
            </>
          ) : null}
          {record.description.type === "expense" ? (
            <>
              <Divider sx={{ borderColor: ledgerColors.line }} />
              <MoneyTable
                title="Paid"
                project={project}
                map={record.description.paid}
                amountColorMode="plain"
              />
              <Divider sx={{ borderColor: ledgerColors.line }} />
              <MoneyTable
                title="Liability"
                project={project}
                map={record.description.liability}
                amountColorMode="plain"
              />
            </>
          ) : null}
        </Stack>
      </Box>
    </PanelFrame>
  );
}

function RecordDetailLink({
  projectId,
  recordId,
  children,
}: {
  projectId: string;
  recordId: number;
  children: ReactNode;
}) {
  return (
    <Typography
      component={Link}
      to={`/project/${projectId}/records/${recordId}`}
      sx={{
        color: "primary.main",
        font: "inherit",
        fontWeight: "inherit",
        textDecoration: "none",
        "&:hover": {
          textDecoration: "underline",
        },
        "&:focus-visible": {
          outline: "2px solid currentColor",
          outlineOffset: 2,
        },
      }}
    >
      {children}
    </Typography>
  );
}
