import type { UnpluginBuildContext, UnpluginContext } from 'unplugin';

import type { Options } from '../types';

import { getSvnInfo } from '../utils/svn';

import { BuildInfoModule } from './base';

export class BuildSvnModule extends BuildInfoModule {
  constructor(root: string, options: Options) {
    super('svn', root, options);
  }

  async load(ctx: UnpluginBuildContext & UnpluginContext, id: string) {
    const { root, options } = this;
    const info = await getSvnInfo(root, options?.svn);

    if (!info) {
      ctx.warn('This may not be a svn repo');
    }

    const keys = [
      ...new Set([
        'url',
        'repositoryRoot',
        'repositoryUuid',
        'revision',
        'nodeKind',
        'lastChangedRev',
        'lastChangedDate',
        'lastChangedAuthor',
        'sha',
        'abbreviatedSha',
        'commitMessage',
        'author',
        'authorDate',
        'authorEmail',
        'branch',
        'tag',
        'tags',
        'lastTag',
        'describe',
        ...Object.keys(options?.svn ?? {})
      ])
    ];
    const gen = (key: string) => {
      return `export const ${key} = ${info ? JSON.stringify((info as any)[key]) : 'null'}`;
    };

    return keys.map((key) => gen(key)).join('\n');
  }
}
