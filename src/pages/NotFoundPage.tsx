import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { Link } from "react-router";

import { panelFrameSx, pageCenterSx } from "../components/styles";

export function NotFoundPage() {
  return (
    <Box component="main" sx={pageCenterSx}>
      <Paper square sx={panelFrameSx}>
        <Stack spacing={2}>
          <Typography variant="h1">Not found</Typography>
          <Typography color="text.secondary">This page or project is not available.</Typography>
          <Button component={Link} to="/projects" variant="contained">
            Projects
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
