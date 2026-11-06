const GITHUB_PREFIX = 'ghp';
const GITHUB_BODY = '0123456789abcdefghijklmnopqrstuvwxyzAB';
const ATLASSIAN_PREFIX = ['ATATT3', 'xFfGF0'].join('');
const ATLASSIAN_BODY = 'abcdefghijklmnopqrstuvwx';

export const FAKE_GITHUB_TOKEN = [GITHUB_PREFIX, GITHUB_BODY].join('_');
export const FAKE_ATLASSIAN_TOKEN = [ATLASSIAN_PREFIX, ATLASSIAN_BODY].join('-');
export const FAKE_ATLASSIAN_TOKEN_LONG = `${FAKE_ATLASSIAN_TOKEN}yz0123456789`;

export const fakeGithubToken = (body: string) => [GITHUB_PREFIX, body].join('_');
export const fakeGithubUserToken = (body: string) => ['ghu', body].join('_');
export const fakeFineGrainedToken = (body: string) => ['github', 'pat', body].join('_');
export const fakeAtlassianToken = (body: string) => ['ATATT', body].join('-');
