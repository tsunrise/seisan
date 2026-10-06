import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import { Box, IconButton, Stack, Typography } from "@mui/material";
import { Children, Fragment, isValidElement, type ReactNode } from "react";

import { ledgerColors } from "../theme";

export function LinkedBlockList({
  children,
  connector = "and",
}: {
  children: ReactNode;
  connector?: ReactNode | ((index: number) => ReactNode);
}) {
  const blocks = Children.toArray(children);

  return (
    <Stack spacing={0}>
      {blocks.map((block, index) => (
        <Fragment key={isValidElement(block) && block.key !== null ? block.key : index}>
          {index > 0 ? (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "1px auto",
                columnGap: 1,
                alignItems: "center",
                height: 28,
                pl: 1.25,
              }}
            >
              <Box sx={{ width: 1, height: "100%", bgcolor: ledgerColors.line }} />
              <LinkedBlockVerb>
                {typeof connector === "function" ? connector(index) : connector}
              </LinkedBlockVerb>
            </Box>
          ) : null}
          <Box
            sx={{
              p: 1.25,
              border: `1px solid ${ledgerColors.line}`,
              borderRadius: 1,
              bgcolor: ledgerColors.paperSoft,
            }}
          >
            {block}
          </Box>
        </Fragment>
      ))}
    </Stack>
  );
}

export function LinkedBlockVerb({ children }: { children: ReactNode }) {
  return (
    <Typography
      component="span"
      sx={{
        color: ledgerColors.muted,
        fontSize: 13,
        fontWeight: 650,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Typography>
  );
}

/** Borderless trash button that sits in the trailing 32px column of a linked-block row. */
export function LinkedBlockRemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <IconButton
      type="button"
      size="small"
      aria-label={label}
      onClick={onClick}
      sx={{
        width: 32,
        height: 36,
        border: 0,
        bgcolor: "transparent",
        color: "text.secondary",
        "&:hover": { bgcolor: "action.hover", color: "text.primary" },
      }}
    >
      <DeleteOutlineIcon fontSize="small" />
    </IconButton>
  );
}
