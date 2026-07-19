import { Box, Divider, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Link } from "react-router";

import * as api from "../api";
import { MoneyTable } from "../components/MoneyTable";
import { PanelFrame } from "../components/PanelFrame";
import { formatRecordDetailTimestamp, recordDetailTitle, recordSubtitle } from "../domain";
import { ledgerColors, ledgerFonts } from "../theme";

export function RecordDetail({
  project,
  record,
}: {
  project: api.Project;
  record: api.ProjectRecord;
}) {
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
              {record.description.type === "revert" ? (
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
              {recordSubtitle(record, project.members)}
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              {formatRecordDetailTimestamp(record.createdAt)}
            </Typography>
          </Stack>
          {record.description.type !== "revert" ? (
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
