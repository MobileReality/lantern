import { EXTENSION_SCOPE } from '@shared/extension-slots';
import { createExtensionSkill, importExtensionsList, loadExtensionsPanel, moveExtension, saveExtensionsSlot, saveSkillLinker } from './extensions';
import { guardProjectFile } from './extensions-ignore';

type Handler = (event: any, ...args: any[]) => unknown;

export interface ExtensionsIpcDeps {
  handle: (channel: string, handler: Handler) => void;
  fromWorkspace: (fn: Handler) => Handler;
  installedFor: (project: unknown) => string[];
  reinstallFor: (project: unknown) => Promise<unknown> | null;
  syncPermissionsFor: (project: unknown) => Promise<unknown> | null;
  pickList: (sender: unknown) => Promise<string | null>;
  home?: string;
}

const writesProjectFile = (scope: unknown) => scope === EXTENSION_SCOPE.project;

export function registerExtensionsIpc({ handle, fromWorkspace, installedFor, reinstallFor, syncPermissionsFor, pickList, home }: ExtensionsIpcDeps) {
  handle('extensions:load', fromWorkspace((_e, project) => loadExtensionsPanel(installedFor(project), home, project)));
  handle(
    'extensions:save',
    fromWorkspace(async (_e, req) => {
      const run = () => saveExtensionsSlot(req?.slot, req?.names, installedFor(req?.project), home, req?.off, req);
      const panel = await guardProjectFile(req?.project, installedFor(req?.project), writesProjectFile(req?.scope), run, home);
      if (!Array.isArray(req?.off)) return panel;
      await reinstallFor(req?.project);
      return { ...panel, installed: installedFor(req?.project) };
    }),
  );
  handle(
    'extensions:move',
    fromWorkspace((_e, req) => guardProjectFile(req?.project, installedFor(req?.project), true, () => moveExtension(req?.slot, req?.name, req?.from, req?.to, installedFor(req?.project), home, req?.project), home)),
  );
  handle(
    'extensions:create',
    fromWorkspace((_e, req) => guardProjectFile(req?.project, installedFor(req?.project), writesProjectFile(req?.scope), () => createExtensionSkill(req, installedFor(req?.project), home), home)),
  );
  handle(
    'extensions:skillLinker',
    fromWorkspace(async (_e, req) => {
      const panel = saveSkillLinker(req?.value, installedFor(req?.project), home, req?.project);
      await syncPermissionsFor(req?.project);
      return panel;
    }),
  );
  handle(
    'extensions:import',
    fromWorkspace(async (e, req) => {
      const installed = installedFor(req?.project);
      const file = await pickList(e.sender);
      if (!file) return loadExtensionsPanel(installed, home, req?.project);
      const panel = importExtensionsList(file, installed, home, req?.project);
      await syncPermissionsFor(req?.project);
      return panel;
    }),
  );
}
