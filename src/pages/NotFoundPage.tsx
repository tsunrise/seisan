import { Box, Paper, Stack, Typography } from "@mui/material";

import { BrandLink } from "../components/BrandLink";
import { panelFrameSx, pageCenterSx } from "../components/styles";

export function NotFoundPage() {
  return (
    <StatusPage
      title="404 Not Found"
      body="We could not find a Seisan page or project for this link. Check the URL for typos, then try the link again."
    />
  );
}

export function NoAccessPage() {
  return (
    <StatusPage
      title="No access"
      body="This project is restricted. Ask the person who shared it to add your Seisan email, then open this link again."
    />
  );
}

function StatusPage({ title, body }: { title: string; body: string }) {
  return (
    <Box component="main" sx={pageCenterSx}>
      <Paper square sx={{ ...panelFrameSx, width: "min(100%, 420px)" }}>
        <Stack spacing={2}>
          <Box>
            <BrandLink sx={{ mb: 1 }} />
            <Typography variant="h1">{title}</Typography>
          </Box>
          <Typography color="text.secondary">{body}</Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
