import { EXPLAINS_NAME } from '../shared/project-data';
import { listFiles, removeFile } from './metadir';

const SUB = EXPLAINS_NAME;
const EXT = '.md';

function list(projectPath: string) {
  return listFiles(projectPath, SUB, EXT);
}

function remove(projectPath: string, name: string) {
  removeFile(projectPath, SUB, EXT, name);
  return list(projectPath);
}

export { list, remove };
