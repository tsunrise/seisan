import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import PersonAddAltIcon from "@mui/icons-material/PersonAddAlt";
import { Autocomplete, Box, Button, IconButton, Stack, TextField } from "@mui/material";
import type { FormEvent, ReactNode } from "react";
import { useRef, useState } from "react";

import * as api from "../api";
import { getApiErrorMessage } from "../apiErrorMessages";
import { InlineAlert } from "../components/InlineAlert";
import { MemberPaymentMethod } from "../components/MemberPaymentMethod";
import { MoneyTable } from "../components/MoneyTable";
import { PanelFrame } from "../components/PanelFrame";
import { activeMembers, deriveDelta } from "../domain";
import { useAppSnackbar } from "../hooks/useAppSnackbar";
import { LinkedBlockList, LinkedBlockVerb } from "./LinkedBlockForm";
import { prefixMatchingMembers } from "./memberSearch";
import { TransferTotals } from "./TransferTotals";
import {
  availableDestinationMembers,
  parseTransferDestinations,
  transferBatchTotal,
  transferDraftFromDescription,
  type TransferDestinationDraft,
  type TransferPrefill,
} from "./transferForm";

export function TransferComposer({
  project,
  currentMember,
  prefill,
  initialDescription,
  title,
  backTo,
  submitLabel,
  submittingLabel,
  onSubmit,
  onBack,
  footer,
}: {
  project: api.Project;
  currentMember: api.ProjectMember;
  prefill?: TransferPrefill | null;
  initialDescription?: Extract<api.WritableRecordDescription, { type: "transfer" }>;
  title: string;
  backTo: string;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (input: {
    description: api.WritableRecordDescription;
    delta: api.MoneyByMemberId;
  }) => Promise<void>;
  onBack?: () => void;
  footer?: ReactNode;
}) {
  const { showError } = useAppSnackbar();
  const members = activeMembers(project.members);
  const initialTransfer = initialDescription
    ? transferDraftFromDescription(initialDescription)
    : null;
  const initialFrom = initialTransfer?.sourceId ?? prefill?.from ?? currentMember.id;
  const initialDestinations: TransferDestinationDraft[] = initialTransfer
    ? initialTransfer.destinations
    : [
        {
          key: 0,
          memberId: prefill?.to ?? members.find((member) => member.id !== initialFrom)?.id ?? null,
          amount: prefill?.amount ?? "",
        },
      ];
  const nextDestinationKey = useRef(initialDestinations.length);
  const [from, setFrom] = useState(initialFrom);
  const [destinations, setDestinations] = useState<TransferDestinationDraft[]>(initialDestinations);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedSourceMember = members.find((member) => member.id === from);
  const parsedDestinations = parseTransferDestinations(destinations);
  const previewDestinations = destinations.flatMap((destination) => {
    const parsed = parseTransferDestinations([destination]);
    return parsed ?? [];
  });
  const description: api.WritableRecordDescription = {
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
  const canAddDestination =
    destinations.every((destination) => destination.memberId !== null) &&
    members.some((member) => member.id !== from && !selectedDestinationIds.has(member.id));

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
    setSubmitting(true);
    try {
      await onSubmit({
        description: { type: "transfer", src: from, dests: parsedDestinations },
        delta,
      });
    } catch (error) {
      showError(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PanelFrame title={title} backTo={backTo} onBack={onBack}>
      <Stack component="form" spacing={2} onSubmit={submit}>
        <Stack spacing={1.25}>
          <LinkedBlockList>
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
                <Box key={destination.key}>
                  {index === 0 ? (
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.1 }}>
                      <Box sx={{ flex: "1 1 auto", minWidth: 0 }}>
                        <Autocomplete
                          autoHighlight
                          disableClearable
                          openOnFocus
                          options={members}
                          value={selectedSourceMember}
                          getOptionLabel={(member) => member.name}
                          isOptionEqualToValue={(left, right) => left.id === right.id}
                          filterOptions={(available, state) =>
                            prefixMatchingMembers(available, state.inputValue)
                          }
                          onChange={(_event, member) => changeSource(member.id)}
                          renderInput={(params) => <TextField {...params} label="From" required />}
                        />
                      </Box>
                      <LinkedBlockVerb>paid</LinkedBlockVerb>
                    </Stack>
                  ) : null}
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) minmax(88px, 0.62fr) 32px",
                      columnGap: 0.75,
                      rowGap: 0.4,
                      alignItems: "center",
                    }}
                  >
                    <Autocomplete
                      autoHighlight
                      disableClearable={selectedMember !== null}
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
                    <TextField
                      label="Amount"
                      inputMode="decimal"
                      value={destination.amount}
                      onChange={(event) =>
                        updateDestination(destination.key, { amount: event.target.value })
                      }
                      placeholder="12.34"
                      required
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                    {destinations.length > 1 ? (
                      <IconButton
                        type="button"
                        size="small"
                        aria-label={`Remove recipient ${index + 1}`}
                        onClick={() =>
                          setDestinations((current) =>
                            current.filter((candidate) => candidate.key !== destination.key),
                          )
                        }
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
                    ) : (
                      <Box aria-hidden="true" />
                    )}
                    <Box sx={{ gridColumn: "1 / -1", minWidth: 0 }}>
                      <MemberPaymentMethod member={selectedMember} />
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </LinkedBlockList>
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
        <TransferTotals total={total} />
        <MoneyTable title="Balance change" project={project} map={delta} />
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <Button type="submit" variant="contained" startIcon={<AddIcon />} disabled={submitting}>
          {submitting ? submittingLabel : submitLabel}
        </Button>
      </Stack>
      {footer}
    </PanelFrame>
  );
}
