export const REVIEWER_AGENT_TYPE = 'reviewer';

export const COMPLEX_REVIEWER_AGENT_TYPE = 'reviewer-complex';

export const DELEGATE_AGENT_PREFIX = 'lantern-delegate-';

export const COMPLEX_DELEGATE_PREFIX = 'lantern-delegate-complex-';

export const DELEGATE_KIND = Object.freeze({ sonnet: 'sonnet', opus: 'opus', fable: 'fable' });

export const COMPLEX_KINDS = Object.freeze([DELEGATE_KIND.opus, DELEGATE_KIND.fable]);

export const REVIEWER_AGENT_TYPES = Object.freeze([REVIEWER_AGENT_TYPE, COMPLEX_REVIEWER_AGENT_TYPE]);

const MODEL_FAMILY = Object.freeze({
    [DELEGATE_KIND.sonnet]: /sonnet/i,
    [DELEGATE_KIND.opus]: /opus/i,
    [DELEGATE_KIND.fable]: /fable/i,
});

export function modelKind(model) {
    if (typeof model !== 'string') return null;
    return Object.values(DELEGATE_KIND).find((kind) => MODEL_FAMILY[kind].test(model)) ?? null;
}

export function typeKind(agentType) {
    if (typeof agentType !== 'string' || !agentType.startsWith(DELEGATE_AGENT_PREFIX)) return null;
    return COMPLEX_KINDS.find((kind) => agentType.startsWith(`${COMPLEX_DELEGATE_PREFIX}${kind}-`)) ?? DELEGATE_KIND.sonnet;
}

export function delegateKind({ agentType, model } = {}) {
    if (typeof agentType === 'string' && agentType) return typeKind(agentType) ?? DELEGATE_KIND.sonnet;
    return modelKind(model) ?? DELEGATE_KIND.sonnet;
}

export const reviewerFor = (kind) => (kind === DELEGATE_KIND.fable ? COMPLEX_REVIEWER_AGENT_TYPE : REVIEWER_AGENT_TYPE);
