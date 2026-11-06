export const PLAN_TAG = 'plan';
export const PLAN_DIR = '.lantern/plans';
export const PLAN_EXT = '.plan';
export const NUMBER_PATTERN = '[1-9]\\d*';
export const SLUG_PATTERN = '[a-z][a-z0-9-]{0,39}';
export const ITEM_PATTERN = `s${NUMBER_PATTERN}\\.${NUMBER_PATTERN}`;
export const PLAN_REF = new RegExp(`^#${PLAN_TAG}[ \\t]+(${SLUG_PATTERN})[ \\t]+(${ITEM_PATTERN})[ \\t]*$`);
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value) {
    if (!ISO_DATE.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
