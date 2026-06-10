import { createTheme } from "@mui/material/styles";

export const ledgerColors = {
  paperBg: "#f4f2ea",
  paper: "#fffdf5",
  ink: "#22211f",
  muted: "#6f6b62",
  line: "#c8c2b6",
  blue: "#1167d8",
  blueDark: "#0c4da3",
  blueSoft: "#e8f4ff",
  red: "#b61b2a",
  green: "#07804f",
  shadowInk: "rgba(34, 33, 31, 0.06)",
};

export const theme = createTheme({
  cssVariables: true,
  palette: {
    background: {
      default: ledgerColors.paperBg,
      paper: ledgerColors.paper,
    },
    text: {
      primary: ledgerColors.ink,
      secondary: ledgerColors.muted,
    },
    primary: {
      main: ledgerColors.blue,
      dark: ledgerColors.blueDark,
      contrastText: ledgerColors.paper,
    },
    error: {
      main: ledgerColors.red,
    },
    success: {
      main: ledgerColors.green,
    },
    divider: ledgerColors.line,
  },
  shape: {
    borderRadius: 5,
  },
  typography: {
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h1: {
      fontSize: "2rem",
      lineHeight: 1.1,
      fontWeight: 700,
      letterSpacing: 0,
    },
    h2: {
      fontSize: "1.375rem",
      lineHeight: 1.18,
      fontWeight: 700,
      letterSpacing: 0,
    },
    h3: {
      fontSize: "1rem",
      fontWeight: 700,
      letterSpacing: 0,
    },
    button: {
      fontWeight: 700,
      textTransform: "none",
      letterSpacing: 0,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        "*": {
          boxSizing: "border-box",
        },
        body: {
          minWidth: 320,
          background: `linear-gradient(rgba(23, 23, 23, 0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(23, 23, 23, 0.018) 1px, transparent 1px),
            ${ledgerColors.paperBg}`,
          backgroundSize: "28px 28px",
          fontSynthesis: "none",
          textRendering: "optimizeLegibility",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        },
        "h1, h2, h3, p": {
          overflowWrap: "anywhere",
        },
        "#root": {
          minHeight: "100svh",
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          minHeight: 42,
          borderWidth: 1,
          borderRadius: 5,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          border: `1px solid ${ledgerColors.line}`,
          borderRadius: 5,
          backgroundColor: ledgerColors.paper,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: "small",
      },
    },
    MuiFormControl: {
      defaultProps: {
        size: "small",
      },
    },
  },
});
