import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from "@mui/material";

import { MemberConfigFields } from "../../components/memberConfig/MemberConfigFields";
import type { MemberEditor } from "./useMemberSettings";

export function EditMemberDialog({ editor, isSelf }: { editor: MemberEditor; isSelf: boolean }) {
  return (
    <Dialog open={editor.member !== null} onClose={editor.close} fullWidth>
      <DialogTitle>Edit member</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Member name"
            value={editor.name}
            onChange={(event) => editor.setName(event.target.value)}
            disabled={editor.saving}
            fullWidth
          />
          <MemberConfigFields
            draft={editor.config}
            onChange={editor.setConfig}
            isSelf={isSelf}
            disabled={editor.saving}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={editor.saving} onClick={editor.close}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={!editor.canSave || editor.saving}
          onClick={() => void editor.save()}
        >
          {editor.saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
