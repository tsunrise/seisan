import CodeOutlinedIcon from "@mui/icons-material/CodeOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import { ApiReferenceReact, type AnyApiReferenceConfiguration } from "@scalar/api-reference-react";
import { Box, Button, Stack } from "@mui/material";
import { Link } from "react-router";

import "@scalar/api-reference-react/style.css";
import "./apiDocs.css";

import { accountLinkState } from "../account/navigation";
import { BrandLink } from "../components/BrandLink";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const scalarConfiguration = {
  url: "/openapi.json",
  baseServerURL: window.location.origin,
  layout: "modern",
  theme: "none",
  forceDarkModeState: "light",
  hideDarkModeToggle: true,
  hideTestRequestButton: true,
  hideClientButton: true,
  showDeveloperTools: "never",
  telemetry: false,
  persistAuth: false,
  withDefaultFonts: false,
  showSidebar: true,
  defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
  documentDownloadType: "none",
  modelsSectionLabel: "Schemas",
  operationTitleSource: "summary",
  orderRequiredPropertiesFirst: true,
  orderSchemaPropertiesBy: "preserve",
  agent: { disabled: true },
  mcp: { disabled: true },
  authentication: {
    preferredSecurityScheme: "apiKeyBearer",
    securitySchemes: {
      apiKeyBearer: { token: "$SEISAN_API_KEY" },
    },
  },
  metaData: {
    title: "Seisan API reference",
    description: "Reference documentation and examples for the Seisan API.",
  },
} satisfies AnyApiReferenceConfiguration;

export default function ApiDocsPage() {
  useDocumentTitle("API reference - Seisan");

  return (
    <Box className="api-docs-page">
      <Box component="a" className="api-docs-skip-link" href="#api-reference">
        Skip to API reference
      </Box>
      <Box component="header" className="api-docs-header">
        <BrandLink />
        <Stack component="nav" aria-label="API documentation" direction="row" spacing={1}>
          <Button
            component="a"
            href="/openapi.json"
            target="_blank"
            rel="noreferrer"
            variant="outlined"
            startIcon={<CodeOutlinedIcon />}
            className="api-docs-header-secondary"
          >
            OpenAPI JSON
          </Button>
          <Button
            component={Link}
            to="/account/api-keys"
            state={accountLinkState("API reference")}
            variant="contained"
            startIcon={<KeyOutlinedIcon />}
          >
            Get API key
          </Button>
        </Stack>
      </Box>
      <Box component="main" id="api-reference" className="api-docs-reference">
        <ApiReferenceReact configuration={scalarConfiguration} />
      </Box>
    </Box>
  );
}
