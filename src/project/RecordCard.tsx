import { Avatar, Box, Paper, Stack, Typography } from "@mui/material";
import { Link } from "react-router";

import type * as api from "../api";
import { Amount } from "../components/Amount";
import { recordTitle } from "../domain";
import { ledgerColors } from "../theme";
import { initials } from "../utils";
import { recordActorMemberId } from "./recordActor";

export function RecordCard({
  project,
  record,
  currentMember,
}: {
  project: api.Project;
  record: api.ProjectRecord;
  currentMember: api.ProjectMember | null;
}) {
  const actor = project.members.find((member) => member.id === recordActorMemberId(record));
  const author = project.members.find((member) => member.id === record.authorMemberId);
  const showPostedBy = actor !== undefined && actor.id !== record.authorMemberId;
  const subjectIsCurrentMember = actor?.id === currentMember?.id;
  const viewerDelta = currentMember ? (record.delta[String(currentMember.id)] ?? 0) : null;

  const avatar = (
    <Avatar
      sx={{
        width: 52,
        height: 52,
        alignSelf: "end",
        mb: 1.75,
        color: ledgerColors.ink,
        bgcolor: "background.paper",
        border: `2px solid ${ledgerColors.ink}`,
        fontWeight: 900,
      }}
    >
      {initials(actor?.name ?? "?")}
    </Avatar>
  );
  const bubble = (
    <Paper
      component="article"
      square={false}
      sx={{
        position: "relative",
        display: "grid",
        gap: 0.75,
        justifySelf: subjectIsCurrentMember ? "end" : "start",
        width: "min(100%, 390px)",
        p: 2,
        border: `2px solid ${ledgerColors.ink}`,
        borderRadius: 1,
        bgcolor: "background.paper",
        "&::before": {
          content: '""',
          position: "absolute",
          bottom: 28,
          width: 14,
          height: 14,
          bgcolor: "background.paper",
          ...(subjectIsCurrentMember
            ? {
                right: -8,
                borderRight: `2px solid ${ledgerColors.ink}`,
                borderBottom: `2px solid ${ledgerColors.ink}`,
                transform: "rotate(-45deg)",
              }
            : {
                left: -8,
                borderLeft: `2px solid ${ledgerColors.ink}`,
                borderBottom: `2px solid ${ledgerColors.ink}`,
                transform: "rotate(45deg)",
              }),
        },
        "&:hover": {
          borderColor: "primary.main",
        },
      }}
    >
      <Typography
        sx={{
          position: "absolute",
          top: 14,
          right: 16,
          color: "text.secondary",
          fontSize: 14,
          fontWeight: 900,
        }}
      >
        #{record.id}
      </Typography>
      <Typography
        sx={{
          pr: 5.5,
          color: "text.secondary",
          fontSize: 15,
          fontWeight: 700,
        }}
      >
        {actor?.name ?? "Unknown member"}
      </Typography>
      <Typography variant="h2" sx={{ pr: 5.5 }}>
        {recordTitle(record, project.members)}
      </Typography>
      {showPostedBy || (viewerDelta !== null && viewerDelta !== 0) ? (
        <Stack
          direction="row"
          sx={{ alignItems: "end", justifyContent: "space-between", gap: 1.5, mt: 0.75 }}
        >
          {showPostedBy ? (
            <Typography
              sx={{
                minWidth: 0,
                overflow: "hidden",
                color: "text.secondary",
                fontSize: 13,
                fontWeight: 700,
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Posted By {author?.name ?? "Unknown member"}
            </Typography>
          ) : (
            <Box />
          )}
          {viewerDelta !== null && viewerDelta !== 0 ? <Amount amount={viewerDelta} /> : null}
        </Stack>
      ) : null}
    </Paper>
  );

  return (
    <Box
      component={Link}
      to={`/project/${project.id}/records/${record.id}`}
      sx={{
        display: "grid",
        gridTemplateColumns: subjectIsCurrentMember ? "minmax(0, 1fr) 60px" : "60px minmax(0, 1fr)",
        gap: 1.75,
        color: "inherit",
        textDecoration: "none",
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
