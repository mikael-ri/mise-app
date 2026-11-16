import { t } from '../../i18n/index.js';
import type { MessageKey } from '../../i18n/index.js';
import type { DraftErrors, FieldError, RecipeDraft } from './form-model.js';

/** What the editor sections need from the form page. */
export interface EditorProps {
  draft: RecipeDraft;
  update: (change: (draft: RecipeDraft) => RecipeDraft) => void;
  errors: DraftErrors;
  /** Message to show for a field key: only after the field was left or a submit was attempted. */
  errorFor: (key: string, error: FieldError | undefined) => string | undefined;
  touch: (key: string) => void;
}

const ERROR_LABEL: Record<FieldError, MessageKey> = {
  required: 'recipes.form.error.required',
  positive: 'recipes.form.error.positive',
  whole_number: 'recipes.form.error.wholeNumber',
  url: 'recipes.form.error.url',
  number: 'recipes.form.error.number',
  range_order: 'recipes.form.error.rangeOrder',
};

export const errorText = (code: FieldError): string => t(ERROR_LABEL[code]);
