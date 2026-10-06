import AddIcon from "@mui/icons-material/Add";
import { Button, Stack, TextField, Typography } from "@mui/material";

import { MemberConfigFields } from "../../components/memberConfig/MemberConfigFields";
import type { NewMemberForm } from "./useMemberSettings";

export function AddMemberForm({ form }: { form: NewMemberForm }) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="h3">Add member</Typography>
      <TextField
        label="Member name"
        value={form.name}
        onChange={(event) => form.setName(event.target.value)}
        disabled={form.adding}
      />
      <MemberConfigFields
        draft={form.config}
        onChange={form.setConfig}
        isSelf={false}
        includePaymentMethod={false}
        disabled={form.adding}
      />
      <Button
        variant="outlined"
        startIcon={<AddIcon />}
        disabled={!form.canAdd}
        onClick={() => void form.add()}
      >
        {form.adding ? "Adding…" : "Add member"}
      </Button>
    </Stack>
  );
}
