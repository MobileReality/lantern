# Role vocabulary (lantern 1)

One role per file: the **job the file does for the rest of the program**, not its language,
framework or folder name. `validate.mjs` reads the `## \`role\`` headings below as the closed
list — a role not headed here fails validation. Adding a role keeps `lantern 1`: it only widens
the vocabulary, so every existing map stays valid and the viewer files unknown roles under
Support. Older checkouts of this skill reject the new role until they update; removing, renaming or
redefining a role is the format change that bumps the version.

**Pick by precedence, and only by precedence.** Walk the list top to bottom; the first role
whose rule the file meets wins. That makes a file that does two jobs (a page that also fetches,
a context file that also exports its `useX` accessor, a service that also exports its types)
resolve the same way every time, whoever maps it.

The layers follow Fowler's presentation / domain / data split: presentation roles render and
react, domain roles decide, data roles fetch and store; `ai` and `skill` are layers of their own (below). Edges (`entry`, `route`, `handler`,
`middleware`) are where input arrives.

## `skill`

Markdown that tells an AI agent what to do, how, and what to read or run next: a skill (`SKILL.md`
and the protocol, reference and template files of its folder), an agent or slash-command
definition, or the instructions a project gives its agents (`CLAUDE.md`, `AGENTS.md`). Its reader
is an agent working in or around the repo; nothing executes it. What it points at (another skill,
a protocol, a script) is a **reference**, written `@` (`format.md`, "Relation"), never a data flow.
- **Not** `ai`: `ai` is what the app's own runtime sends to a model (a prompt builder, a template under `prompts/`); a `skill` file steers an agent that works on the repo itself.
- **Not** `script`: a script is run; a skill is read, and the agent then acts. A skill that says "run `scripts/x.mjs`" refers to that script and stays a skill.
- **Not** documentation: a project's `README.md`, changelog or docs pages are not mapped at all (`SKILL.md`, "Which markdown is mapped"). A skill folder's own `README.md` is the skill's and stays `skill`.
- **Shows as:** `SKILL.md`, `protocol.md`, `references/*.md`, `agents/*.md`, `.claude/commands/*.md`, `CLAUDE.md`, `AGENTS.md`; frontmatter with `name`, `description`, `tools` or `model`; imperative instructions to the reader ("read", "load the `x` skill", "run").

**Precedence.** `skill` is tested first. Its files are markdown prose, so none of the code roles
below can claim one, and the two roles a prompt-like file could be mistaken for (`ai`, `script`)
are separated above. **One role is enough:** agent and command definitions are read by the same
kind of reader and refer to other files the same way as `SKILL.md`, so a second role would split
one instruction layer without any different relation semantics; the path and the purpose text say
which kind a file is.

**Version.** Added like `ai` and `infra`: the vocabulary widens, `lantern 1` stays, and every
existing map is still valid (markdown was never mapped before; it appears as new, unmapped files).
Checkouts of this skill older than the role reject a `skill` record or an `@` relation; the viewer
files an unknown role under Support.

## `test`

Code that checks other code and never ships in the runtime.
- **Not** a `script`: a test asserts; a script does.
- **Shows as:** `*.test.*`, `*.spec.*`, `test_*.py`, `__tests__/`, `describe`/`it`/`assert`, test setup files.

## `script`

A command run by hand or by CI/tooling — build, seed, codegen, deploy, one-off maintenance —
that the running app never imports.
- **Not** `entry`: an entry starts the app; a script runs beside it.
- **Shows as:** `scripts/`, `bin/`, shebang lines, `.sh`/`.ps1`, a `package.json` script target.

## `migration`

An ordered, one-way change to a persistent schema or its data.
- **Not** `schema`: a schema describes the current shape; a migration moves from one shape to the next.
- **Shows as:** timestamp/sequence in the file name, `up`/`down`, `ALTER TABLE`, `migrations/`.

## `infra`

Declarative description of where and how the software runs: cloud resources, container images,
orchestration manifests, environments and deployment or CI pipelines. Infrastructure as code
(Fowler): the environment is defined in files that are versioned and applied by a tool, not
clicked together. It describes the target; it does not run in the app.
- **Not** `config`: config holds values that tune the app or its tooling; infra declares the resources and pipelines those values are deployed into. An `.env` template, `tsconfig.json` or `package.json` is config.
- **Not** `script`: a script is imperative steps run by hand or by a pipeline; infra is the declaration or the pipeline definition itself. A `deploy.sh` stays a script.
- **Not** `migration`: a migration moves a data schema; infra provisions the place the data lives.
- **Not** `entry`: a Dockerfile builds the image the entry runs in; it does not start the app itself.
- **Shows as:** `*.tf`/`*.tfvars`, `Pulumi.*`, CDK stacks (`new Stack(...)`, `cdk.json`), CloudFormation/SAM/`serverless.yml`, Kubernetes manifests and Helm charts (`kind: Deployment`), `Dockerfile`, `docker-compose.yml`, `.github/workflows/*.yml`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml`, `Jenkinsfile`, `firebase.json` when it declares hosting or rules deployment.

**Precedence.** `infra` sits after `migration` and before `config`: the files it claims (a
Dockerfile, a workflow) are also declarative YAML/JSON that would otherwise fall to `config`, so
it must be tested first. Tests and hand-run scripts keep their earlier position.

**Version.** Added like `ai`: the vocabulary widens, `lantern 1` stays, and every existing map is
still valid (its Dockerfile and workflow records stay `config` until re-mapped). Checkouts of
this skill older than the role reject an `infra` record; the viewer files the role under
Support, and gives it a column of its own in a platform tab.

Sources: Fowler, *InfrastructureAsCode* (martinfowler.com/bliki/InfrastructureAsCode.html);
Terraform, *What is infrastructure as code* (developer.hashicorp.com/terraform/tutorials/aws-get-started/infrastructure-as-code);
Kubernetes, *Objects in Kubernetes* (kubernetes.io/docs/concepts/overview/working-with-objects);
GitHub, *Workflow syntax* (docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions);
Docker, *Dockerfile reference* (docs.docker.com/reference/dockerfile).

## `config`

Declarative values that tune the app or its tooling — everything likely to vary between
deploys (12-factor), plus build/lint/compiler/tool settings and fixed constant tables. No
behaviour beyond reading the environment.
- **Not** `schema`: config holds values; a schema holds shapes.
- **Not** `ai`: prompt text and templates are the model's input, not a value that tunes the app.
- **Not** `route`: a literal list of path → handler/component pairs is a route table.
- **Not** `infra`: resources, images, manifests and pipelines are infra (which comes first).
- **Shows as:** `*.config.*`, `tsconfig.json`, `package.json`, `.yml`/`.toml` that tune the app, `process.env`, an exported object of literals, `consts/`.

## `entry`

The start of a process or bundle: bootstraps the runtime, wires providers, mounts the root or
starts the server. One per executable.
- **Not** `route`: the entry starts the app; routes decide which code answers a request.
- **Shows as:** `main.*`, `index.*` at a package root, `createRoot(...).render`, `app.listen`, `if __name__ == "__main__"`.

## `route`

A table that maps an address — URL, path, command, message type — to the code that handles it.
Fowler's Front Controller dispatch, reduced to its mapping.
- **Not** `handler`: a route names who answers; a handler is the answer.
- **Shows as:** `<Route>`/`<Routes>`, `router.get(...)`, `urls.py`, a file-system router's layout, a list of path → component pairs.

## `middleware`

A step wrapped around a handler chain that may read or change the request/response, end the
cycle, or pass control on (Express's `req, res, next` definition). Guards, auth checks,
logging, interceptors.
- **Not** `handler`: middleware decides whether and how the request continues; the handler produces the result.
- **Shows as:** `next()`, `use(...)`, interceptors/guards/pipes, a wrapper component that renders children or redirects (`ProtectedRoute`).

## `handler`

The code that answers one external input — an HTTP request, RPC, queue message, cloud-function
trigger, IPC call or CLI command: parses it, calls the domain, shapes the reply. Fowler's
Page Controller; "controller" in MVC.
- **Not** `service`: a handler knows the transport (request, event, status code); a service does not.
- **Shows as:** `@Controller`, `@Get`, `(req, res) =>`, `onRequest`/`onDocumentCreated`, `ipcMain.handle`, resolvers.

## `page`

A screen the user navigates to: the top-level view a route renders, composing components and
pulling its data.
- **Not** `component`: a page is reached by address and rendered by a route; a component is rendered by other views.
- **Shows as:** `pages/`, `app/**/page.*`, `screens/`, `views/`, referenced from a route file.

## `component`

A reusable piece of UI: takes inputs (props/slots), returns markup, holds only local view state.
React: "a JavaScript function that you can sprinkle with markup".
- **Not** `page`: rendered by other views, never directly by a route.
- **Not** `style`: a module that only declares styled elements (`styled.div`, `*.styles.ts`) is a style.
- **Shows as:** capitalised function/class returning JSX/template, `.vue`/`.svelte` SFC, `components/`.

## `state`

A single shared runtime store that many parts of the app read and write: context provider,
Redux/Pinia/Zustand store, signal store, session cache, Fowler's Registry.
- **Not** `service`: state holds and broadcasts data; a service performs operations.
- **Shows as:** `createContext` + Provider, `createStore`, `defineStore`, `createSlice`, a module-level singleton read by many.

## `hook`

Reusable stateful UI logic with no markup: a React custom Hook, a Vue composable, a Svelte
store factory used by one component at a time. Each call has its own state.
- **Not** `state`: a hook's state is per call; `state` is shared by everyone who reads it.
- **Not** `util`: a hook calls framework lifecycle/state primitives; a util does not.
- **Shows as:** `useX` names calling `useState`/`useEffect`, `composables/`, `ref`/`computed` in a returned object.

## `style`

Presentation rules with no behaviour: stylesheets, theme tokens, CSS-in-JS style modules.
- **Not** `component`: a style file renders nothing.
- **Shows as:** `.css`/`.scss`/`.less`, `*.styles.ts`, `theme.*`, `tailwind` layers.

## `ai`

A file whose main job is to have a model produce output: calling an LLM or agent, running a
tool-use loop, building the prompt or message list, computing embeddings and retrieving context
(RAG), checking model output (guardrails, evaluation), or running ML inference. It takes data
from the domain and hands results back to the domain or the UI. Anthropic separates
*workflows* (LLMs orchestrated through predefined code paths) from *agents* (LLMs directing their
own tool use); both are `ai`, as is the "augmented LLM" they are built from (retrieval, tools,
memory).
- **Not** `handler`: an HTTP endpoint, queue consumer or CLI command that merely calls a model stays a handler; `ai` has no transport.
- **Not** `page` / `component` / `hook`: a chat screen or `useChat` that calls an `ai` file is UI and stays UI.
- **Not** `config`: the model id, temperature and API key variable are config; prompt text and templates are the model's input, so they are `ai` (also stated under `config`, which comes first).
- **Not** `gateway`: a client that only forwards calls to a foreign API is a gateway, but a model-provider client (Anthropic, OpenAI, Bedrock, a local inference server) is `ai`; so is a file that wraps a model SDK and also builds prompts or parses replies.
- **Not** `repository`: a vector store is data, but the file that embeds a query and ranks the hits is `ai`; a file that only stores and loads vectors or documents is a repository.
- **Not** `service`: a service applies business rules and may consume model output (creating a ticket from a triage); it is `ai` only when calling the model is its main job, not one step of a use case.
- **Not** `pure`: a prompt builder that only formats strings from its arguments is still `ai`, because its whole point is the model's input; `pure` is domain logic.
- **Not** `util`: a generic helper (token counting, retry) that would work in any project stays a util.
- **Shows as:** imports of `@anthropic-ai/sdk`, `openai`, `@google/genai`, `ai` (Vercel), `langchain`, `llamaindex`, `ollama`, `transformers`, `onnxruntime`; `messages`, `system`, `tools`, `tool_use`/`tool_calls`; prompt files and templates (`prompts/`, `*.prompt.*`); `embed(...)`, vector-store queries, rerankers; runtime `guardrails` (offline eval suites are `test`); `ai/`, `llm/`, `agents/`.

**Precedence.** `ai` sits after `style` and before `repository`, `gateway` and `service`. Edges and
UI are earlier on purpose: a file that merely calls a model for a request or a screen keeps the
role of the job it does first. The three roles it precedes are the ones a model-facing file is
easily mistaken for (an SDK wrapper is a gateway, retrieval is data access, an orchestrator is a
service), and the file's main job — the model call — is what the map should show.

## `repository`

Persistence access for one kind of domain object behind a collection-like interface — find,
save, delete — hiding the database or ORM (Fowler/Evans Repository; also Table Data Gateway,
Data Mapper, DAO).
- **Not** `gateway`: a repository talks to **our own** stored data; a gateway talks to a system we don't own.
- **Not** `service`: a repository stores and loads; it makes no business decisions.
- **Shows as:** `*Repository`, `*Dao`, `find`/`save`/`delete` methods, SQL/ORM/Firestore collection calls as the whole body.

## `gateway`

A client that wraps an external system — third-party API, SDK, message broker, email/SMS,
another service over HTTP — so the rest of the code never sees its protocol (Fowler's Gateway).
- **Not** `repository`: the other side is not our data store.
- **Shows as:** `fetch`/`axios` to a foreign host, an SDK client instance, `*Client`, `*Api`, webhook senders.

## `service`

An application operation: coordinates domain logic, repositories and gateways to carry out one
use case, with side effects allowed (Fowler's Service Layer; Evans' Service, "a standalone
operation within the context of your domain").
- **Not** `handler`: transport-agnostic — no request objects or status codes.
- **Not** `pure`: a service does I/O or calls something that does.
- **Shows as:** `*Service`, `@Injectable`, verb-named async functions (`createLeave`, `approveRequest`) that await a repository or gateway.

## `model`

A domain object with identity and behaviour — an Evans Entity ("a distinct identity that runs
through time") or Value Object, or an ORM entity/Active Record.
- **Not** `schema`: a model has identity or methods; a schema is a shape only.
- **Shows as:** classes with an `id` and methods, `@Entity`, ORM model definitions, `class Money`.

## `schema`

The shape of data with no behaviour: types, interfaces, enums, DTOs (Fowler's Data Transfer
Object), validation schemas, GraphQL/protobuf/SQL DDL definitions.
- **Not** `model`: no identity, no methods beyond validation.
- **Not** `config`: describes the shape of values, not the values.
- **Shows as:** `types/`, `interface`/`type` exports only, `z.object`, `*Dto`, `*.proto`, `*.graphql`.

## `pure`

Domain logic as pure functions: same output for the same input, no side effects (no I/O, no
mutation of shared state) — calculations, rules, validations, formatters that know the domain.
- **Not** `util`: `pure` knows the domain (leave days, prices, permissions); a util would work in any project.
- **Not** `service`: no I/O anywhere in the file.
- **Shows as:** exported functions of their arguments only, no `await`, no imports of repositories/gateways, `calculate*`, `validate*`, `is*`.

## `util`

Domain-agnostic helpers that could be copied into an unrelated project: string/date/array
helpers, generic wrappers, logging adapters.
- **Not** `pure`: no domain vocabulary.
- **Shows as:** `utils/`, `helpers/`, `lib/` with generic names (`formatDate`, `debounce`, `cn`).

## `other`

Fits none of the above. Never invent a role instead — use `other`, and the validator lists the
file for a human. Several files landing here is a signal the vocabulary needs a new version.
