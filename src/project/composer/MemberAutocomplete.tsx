import { Autocomplete, TextField } from "@mui/material";

import type * as api from "../../api";
import { prefixMatchingMembers } from "./memberSearch";

/**
 * Member picker that matches typed text against member-name prefixes. A selected member cannot be
 * cleared back to empty, so rows only become unfinished before their first selection.
 */
export function MemberAutocomplete({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: api.ProjectMember[];
  value: api.ProjectMember | null;
  onChange: (member: api.ProjectMember | null) => void;
}) {
  return (
    <Autocomplete<api.ProjectMember, false, boolean, false>
      autoHighlight
      disableClearable={value !== null}
      openOnFocus
      options={options}
      value={value}
      getOptionLabel={(member) => member.name}
      isOptionEqualToValue={(left, right) => left.id === right.id}
      filterOptions={(available, state) => prefixMatchingMembers(available, state.inputValue)}
      onChange={(_event, member) => onChange(member)}
      renderInput={(params) => <TextField {...params} label={label} required />}
    />
  );
}
