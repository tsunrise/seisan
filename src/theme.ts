import { createTheme } from "@mui/material/styles";

export const ledgerColors = {
  paperBg: "#f7f6f1",
  paper: "#fffdfa",
  paperSoft: "#faf8f2",
  ink: "#181713",
  muted: "#68645b",
  line: "#ded8cc",
  lineStrong: "#c9c1b4",
  blue: "#1167d8",
  blueDark: "#0c4da3",
  blueSoft: "#eef6ff",
  red: "#a81721",
  green: "#17643d",
  shadowInk: "rgba(24, 23, 19, 0.035)",
};

export const ledgerFonts = {
  sans: '"Source Sans 3 Variable", sans-serif',
  serif: '"Source Serif 4 Variable", serif',
  mono: '"Source Code Pro Variable", monospace',
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
    borderRadius: 4,
  },
  typography: {
    fontFamily: ledgerFonts.sans,
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
          background: ledgerColors.paperBg,
          color: ledgerColors.ink,
          fontSynthesis: "none",
          fontVariantNumeric: "tabular-nums",
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
          borderRadius: 4,
          boxShadow: "none",
          transition:
            "background-color 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease",
          "&:active": {
            transform: "translateY(1px)",
          },
        },
        contained: {
          backgroundColor: ledgerColors.ink,
          borderColor: ledgerColors.ink,
          color: ledgerColors.paper,
          "&:hover": {
            backgroundColor: "#343128",
            borderColor: "#343128",
            boxShadow: "none",
          },
        },
        outlined: {
          borderColor: ledgerColors.line,
          color: ledgerColors.ink,
          "&:hover": {
            backgroundColor: "rgba(24, 23, 19, 0.035)",
            borderColor: ledgerColors.lineStrong,
          },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          border: `1px solid ${ledgerColors.line}`,
          borderRadius: 4,
          backgroundColor: ledgerColors.paper,
          boxShadow: "none",
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
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 4,
          backgroundColor: "rgba(255, 253, 250, 0.82)",
          transition: "background-color 160ms ease, box-shadow 160ms ease",
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: ledgerColors.line,
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: ledgerColors.lineStrong,
          },
          "&.Mui-focused": {
            backgroundColor: ledgerColors.paper,
            boxShadow: `0 0 0 2px rgba(17, 103, 216, 0.1)`,
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: ledgerColors.blue,
          },
        },
      },
    },
    MuiFormControl: {
      defaultProps: {
        size: "small",
      },
    },
  },
});
