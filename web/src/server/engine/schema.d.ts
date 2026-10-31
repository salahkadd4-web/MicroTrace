// Fichier généré par `npm run gen:engine` depuis engine/openapi.json. Ne pas modifier.

export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/context/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Context Validate */
        post: operations["context_validate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tables/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Tables Read */
        post: operations["tables_read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mapping/suggest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mapping Suggest */
        post: operations["mapping_suggest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Imports Check
         * @description Contrôle d'import (règles B1) et cohérence avec les imports actifs de l'étude.
         *
         *     Corps multipart :
         *     - `file` : fichier CSV ou XLSX ;
         *     - `sheet` : feuille à lire (XLSX, facultatif) ;
         *     - `mapping` : champ texte, JSON conforme au schéma `MappingModel` ;
         *     - `context` : champ texte, JSON conforme au schéma `StudyContextModel` ;
         *     - `existing` : partie fichier facultative (JSON, 20 Mo au plus), liste de `ExistingKeyModel` déjà enregistrés dans l'étude.
         */
        post: operations["imports_check"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Summary */
        post: operations["summary"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/quality": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Quality */
        post: operations["quality"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Report */
        post: operations["report"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dictionary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Dictionary */
        get: operations["dictionary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/examples/leslie-like": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Example Leslie Like */
        get: operations["example_leslie_like"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/examples/leslie-2022": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Example Leslie 2022 */
        get: operations["example_leslie_2022"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ai/spectral/model": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Spectral Model */
        get: operations["spectral_model"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ai/spectral/identify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Spectral Identify */
        post: operations["spectral_identify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ai/spectral/parse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Spectral Parse
         * @description The two numeric columns of a spectrum file (training export): numbers only.
         */
        post: operations["spectral_parse"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** Body_imports_check */
        Body_imports_check: {
            /**
             * File
             * @description Fichier CSV ou XLSX
             */
            file: string;
            /**
             * Sheet
             * @description Feuille à lire (XLSX)
             */
            sheet?: string | null;
            /**
             * Mapping
             * @description Correspondance des colonnes : JSON conforme au schéma MappingModel
             */
            mapping: string;
            /**
             * Context
             * @description Contexte de l'étude : JSON conforme au schéma StudyContextModel
             */
            context: string;
            /**
             * Existing
             * @description Fichier JSON facultatif (20 Mo au plus) : liste de ExistingKeyModel
             */
            existing?: string | null;
        };
        /** Body_mapping_suggest */
        Body_mapping_suggest: {
            /** File */
            file: string;
            /** Sheet */
            sheet?: string | null;
        };
        /** Body_spectral_identify */
        Body_spectral_identify: {
            /**
             * File
             * @description Spectre : texte à deux colonnes (2 Mo au plus)
             */
            file: string;
            /** Technique */
            technique: string;
            /**
             * X Unit
             * @default cm-1
             */
            x_unit: string;
            /** Y Unit */
            y_unit: string;
            /** Laser Nm */
            laser_nm?: string | null;
        };
        /** Body_spectral_parse */
        Body_spectral_parse: {
            /**
             * File
             * @description Spectre : texte à deux colonnes (2 Mo au plus)
             */
            file: string;
        };
        /** Body_tables_read */
        Body_tables_read: {
            /** File */
            file: string;
            /** Sheet */
            sheet?: string | null;
        };
        /** CountsModel */
        CountsModel: {
            /** Error */
            error: number;
            /** Warning */
            warning: number;
            /** Info */
            info: number;
        };
        /** DetectionLimitModel */
        DetectionLimitModel: {
            /** Method */
            method: string;
            /** Polymer */
            polymer: string;
            /** Lod */
            lod: number | null;
            /** Loq */
            loq: number | null;
            /** Unit Code */
            unit_code: string;
            /** Source */
            source: string;
        };
        /** DictionaryResponse */
        DictionaryResponse: {
            /** Csv */
            csv: string;
            /** Markdown */
            markdown: string;
        };
        /**
         * ErrorLoc
         * @description Location and type of one validation error (never the submitted value).
         */
        ErrorLoc: {
            /**
             * Loc
             * @description Path in the request; a segment that may be user data is "*"
             */
            loc: (string | number)[];
            /** Type */
            type: string;
        };
        /**
         * ErrorModel
         * @description Body of every error response: a French message, and locations for a 422.
         */
        ErrorModel: {
            /** Detail */
            detail: string;
            /** Errors */
            errors?: components["schemas"]["ErrorLoc"][] | null;
        };
        /** ExampleResponse */
        ExampleResponse: {
            /** Filename */
            filename: string;
            /** Csv Base64 */
            csv_base64: string;
            context: components["schemas"]["StudyContextModel"];
            mapping: components["schemas"]["MappingModel"];
        };
        /** FrequencyModel */
        FrequencyModel: {
            /** Polymer */
            polymer: string;
            /**
             * Matrix
             * @enum {string}
             */
            matrix: "whole_blood" | "plasma" | "serum" | "other";
            /** Matrix Detail */
            matrix_detail: string;
            /** N Samples */
            n_samples: number;
            /** N Quantified */
            n_quantified: number;
            /** Fraction */
            fraction: number;
        };
        /** HealthResponse */
        HealthResponse: {
            /** Engine Api */
            engine_api: number;
            /** Engine Version */
            engine_version: string;
            /** Rules Version */
            rules_version: string;
        };
        /** ImportResultModel */
        ImportResultModel: {
            /** Records */
            records: components["schemas"]["MeasurementRecordModel"][];
            /** Qc Records */
            qc_records: components["schemas"]["MeasurementRecordModel"][];
            /** Issues */
            issues: components["schemas"]["IssueModel"][];
            /** N Rows */
            n_rows: number;
            /** Rules Version */
            rules_version: string;
            /** Has Errors */
            has_errors: boolean;
            counts: components["schemas"]["CountsModel"];
            /** Engine Version */
            engine_version: string;
            /**
             * Sha256
             * @description SHA-256 (hex) of the file bytes checked
             */
            sha256: string;
            /**
             * Sheet
             * @description Sheet read (XLSX), None for a CSV
             */
            sheet: string | null;
        };
        /** IssueModel */
        IssueModel: {
            /**
             * Code
             * @enum {string}
             */
            code: "E_MAPPING_UNKNOWN_FIELD" | "E_MAPPING_UNKNOWN_COLUMN" | "E_MAPPING_CONFLICT" | "E_MAPPING_NO_POLYMER_COLUMNS" | "W_ALIQUOT_SPLIT_FAILED" | "I_UNMAPPED_COLUMN" | "E_PII_COLUMN" | "E_PII_VALUE" | "W_POSSIBLE_PII_COLUMN" | "W_POSSIBLE_BIRTHDATE" | "E_REQUIRED_MISSING" | "E_UNKNOWN_MATRIX" | "E_MATRIX_DETAIL_MISSING" | "E_UNKNOWN_METHOD" | "E_UNKNOWN_RECORD_TYPE" | "E_UNKNOWN_IDENTIFICATION" | "E_UNKNOWN_STATUS" | "E_POLYMER_MISSING" | "W_POLYMER_OTHER" | "I_PS_AS_SUM" | "E_UNKNOWN_UNIT" | "E_HEADER_UNIT_CONFLICT" | "W_HEADER_UNIT_UNKNOWN" | "E_UNPARSABLE_VALUE" | "E_NEGATIVE_VALUE" | "E_LIMIT_UNIT_MISMATCH" | "E_LOD_GT_LOQ" | "W_LIMIT_CONFLICT" | "E_STATUS_VALUE_CONFLICT" | "W_STATUS_INCONSISTENT" | "W_NO_LIMITS" | "W_VALUE_BELOW_LOD" | "E_DUPLICATE_RECORD" | "E_SAMPLE_CONFLICT" | "I_EMPTY_AS_NOT_ANALYSED" | "E_INVALID_DATE" | "I_DATE_NORMALIZED" | "W_MIXED_QUANTITY_KINDS" | "E_PUBLISHED_WITHOUT_REFERENCE";
            /**
             * Severity
             * @enum {string}
             */
            severity: "error" | "warning" | "info";
            /** Message */
            message: string;
            /** Row */
            row?: number | null;
            /** Column */
            column?: string | null;
            /** Field */
            field?: string | null;
        };
        /** MappingModel */
        MappingModel: {
            /**
             * Mode
             * @enum {string}
             */
            mode: "long" | "wide";
            /** Field Columns */
            field_columns: {
                [key: string]: string;
            };
            /** Polymer Columns */
            polymer_columns?: {
                [key: string]: string;
            };
            /** Constants */
            constants?: {
                [key: string]: string;
            };
            /**
             * Split Aliquot Suffix
             * @default false
             */
            split_aliquot_suffix: boolean;
        };
        /** MeasurementRecordModel */
        MeasurementRecordModel: {
            /** Sample Id */
            sample_id: string;
            /** Aliquot */
            aliquot: string;
            /**
             * Record Type
             * @enum {string}
             */
            record_type: "sample" | "procedural_blank" | "field_blank" | "spiked";
            /**
             * Matrix
             * @enum {string}
             */
            matrix: "whole_blood" | "plasma" | "serum" | "other";
            /** Matrix Detail */
            matrix_detail: string;
            /** Polymer */
            polymer: string;
            /** Polymer Raw */
            polymer_raw: string;
            /** Method */
            method: string;
            /**
             * Technique
             * @enum {string}
             */
            technique: "py_gc_ms" | "ted_gc_ms" | "micro_ftir" | "micro_raman" | "other";
            /** Reported Value */
            reported_value: string;
            /** Value */
            value: number | null;
            /**
             * Unit
             * @enum {string}
             */
            unit: "ug/mL" | "ng/mL" | "mg/L" | "ug/L" | "ug/g" | "ng/g" | "mg/kg" | "particles/mL" | "particles/L" | "particles/g";
            /** Canonical Value */
            canonical_value: number | null;
            /**
             * Canonical Unit
             * @enum {string}
             */
            canonical_unit: "ug/mL" | "ng/mL" | "mg/L" | "ug/L" | "ug/g" | "ng/g" | "mg/kg" | "particles/mL" | "particles/L" | "particles/g";
            /**
             * Status
             * @enum {string}
             */
            status: "quantified" | "between_lod_loq" | "not_quantified" | "below_lod" | "not_analysed";
            /** Lod */
            lod: number | null;
            /** Loq */
            loq: number | null;
            /** Canonical Lod */
            canonical_lod: number | null;
            /** Canonical Loq */
            canonical_loq: number | null;
            /**
             * Identification Status
             * @enum {string}
             */
            identification_status: "confirmed" | "candidate";
            /** Size Min Um */
            size_min_um: number | null;
            /** Size Max Um */
            size_max_um: number | null;
            /** Analysis Date */
            analysis_date: string;
            /** Batch */
            batch: string;
            /** Lab */
            lab: string;
            /** Comment */
            comment: string;
            /** Source Row */
            source_row: number;
            /** Source Column */
            source_column: string;
        };
        /** MethodSpecModel */
        MethodSpecModel: {
            /** Name */
            name: string;
            /**
             * Technique
             * @enum {string}
             */
            technique: "py_gc_ms" | "ted_gc_ms" | "micro_ftir" | "micro_raman" | "other";
        };
        /** PolymerOptionModel */
        PolymerOptionModel: {
            /** Code */
            code: string;
            /** Label */
            label: string;
        };
        /** PolymerStatsModel */
        PolymerStatsModel: {
            /** Polymer */
            polymer: string;
            /** Method */
            method: string;
            /**
             * Matrix
             * @enum {string}
             */
            matrix: "whole_blood" | "plasma" | "serum" | "other";
            /** Matrix Detail */
            matrix_detail: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "mass_concentration" | "number_concentration";
            /**
             * Basis
             * @enum {string}
             */
            basis: "per_volume" | "per_mass";
            /**
             * Canonical Unit
             * @enum {string}
             */
            canonical_unit: "ug/mL" | "ng/mL" | "mg/L" | "ug/L" | "ug/g" | "ng/g" | "mg/kg" | "particles/mL" | "particles/L" | "particles/g";
            /** Counts By Status */
            counts_by_status: {
                [key: string]: number;
            };
            /** N Quantified */
            n_quantified: number;
            /** Min */
            min: number | null;
            /** Median */
            median: number | null;
            /** Mean */
            mean: number | null;
            /** Max */
            max: number | null;
            /** Max Measurement */
            max_measurement: number | null;
        };
        /**
         * QcSummaryModel
         * @description A summarised quality control; ``unit_code`` and ``kind`` are free text (an old row
         *     with an unknown unit gives a note, not a 422 for the whole study).
         */
        QcSummaryModel: {
            /** Id */
            id: string;
            /** Polymer */
            polymer: string;
            /** Kind */
            kind: string;
            /** N */
            n: number;
            /** Mean */
            mean?: number | null;
            /** Sd */
            sd?: number | null;
            /** Unit Code */
            unit_code: string;
            /** Source */
            source: string;
        };
        /** QualityFigureModel */
        QualityFigureModel: {
            /** Name */
            name: string;
            /** Label */
            label: string;
            /** Value */
            value: number;
            /** Unit */
            unit?: ("ug/mL" | "ng/mL" | "mg/L" | "ug/L" | "ug/g" | "ng/g" | "mg/kg" | "particles/mL" | "particles/L" | "particles/g") | null;
        };
        /** QualityGroupModel */
        QualityGroupModel: {
            /** Polymer */
            polymer: string;
            /** Method */
            method: string;
            /**
             * Matrix
             * @enum {string}
             */
            matrix: "whole_blood" | "plasma" | "serum" | "other";
            /** Matrix Detail */
            matrix_detail: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "mass_concentration" | "number_concentration";
            /**
             * Basis
             * @enum {string}
             */
            basis: "per_volume" | "per_mass";
            /**
             * Canonical Unit
             * @enum {string}
             */
            canonical_unit: "ug/mL" | "ng/mL" | "mg/L" | "ug/L" | "ug/g" | "ng/g" | "mg/kg" | "particles/mL" | "particles/L" | "particles/g";
        };
        /** QualityNoteModel */
        QualityNoteModel: {
            /**
             * Rule
             * @enum {string}
             */
            rule: "aliquot_discordance" | "near_blank" | "robust_outlier" | "unusual_lod_rate";
            /**
             * Reason
             * @enum {string}
             */
            reason: "no_blank_summary" | "polymers_without_blank" | "blank_unit_mismatch" | "blank_unit_unknown" | "blank_mean_missing" | "too_few_samples" | "zero_mad" | "dimension_empty" | "too_few_in_strata" | "tests_performed";
            group?: components["schemas"]["QualityGroupModel"] | null;
            /** Message */
            message: string;
        };
        /**
         * QualityRecordModel
         * @description A measurement with the identity of its cell: import, file fingerprint, sheet.
         */
        QualityRecordModel: {
            /** Sample Id */
            sample_id: string;
            /** Aliquot */
            aliquot: string;
            /**
             * Record Type
             * @enum {string}
             */
            record_type: "sample" | "procedural_blank" | "field_blank" | "spiked";
            /**
             * Matrix
             * @enum {string}
             */
            matrix: "whole_blood" | "plasma" | "serum" | "other";
            /** Matrix Detail */
            matrix_detail: string;
            /** Polymer */
            polymer: string;
            /** Polymer Raw */
            polymer_raw: string;
            /** Method */
            method: string;
            /**
             * Technique
             * @enum {string}
             */
            technique: "py_gc_ms" | "ted_gc_ms" | "micro_ftir" | "micro_raman" | "other";
            /** Reported Value */
            reported_value: string;
            /** Value */
            value: number | null;
            /**
             * Unit
             * @enum {string}
             */
            unit: "ug/mL" | "ng/mL" | "mg/L" | "ug/L" | "ug/g" | "ng/g" | "mg/kg" | "particles/mL" | "particles/L" | "particles/g";
            /** Canonical Value */
            canonical_value: number | null;
            /**
             * Canonical Unit
             * @enum {string}
             */
            canonical_unit: "ug/mL" | "ng/mL" | "mg/L" | "ug/L" | "ug/g" | "ng/g" | "mg/kg" | "particles/mL" | "particles/L" | "particles/g";
            /**
             * Status
             * @enum {string}
             */
            status: "quantified" | "between_lod_loq" | "not_quantified" | "below_lod" | "not_analysed";
            /** Lod */
            lod: number | null;
            /** Loq */
            loq: number | null;
            /** Canonical Lod */
            canonical_lod: number | null;
            /** Canonical Loq */
            canonical_loq: number | null;
            /**
             * Identification Status
             * @enum {string}
             */
            identification_status: "confirmed" | "candidate";
            /** Size Min Um */
            size_min_um: number | null;
            /** Size Max Um */
            size_max_um: number | null;
            /** Analysis Date */
            analysis_date: string;
            /** Batch */
            batch: string;
            /** Lab */
            lab: string;
            /** Comment */
            comment: string;
            /** Source Row */
            source_row: number;
            /** Source Column */
            source_column: string;
            /** Import Id */
            import_id: string;
            /** File Sha256 */
            file_sha256: string;
            /**
             * Sheet
             * @default
             */
            sheet: string;
        };
        /** QualityRecordRefModel */
        QualityRecordRefModel: {
            /** Import Id */
            import_id: string;
            /** File Sha256 */
            file_sha256: string;
            /** Sheet */
            sheet: string;
            /** Source Row */
            source_row: number;
            /** Source Column */
            source_column: string;
            /** Sample Id */
            sample_id: string;
            /** Aliquot */
            aliquot: string;
            /**
             * Status
             * @enum {string}
             */
            status: "quantified" | "between_lod_loq" | "not_quantified" | "below_lod" | "not_analysed";
            /**
             * Canonical Value
             * @description Null unless the status is quantified
             */
            canonical_value: number | null;
            /**
             * Canonical Unit
             * @enum {string}
             */
            canonical_unit: "ug/mL" | "ng/mL" | "mg/L" | "ug/L" | "ug/g" | "ng/g" | "mg/kg" | "particles/mL" | "particles/L" | "particles/g";
        };
        /** QualityRequest */
        QualityRequest: {
            /** Records */
            records: components["schemas"]["QualityRecordModel"][];
            /** Qc Summaries */
            qc_summaries?: components["schemas"]["QcSummaryModel"][];
            /**
             * Blank Corrected
             * @default unknown
             * @enum {string}
             */
            blank_corrected: "yes" | "no" | "unknown";
        };
        /** QualityResponse */
        QualityResponse: {
            /** Quality Rules Version */
            quality_rules_version: string;
            /** Signals */
            signals: components["schemas"]["QualitySignalModel"][];
            /** Notes */
            notes: components["schemas"]["QualityNoteModel"][];
            /** Rules */
            rules: components["schemas"]["QualityRuleModel"][];
        };
        /** QualityRuleModel */
        QualityRuleModel: {
            /**
             * Rule
             * @enum {string}
             */
            rule: "aliquot_discordance" | "near_blank" | "robust_outlier" | "unusual_lod_rate";
            /** Title */
            title: string;
            /** Description */
            description: string;
            /** Limits */
            limits: string[];
        };
        /** QualitySignalModel */
        QualitySignalModel: {
            /** Key */
            key: string;
            /**
             * Rule
             * @enum {string}
             */
            rule: "aliquot_discordance" | "near_blank" | "robust_outlier" | "unusual_lod_rate";
            /**
             * Category
             * @enum {string}
             */
            category: "replicates" | "blanks" | "distribution" | "batches";
            /** Title */
            title: string;
            /** Subject Label */
            subject_label: string;
            /** Explanation */
            explanation: string;
            group: components["schemas"]["QualityGroupModel"];
            /** Sample Id */
            sample_id?: string | null;
            /** Aliquot */
            aliquot?: string | null;
            /** Blank Id */
            blank_id?: string | null;
            /** Dimension */
            dimension?: ("batch" | "analysis_date") | null;
            /** Stratum */
            stratum?: string | null;
            /** Figures */
            figures: components["schemas"]["QualityFigureModel"][];
            /** Records */
            records: components["schemas"]["QualityRecordRefModel"][];
        };
        /** ReportFileModel */
        ReportFileModel: {
            /** Name */
            name: string;
            /** Sha256 */
            sha256: string;
            /** Size */
            size: number;
            /** Sheet */
            sheet?: string | null;
        };
        /** ReportImportModel */
        ReportImportModel: {
            file: components["schemas"]["ReportFileModel"];
            /** Rules Version */
            rules_version: string;
            /**
             * Date
             * Format: date-time
             * @description ISO 8601; naive values are taken as UTC
             */
            date: string;
            /** Author */
            author: string;
            /** Issues */
            issues?: components["schemas"]["IssueModel"][];
        };
        /** ReportRequest */
        ReportRequest: {
            study: components["schemas"]["ReportStudyModel"];
            /** Imports */
            imports: components["schemas"]["ReportImportModel"][];
            /** Records */
            records: components["schemas"]["MeasurementRecordModel"][];
            /** Qc Records */
            qc_records?: components["schemas"]["MeasurementRecordModel"][];
            context: components["schemas"]["StudyContextModel"];
            /**
             * Generated At
             * @description ISO 8601; naive values are taken as UTC
             */
            generated_at?: string | null;
            /**
             * Context Changed
             * @description True when the study parameters changed since some imports; the report then states it at the top
             * @default false
             */
            context_changed: boolean;
        };
        /** ReportResponse */
        ReportResponse: {
            /** Markdown */
            markdown: string;
            /** Html */
            html: string;
        };
        /**
         * ReportStudyModel
         * @description Nature, DOI, licence and blank correction come from the report ``context``.
         */
        ReportStudyModel: {
            /** Title */
            title: string;
        };
        /** SampleResultModel */
        SampleResultModel: {
            /** Sample Id */
            sample_id: string;
            /**
             * Matrix
             * @enum {string}
             */
            matrix: "whole_blood" | "plasma" | "serum" | "other";
            /** Matrix Detail */
            matrix_detail: string;
            /** Polymer */
            polymer: string;
            /** Method */
            method: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "mass_concentration" | "number_concentration";
            /**
             * Basis
             * @enum {string}
             */
            basis: "per_volume" | "per_mass";
            /**
             * Canonical Unit
             * @enum {string}
             */
            canonical_unit: "ug/mL" | "ng/mL" | "mg/L" | "ug/L" | "ug/g" | "ng/g" | "mg/kg" | "particles/mL" | "particles/L" | "particles/g";
            /**
             * Status
             * @enum {string}
             */
            status: "quantified" | "between_lod_loq" | "not_quantified" | "below_lod" | "not_analysed";
            /** Value */
            value: number | null;
            /** N Aliquots */
            n_aliquots: number;
            /** N Quantified */
            n_quantified: number;
        };
        /** SpectralCandidateModel */
        SpectralCandidateModel: {
            /** Rank */
            rank: number;
            /** Polymer */
            polymer: string;
            /** Label */
            label: string;
            /** Score */
            score: number;
            /** Score Text */
            score_text: string;
        };
        /** SpectralCurveModel */
        SpectralCurveModel: {
            /** X */
            x: number[];
            /** Y */
            y: number[];
        };
        /** SpectralIdentifyResponse */
        SpectralIdentifyResponse: {
            model: components["schemas"]["SpectralModelRef"];
            /** Trial Label */
            trial_label: string;
            /** Trial Sentence */
            trial_sentence: string;
            input: components["schemas"]["SpectralInputModel"];
            /**
             * Status
             * @enum {string}
             */
            status: "identified" | "uncertain" | "not_identified";
            /** Status Label */
            status_label: string;
            /** Abstention */
            abstention: ("low_score" | "low_coverage" | "technique_mismatch" | "no_overlap") | null;
            /** Explanation */
            explanation: string;
            /** Candidates */
            candidates: components["schemas"]["SpectralCandidateModel"][];
            /** Margin */
            margin: number | null;
            /** Classifier Polymer */
            classifier_polymer: string | null;
            /** Classifier Label */
            classifier_label: string | null;
            /** References */
            references: components["schemas"]["SpectralReferenceModel"][];
            query_curve: components["schemas"]["SpectralCurveModel"];
            /** X Label */
            x_label: string;
            /** Y Label */
            y_label: string;
            thresholds: components["schemas"]["SpectralThresholdsModel"];
            /** Limits */
            limits: string[];
            /** Correction Vocabulary */
            correction_vocabulary: components["schemas"]["PolymerOptionModel"][];
        };
        /** SpectralInputModel */
        SpectralInputModel: {
            /** Sha256 */
            sha256: string;
            /** Size */
            size: number;
            /** N Points */
            n_points: number;
            /** X Min */
            x_min: number;
            /** X Max */
            x_max: number;
            /**
             * Technique
             * @enum {string}
             */
            technique: "raman" | "ftir_atr";
            /** Technique Label */
            technique_label: string;
            /**
             * X Unit
             * @enum {string}
             */
            x_unit: "cm-1" | "nm";
            /**
             * Y Unit
             * @enum {string}
             */
            y_unit: "intensity" | "absorbance" | "transmittance_pct";
            /** Laser Nm */
            laser_nm: number | null;
            /** Diagnostic Coverage */
            diagnostic_coverage: number;
            /** Window Min */
            window_min: number;
            /** Window Max */
            window_max: number;
        };
        /** SpectralLibraryModel */
        SpectralLibraryModel: {
            /** Code */
            code: string;
            /** Name */
            name: string;
            /** Citation */
            citation: string;
            /** Licence Text */
            licence_text: string;
            /** Curve Allowed */
            curve_allowed: boolean;
            /** N Ftir Atr */
            n_ftir_atr: number;
            /** N Raman */
            n_raman: number;
        };
        /** SpectralMetricsModel */
        SpectralMetricsModel: {
            /** N */
            n: number;
            /** N In Library */
            n_in_library: number;
            /** N Out Of Library */
            n_out_of_library: number;
            /** Top1 */
            top1: number;
            /** Top3 */
            top3: number;
            status_in_library: components["schemas"]["SpectralStatusShares"];
            status_out_of_library: components["schemas"]["SpectralStatusShares"] | null;
            /** Nested Identified Precision Min */
            nested_identified_precision_min: number | null;
            /** Nested Identified Precision Max */
            nested_identified_precision_max: number | null;
        };
        /** SpectralModelInfo */
        SpectralModelInfo: {
            /** Available */
            available: boolean;
            /** Reason */
            reason: ("missing" | "sha_mismatch" | "invalid") | null;
            /** Message */
            message: string | null;
            /** Name */
            name: string;
            /** Version */
            version: string;
            /** Expected Sha256 */
            expected_sha256: string;
            /** Sha256 */
            sha256: string | null;
            /** Trial Label */
            trial_label: string;
            /** Trial Sentence */
            trial_sentence: string;
            /** Limits */
            limits: string[];
            /** Card Path */
            card_path: string;
            /** Max Bytes */
            max_bytes: number;
            /** Max Points */
            max_points: number;
            /** Techniques */
            techniques: components["schemas"]["SpectralTechniqueInfo"][];
            /** Libraries */
            libraries: components["schemas"]["SpectralLibraryModel"][];
        };
        /** SpectralModelRef */
        SpectralModelRef: {
            /** Name */
            name: string;
            /** Version */
            version: string;
            /** Sha256 */
            sha256: string;
        };
        /**
         * SpectralParsedModel
         * @description The numeric spectrum as read from the file: no header, no file text.
         */
        SpectralParsedModel: {
            /** X */
            x: number[];
            /** Y */
            y: number[];
        };
        /** SpectralReferenceModel */
        SpectralReferenceModel: {
            /** Rank */
            rank: number;
            /** Spectrum Id */
            spectrum_id: string;
            /** Library */
            library: string;
            /** Library Name */
            library_name: string;
            /** Citation */
            citation: string;
            /** Licence Text */
            licence_text: string;
            /** Polymer */
            polymer: string;
            /** Label */
            label: string;
            /** Score */
            score: number;
            /** Score Text */
            score_text: string;
            curve: components["schemas"]["SpectralCurveModel"] | null;
            /** Curve Note */
            curve_note: string | null;
        };
        /** SpectralStatusShares */
        SpectralStatusShares: {
            /** Identified */
            identified: number;
            /** Uncertain */
            uncertain: number;
            /** Not Identified */
            not_identified: number;
        };
        /** SpectralTechniqueInfo */
        SpectralTechniqueInfo: {
            /**
             * Technique
             * @enum {string}
             */
            technique: "raman" | "ftir_atr";
            /** Label */
            label: string;
            /** N References */
            n_references: number;
            /** Polymers */
            polymers: components["schemas"]["PolymerOptionModel"][];
            /** Window Min */
            window_min: number;
            /** Window Max */
            window_max: number;
            thresholds: components["schemas"]["SpectralThresholdsModel"];
            metrics: components["schemas"]["SpectralMetricsModel"] | null;
        };
        /** SpectralThresholdsModel */
        SpectralThresholdsModel: {
            /** Uncertain Min Score */
            uncertain_min_score: number;
            /** Identified Min Score */
            identified_min_score: number;
            /** Identified Min Margin */
            identified_min_margin: number;
            /** Classifier Agreement Required */
            classifier_agreement_required: boolean;
        };
        /** StudyContextModel */
        StudyContextModel: {
            /**
             * Data Nature
             * @enum {string}
             */
            data_nature: "published" | "laboratory" | "simulated";
            /** Methods */
            methods: components["schemas"]["MethodSpecModel"][];
            /** Limits */
            limits?: components["schemas"]["DetectionLimitModel"][];
            /** Reference Doi */
            reference_doi?: string | null;
            /** Reference License */
            reference_license?: string | null;
            /**
             * Blank Corrected
             * @default unknown
             * @enum {string}
             */
            blank_corrected: "yes" | "no" | "unknown";
        };
        /** SummaryRequest */
        SummaryRequest: {
            /** Records */
            records: components["schemas"]["MeasurementRecordModel"][];
        };
        /** SummaryResponse */
        SummaryResponse: {
            /** Frequencies */
            frequencies: components["schemas"]["FrequencyModel"][];
            /** Stats */
            stats: components["schemas"]["PolymerStatsModel"][];
            /** Samples */
            samples: components["schemas"]["SampleResultModel"][];
            /** Aggregation Rule */
            aggregation_rule: string;
        };
        /** TableReadResponse */
        TableReadResponse: {
            /** Filename */
            filename: string;
            /** Sha256 */
            sha256: string;
            /** Size */
            size: number;
            /** Sheet */
            sheet: string | null;
            /** Sheets */
            sheets: string[];
            /** Columns */
            columns: string[];
            /** Preview */
            preview: {
                [key: string]: string;
            }[];
            /** N Rows */
            n_rows: number;
        };
        /** ValidateResponse */
        ValidateResponse: {
            /** Ok */
            ok: boolean;
        };
        /**
         * ExistingKeyModel
         * @description Key of a measurement already recorded in an active import of the study.
         */
        ExistingKeyModel: {
            /** Sample Id */
            sample_id: string;
            /**
             * Aliquot
             * @default
             */
            aliquot: string;
            /**
             * Record Type
             * @enum {string}
             */
            record_type: "sample" | "procedural_blank" | "field_blank" | "spiked";
            /** Polymer */
            polymer: string;
            /**
             * Polymer Raw
             * @default
             */
            polymer_raw: string;
            /** Method */
            method: string;
            /**
             * Matrix
             * @enum {string}
             */
            matrix: "whole_blood" | "plasma" | "serum" | "other";
            /**
             * Matrix Detail
             * @default
             */
            matrix_detail: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    health: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
    context_validate: {
        parameters: {
            query?: never;
            header?: {
                "X-Engine-Secret"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StudyContextModel"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidateResponse"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
    tables_read: {
        parameters: {
            query?: never;
            header?: {
                "X-Engine-Secret"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_tables_read"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TableReadResponse"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
    mapping_suggest: {
        parameters: {
            query?: never;
            header?: {
                "X-Engine-Secret"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_mapping_suggest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MappingModel"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
    imports_check: {
        parameters: {
            query?: never;
            header?: {
                "X-Engine-Secret"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_imports_check"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportResultModel"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
    summary: {
        parameters: {
            query?: never;
            header?: {
                "X-Engine-Secret"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SummaryRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SummaryResponse"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
    quality: {
        parameters: {
            query?: never;
            header?: {
                "X-Engine-Secret"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QualityRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QualityResponse"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
    report: {
        parameters: {
            query?: never;
            header?: {
                "X-Engine-Secret"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReportRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReportResponse"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
    dictionary: {
        parameters: {
            query?: never;
            header?: {
                "X-Engine-Secret"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DictionaryResponse"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
    example_leslie_like: {
        parameters: {
            query?: never;
            header?: {
                "X-Engine-Secret"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExampleResponse"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
    example_leslie_2022: {
        parameters: {
            query?: never;
            header?: {
                "X-Engine-Secret"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExampleResponse"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
    spectral_model: {
        parameters: {
            query?: never;
            header?: {
                "X-Engine-Secret"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SpectralModelInfo"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
    spectral_identify: {
        parameters: {
            query?: never;
            header?: {
                "X-Engine-Secret"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_spectral_identify"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SpectralIdentifyResponse"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Modèle spectral indisponible */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
    spectral_parse: {
        parameters: {
            query?: never;
            header?: {
                "X-Engine-Secret"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_spectral_parse"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SpectralParsedModel"];
                };
            };
            /** @description Secret du moteur manquant ou invalide */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Requête trop volumineuse */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Entrée invalide (message français, et emplacements pour une erreur de schéma) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
            /** @description Erreur interne du moteur */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorModel"];
                };
            };
        };
    };
}
