import {
  Autocomplete,
  Box,
  CircularProgress,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import { NamedIcon } from "../../components/NamedIcon";
import { prefixMatchingCategories, type CategoryOption } from "../../domain/categories";

/**
 * Searchable category picker. Shows the selected category's icon in the input and replaces the
 * dropdown chevron area with a spinner while the expense text is still being classified.
 */
export function ExpenseCategoryField({
  options,
  value,
  pending,
  onChange,
}: {
  options: CategoryOption[];
  value: CategoryOption;
  pending: boolean;
  onChange: (categoryId: string) => void;
}) {
  return (
    <Autocomplete
      autoHighlight
      disableClearable
      openOnFocus
      options={options}
      value={value}
      getOptionLabel={(category) => category.name}
      isOptionEqualToValue={(left, right) => left.id === right.id}
      filterOptions={(available, state) => prefixMatchingCategories(available, state.inputValue)}
      onChange={(_event, category) => onChange(category.id)}
      renderOption={(props, category) => {
        const { key, ...optionProps } = props;
        return (
          <Box component="li" key={key} {...optionProps}>
            <CategoryOptionContent category={category} />
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Category"
          slotProps={{
            inputLabel: params.slotProps.inputLabel,
            input: {
              ...params.slotProps.input,
              startAdornment: (
                <>
                  <InputAdornment position="start">
                    <NamedIcon name={value.icon} sx={{ color: "text.secondary", fontSize: 20 }} />
                  </InputAdornment>
                  {params.slotProps.input.startAdornment}
                </>
              ),
              endAdornment: (
                <>
                  {pending ? (
                    <CircularProgress
                      aria-label="Classifying category"
                      color="inherit"
                      size={18}
                      thickness={5}
                    />
                  ) : null}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
            htmlInput: params.slotProps.htmlInput,
          }}
        />
      )}
    />
  );
}

function CategoryOptionContent({ category }: { category: CategoryOption }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 0 }}>
      <NamedIcon name={category.icon} sx={{ color: "text.secondary", fontSize: 20 }} />
      <Typography component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {category.name}
      </Typography>
    </Stack>
  );
}
