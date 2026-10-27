# Leslie et al. 2022, Table S2 (real data)

`leslie2022_table_s2.csv` reproduces Table S2 of the supplementary material of:

- Leslie H.A., van Velzen M.J.M., Brandsma S.H., Vethaak A.D., Garcia-Vallejo J.J., Lamoree M.H.
  (2022). *Discovery and quantification of plastic particle pollution in human blood.*
  Environment International, volume 163, article 107199.
- DOI: https://doi.org/10.1016/j.envint.2022.107199
- Licence: CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/), open access article.

Values are copied verbatim from Table S2 of the supplementary material; no modification
(notations such as `<0.093` and `0.44*` are kept as printed). One row per aliquot
(`1a`, `1b`, ...); donors 6, 9, 15 and 18 have a single aliquot. The file was generated
once by `scripts/build_leslie_s2.py` from the supplementary `.docx`.

Source quirks, kept as printed:
- Donor 9's label cell reads "9a 9b" but its b values are empty; the table caption lists
  donor 9 among the single-aliquot donors, so only `9a` is written.
- Donor 20a PET reads `<0.61`, which is the PE limit in Table 3 (PET LOD is 0.13); B1
  reports `W_STATUS_INCONSISTENT` on that cell. It is a non-detect either way.
- Some non-detects use sample-specific limits (e.g. PMMA `<0.093`) that differ from the
  method limits of Table 3 (PMMA LOD 0.10, LOQ 0.33); the study context uses Table 3.
