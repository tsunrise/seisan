import AddIcon from "@mui/icons-material/Add";
import { Box, Button } from "@mui/material";
import { Link, useLocation } from "react-router";

import type * as api from "../../api";
import { loginPath } from "../../utils";
import { projectPaths } from "../paths";

/**
 * Fixed bottom CTA on mobile timelines. `timeline/timelineScroll.ts` finds it through
 * `data-project-mobile-action` to keep the latest record clear of it; keep the marker in sync.
 */
export function ProjectMobileAction({
  projectId,
  currentMember,
  currentEmail,
}: {
  projectId: string;
  currentMember: api.ProjectMember | null;
  currentEmail: string | null;
}) {
  const location = useLocation();

  return (
    <Box
      data-project-mobile-action=""
      sx={{
        position: "fixed",
        right: 16,
        bottom: "calc(16px + env(safe-area-inset-bottom))",
        left: 16,
        zIndex: 8,
        display: { xs: "block", md: "none" },
      }}
    >
      {currentMember ? (
        <Button
          component={Link}
          to={projectPaths.newRecord(projectId)}
          variant="contained"
          startIcon={<AddIcon />}
          fullWidth
          sx={{ minHeight: 56 }}
        >
          Post record
        </Button>
      ) : (
        <Button
          component={Link}
          to={currentEmail ? projectPaths.join(projectId) : loginPath(location)}
          variant="contained"
          fullWidth
          sx={{ minHeight: 56 }}
        >
          Join Project
        </Button>
      )}
    </Box>
  );
}
