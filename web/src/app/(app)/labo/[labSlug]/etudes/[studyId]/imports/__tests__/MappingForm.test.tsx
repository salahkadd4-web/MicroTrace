import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MappingForm } from "../MappingForm";
import { FIELDS } from "./fixtures";

const COLUMNS = ["Echantillon", "PE", "PS"];

describe("MappingForm", () => {
  it("une colonne de polymère n'est plus proposée comme colonne de champ", async () => {
    const user = userEvent.setup();
    render(
      <MappingForm
        fields={FIELDS}
        columns={COLUMNS}
        mapping={{
          mode: "wide",
          field_columns: { sample_id: "Echantillon" },
          polymer_columns: { PE: "PE" },
          split_aliquot_suffix: false,
        }}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Polymère : colonne" }));
    expect(screen.queryByRole("option", { name: "PE" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "PS" })).toBeInTheDocument();
  });

  it("choisir une colonne comme champ la retire des colonnes de polymères", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MappingForm
        fields={FIELDS}
        columns={COLUMNS}
        mapping={{
          mode: "wide",
          field_columns: {},
          polymer_columns: { PE: "PE", PS: "PS" },
          split_aliquot_suffix: false,
        }}
        onChange={onChange}
      />,
    );
    // PE est une colonne de polymère : seule « Echantillon » est offerte, et choisir PS est impossible.
    await user.click(screen.getByRole("combobox", { name: "Identifiant d'échantillon : colonne" }));
    expect(screen.queryByRole("option", { name: "PE" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "Echantillon" }));
    expect(onChange).toHaveBeenCalledWith({
      mode: "wide",
      field_columns: { sample_id: "Echantillon" },
      polymer_columns: { PE: "PE", PS: "PS" },
      split_aliquot_suffix: false,
    });
  });

  it("une colonne utilisée comme champ n'est pas proposée comme colonne de polymère", () => {
    render(
      <MappingForm
        fields={FIELDS}
        columns={COLUMNS}
        mapping={{
          mode: "wide",
          field_columns: { sample_id: "Echantillon" },
          split_aliquot_suffix: false,
        }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("checkbox", { name: "Colonne de polymère : Echantillon" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Colonne de polymère : PE" })).toBeInTheDocument();
  });
});
