import { describe, expect, it } from "vitest";
import { parseDictionaryFields } from "../mapping-fields";

describe("parseDictionaryFields", () => {
  it("lit les champs du dictionnaire du moteur, guillemets compris", () => {
    const csv =
      "name,label_fr,type,required,description_fr,allowed\n" +
      'sample_id,Identifiant,text,yes,"Tel quel, sans ""arrondi"".",\n' +
      "matrix,Matrice,enum,yes,Matrice.,whole_blood|plasma\n";
    expect(parseDictionaryFields(csv)).toEqual([
      { name: "sample_id", label: "Identifiant", description: 'Tel quel, sans "arrondi".' },
      { name: "matrix", label: "Matrice", description: "Matrice." },
    ]);
  });
});
