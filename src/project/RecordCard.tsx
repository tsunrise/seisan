import { Avatar, Box, Paper, Stack, Typography } from "@mui/material";
import { Link } from "react-router";

import type * as api from "../api";
import { Amount } from "../components/Amount";
import { formatRecordTimestamp, recordTitle } from "../domain";
import { ledgerColors } from "../theme";
import { initials } from "../utils";
import { recordActorMemberId } from "./recordActor";

export function RecordCard({
  project,
  record,
  currentMember,
  onOpen,
}: {
  project: api.Project;
  record: api.ProjectRecord;
  currentMember: api.ProjectMember | null;
  onOpen?: (recordId: number) => void;
}) {
  const actor = project.members.find((member) => member.id === recordActorMemberId(record));
  const author = project.members.find((member) => member.id === record.authorMemberId);
  const showPostedBy = actor !== undefined && actor.id !== record.authorMemberId;
  const subjectIsCurrentMember = actor?.id === currentMember?.id;
  const viewerDelta = currentMember ? (record.delta[String(currentMember.id)] ?? 0) : null;
  const metadataText = showPostedBy
    ? `${formatRecordTimestamp(record.createdAt)}, posted by ${author?.name ?? "Unknown member"}`
    : formatRecordTimestamp(record.createdAt);
  const bubbleBg = subjectIsCurrentMember ? ledgerColors.blueSoft : "rgba(255, 253, 245, 0.92)";
  const bubbleHoverBg = subjectIsCurrentMember ? "#dceeff" : "rgba(247, 244, 236, 0.98)";
  const bubbleHoverBorder = subjectIsCurrentMember ? ledgerColors.blue : "rgba(34, 33, 31, 0.42)";
  const tailBorder = `1px solid ${ledgerColors.line}`;

  const avatar = (
    <Avatar
      sx={{
        width: { xs: 44, md: 48 },
        height: { xs: 44, md: 48 },
        alignSelf: "end",
        mb: 2.5,
        color: ledgerColors.ink,
        bgcolor: subjectIsCurrentMember ? "rgba(207, 232, 247, 0.8)" : "rgba(34, 33, 31, 0.08)",
        border: `1px solid rgba(34, 33, 31, 0.08)`,
        fontWeight: 750,
      }}
    >
      {initials(actor?.name ?? "?")}
    </Avatar>
  );
  const bubble = (
    <Paper
      component={Link}
      to={`/project/${project.id}/records/${record.id}`}
      onClick={() => onOpen?.(record.id)}
      aria-label={`Open record #${record.id}`}
      square={false}
      sx={{
        position: "relative",
        display: "grid",
        gap: 0.75,
        justifySelf: subjectIsCurrentMember ? "end" : "start",
        width: { xs: "min(100%, 390px)", md: "min(100%, 520px)" },
        minHeight: 112,
        p: { xs: 2, md: 2.25 },
        border: `1px solid ${ledgerColors.line}`,
        borderRadius: 2.5,
        bgcolor: bubbleBg,
        boxShadow: `0 4px 12px rgba(34, 33, 31, 0.05)`,
        color: "inherit",
        cursor: "pointer",
        textDecoration: "none",
        "&::before": {
          content: '""',
          position: "absolute",
          bottom: 36,
          width: 14,
          height: 14,
          bgcolor: bubbleBg,
          ...(subjectIsCurrentMember
            ? {
                right: -8,
                borderRight: tailBorder,
                borderBottom: tailBorder,
                transform: "rotate(-45deg)",
              }
            : {
                left: -8,
                borderLeft: tailBorder,
                borderBottom: tailBorder,
                transform: "rotate(45deg)",
              }),
        },
        "&:hover": {
          bgcolor: bubbleHoverBg,
          borderColor: bubbleHoverBorder,
          boxShadow: `0 6px 16px rgba(17, 103, 216, 0.08)`,
        },
        "&:hover::before": {
          bgcolor: bubbleHoverBg,
        },
        "&:focus-visible": {
          outline: `2px solid ${ledgerColors.blue}`,
          outlineOffset: 3,
        },
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: "baseline",
          gap: 1.5,
          justifyContent: "space-between",
          minWidth: 0,
        }}
      >
        <Typography
          sx={{
            minWidth: 0,
            color: "text.secondary",
            fontSize: 15,
            fontWeight: 650,
            overflowWrap: "anywhere",
          }}
        >
          {actor?.name ?? "Unknown member"}
        </Typography>
        <Typography
          sx={{
            flexShrink: 0,
            color: "text.secondary",
            fontSize: 14,
            fontWeight: 650,
            whiteSpace: "nowrap",
          }}
        >
          #{record.id}
        </Typography>
      </Stack>
      <Typography
        component="h2"
        sx={{
          fontSize: { xs: "1.25rem", md: "1.375rem" },
          fontWeight: 650,
          lineHeight: 1.25,
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {recordTitle(record, project.members)}
      </Typography>
      <Stack
        direction="row"
        sx={{
          alignItems: "end",
          justifyContent: "space-between",
          gap: 1.5,
          minWidth: 0,
          mt: 0.75,
        }}
      >
        <Typography
          sx={{
            minWidth: 0,
            color: "text.secondary",
            fontSize: 13,
            fontWeight: 650,
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        >
          {metadataText}
        </Typography>
        {viewerDelta !== null && viewerDelta !== 0 ? <Amount amount={viewerDelta} /> : null}
      </Stack>
    </Paper>
  );

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: subjectIsCurrentMember ? "minmax(0, 1fr) 56px" : "56px minmax(0, 1fr)",
        gap: { xs: 1.25, md: 1.75 },
        "@media (max-width: 899px)": {
          gridTemplateColumns: subjectIsCurrentMember
            ? "minmax(0, 1fr) 52px"
            : "52px minmax(0, 1fr)",
        },
      }}
    >
      {subjectIsCurrentMember ? (
        <>
          {bubble}
          {avatar}
        </>
      ) : (
        <>
          {avatar}
          {bubble}
        </>
      )}
    </Box>
  );
}
