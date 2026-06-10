import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { Box, Paper, Stack, Typography } from "@mui/material";
import { useEffect, useMemo, useRef } from "react";

import type * as api from "../api";
import { panelFrameSx } from "../components/styles";
import { RecordCard } from "./RecordCard";

export function RecordTimeline({
  project,
  currentMember,
}: {
  project: api.Project;
  currentMember: api.ProjectMember | null;
}) {
  const lastRecordRef = useRef<HTMLDivElement | null>(null);
  const records = useMemo(
    () => [...project.records].sort((left, right) => left.id - right.id),
    [project.records],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      lastRecordRef.current?.scrollIntoView({ block: "end" });
    });

    return () => cancelAnimationFrame(frame);
  }, [project.id, records.length]);

  if (project.records.length === 0) {
    return (
      <Paper square sx={{ ...panelFrameSx, m: 4.5, textAlign: "center" }}>
        <Stack spacing={1.5} sx={{ alignItems: "center" }}>
          <ReceiptLongIcon />
          <Typography variant="h2">No records yet</Typography>
          <Typography color="text.secondary">
            Post the first spend when someone pays for the group.
          </Typography>
        </Stack>
      </Paper>
    );
  }

  return (
    <Box
      component="section"
      sx={{
        display: "grid",
        gap: { xs: 2.5, md: 3 },
        px: { xs: 2, md: 3 },
        pt: { xs: 2.75, md: 3.5 },
        pb: { xs: "92px", md: 3.5 },
      }}
    >
      {records.map((record, index) => (
        <Box
          key={record.id}
          ref={index === records.length - 1 ? lastRecordRef : undefined}
          sx={{ scrollMarginBottom: { xs: "92px", md: 0, lg: 28 } }}
        >
          <RecordCard project={project} record={record} currentMember={currentMember} />
        </Box>
      ))}
    </Box>
  );
}
