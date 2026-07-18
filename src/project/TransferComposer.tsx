import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import PersonAddAltIcon from "@mui/icons-material/PersonAddAlt";
import { Autocomplete, Button, IconButton, MenuItem, Stack, TextField } from "@mui/material";
import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { InlineAlert } from "../components/InlineAlert";
import { MoneyTable } from "../components/MoneyTable";
import { PanelFrame } from "../components/PanelFrame";
import { activeMembers, deriveDelta } from "../domain";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { RecordFormBridge } from "./RecordFormBridge";
import { RecordSentenceField, RecordSentenceRow } from "./RecordSentenceRow";
import { TransferTotals } from "./TransferTotals";
import {
  availableDestinationMembers,
  parseTransferDestinations,
  prefixMatchingMembers,
  transferBatchTotal,
  type TransferDestinationDraft,
  type TransferPrefill,
} from "./transferForm";

export function TransferComposer({
  project,
  currentMember,
  prefill,
  onPosted,
  onBack,
}: {
  project: api.Project;
  currentMember: api.ProjectMember;
  prefill?: TransferPrefill | null;
  onPosted: () => void;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const { showError, showSuccess } = useAppSnackbar();
  const members = activeMembers(project.members);
  const initialFrom = prefill?.from ?? currentMember.id;
  const initialTo = prefill?.to ?? members.find((member) => member.id !== initialFrom)?.id ?? null;
  const nextDestinationKey = useRef(1);
  const [from, setFrom] = useState(initialFrom);
  const [destinations, setDestinations] = useState<TransferDestinationDraft[]>([
    { key: 0, memberId: initialTo, amount: prefill?.amount ?? "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const parsedDestinations = parseTransferDestinations(destinations);
  const previewDestinations = destinations.flatMap((destination) => {
    const parsed = parseTransferDestinations([destination]);
    return parsed ?? [];
  });
  const description: api.RecordDescription = {
    type: "transfer",
    src: from,
    dests: parsedDestinations ?? previewDestinations,
  };
  const delta = deriveDelta(description);
  const total = transferBatchTotal({ dests: previewDestinations });
  const selectedDestinationIds = new Set(
    destinations.flatMap((destination) =>
      destination.memberId === null ? [] : [destination.memberId],
    ),
  );
  const canAddDestination = members.some(
    (member) => member.id !== from && !selectedDestinationIds.has(member.id),
  );

  function changeSource(sourceId: number) {
    setFrom(sourceId);
    setDestinations((current) =>
      current.map((destination) =>
        destination.memberId === sourceId ? { ...destination, memberId: null } : destination,
      ),
    );
  }

  function updateDestination(
    key: number,
    patch: Partial<Pick<TransferDestinationDraft, "memberId" | "amount">>,
  ) {
    setDestinations((current) =>
      current.map((destination) =>
        destination.key === key ? { ...destination, ...patch } : destination,
      ),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!parsedDestinations || parsedDestinations.some((destination) => destination.id === from)) {
      setError("Choose a different member and a positive amount for every recipient.");
      return;
    }
    try {
      await api.appendRecord(project.id, {
        description: { type: "transfer", src: from, dests: parsedDestinations },
        delta,
      });
      showSuccess("Record posted.");
      onPosted();
      navigate(`/project/${project.id}`);
    } catch (error) {
      showError(getApiErrorMessage(error));
    }
  }

  return (
    <PanelFrame title="New transfer" backTo={`/project/${project.id}/records/new`} onBack={onBack}>
      <Stack component="form" spacing={2} onSubmit={submit}>
        <Stack spacing={1}>
          {destinations.map((destination, index) => {
            const options = availableDestinationMembers(
              members,
              from,
              destinations,
              destination.key,
            );
            const selectedMember =
              members.find((member) => member.id === destination.memberId) ?? null;
            return (
              <RecordSentenceRow key={destination.key}>
                {index === 0 ? (
                  <>
                    <RecordSentenceField minWidth={138}>
                      <TextField
                        select
                        label="From"
                        value={String(from)}
                        onChange={(event) => changeSource(Number(event.target.value))}
                      >
                        {members.map((member) => (
                          <MenuItem key={member.id} value={String(member.id)}>
                            {member.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    </RecordSentenceField>
                    <RecordFormBridge>paid</RecordFormBridge>
                  </>
                ) : (
                  <RecordFormBridge>and</RecordFormBridge>
                )}
                <RecordSentenceField minWidth={138} grow>
                  <Autocomplete
                    autoHighlight
                    openOnFocus
                    options={options}
                    value={selectedMember}
                    getOptionLabel={(member) => member.name}
                    isOptionEqualToValue={(left, right) => left.id === right.id}
                    filterOptions={(available, state) =>
                      prefixMatchingMembers(available, state.inputValue)
                    }
                    onChange={(_event, member) =>
                      updateDestination(destination.key, { memberId: member?.id ?? null })
                    }
                    renderInput={(params) => <TextField {...params} label="To" required />}
                  />
                </RecordSentenceField>
                <RecordSentenceField minWidth={116}>
                  <TextField
                    label="Amount"
                    inputMode="decimal"
                    value={destination.amount}
                    onChange={(event) =>
                      updateDestination(destination.key, { amount: event.target.value })
                    }
                    placeholder="12.34"
                    required
                  />
                </RecordSentenceField>
                {destinations.length > 1 ? (
                  <IconButton
                    type="button"
                    aria-label={`Remove recipient ${index + 1}`}
                    onClick={() =>
                      setDestinations((current) =>
                        current.filter((candidate) => candidate.key !== destination.key),
                      )
                    }
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                ) : null}
              </RecordSentenceRow>
            );
          })}
          <Button
            type="button"
            variant="text"
            startIcon={<PersonAddAltIcon />}
            disabled={!canAddDestination}
            onClick={() => {
              const key = nextDestinationKey.current;
              nextDestinationKey.current += 1;
              setDestinations((current) => [...current, { key, memberId: null, amount: "" }]);
            }}
            sx={{ alignSelf: "flex-start" }}
          >
            Add recipient
          </Button>
        </Stack>
        <TransferTotals project={project} sourceId={from} total={total} />
        <MoneyTable title="Balance change" project={project} map={delta} />
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <Button type="submit" variant="contained" startIcon={<AddIcon />}>
          Post
        </Button>
      </Stack>
    </PanelFrame>
  );
}
