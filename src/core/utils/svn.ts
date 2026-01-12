import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import type { Options } from '../types';

const execAsync = promisify(exec);

// 检查系统是否有svn命令
async function checkSvnAvailable(): Promise<boolean> {
  try {
    const result = await execAsync('svn --version', { encoding: 'utf-8' });
    return result.stdout.includes('svn');
  } catch (error) {
    return false;
  }
}

// 在模块顶层添加检查
const isSvnInstalledPromise = checkSvnAvailable();

export async function getSvnInfo(root: string, extra: Options['svn'] = {}) {
  const isSvnInstalled = await isSvnInstalledPromise;
  
  if (!isSvnInstalled) {
    console.warn('SVN is not installed or not in PATH. SVN info will not be available.');
    return undefined;
  }
  
  try {
    // 检查是否是 SVN 仓库
    if (!await isSvnRepo(root)) {
      return undefined;
    }

    const [info, lastCommit, log, extraResult] = await Promise.all([
      getSvnBasicInfo(root),
      getLastCommit(root),
      getCommitLog(root),
      Promise.all(
        Object.entries(extra).map(async ([key, fn]) => {
          return [key, await fn(null)] as const;
        })
      )
    ]);

    return {
      ...info,
      ...lastCommit,
      ...log,
      ...Object.fromEntries(extraResult)
    };
  } catch (error) {
    console.error('Error getting SVN info:', error);
    return undefined;
  }
}

async function isSvnRepo(root: string): Promise<boolean> {
  try {
    // 尝试多种方法检测SVN仓库
    // 方法1: 检查.svn目录
    const fs = await import('fs');
    const path = await import('path');
    
    if (fs.existsSync(path.join(root, '.svn'))) {
      return true;
    }
    
    // 方法2: 使用svn info命令 (兼容旧版本)
    const output = await execSync('svn info', root);
    return !!output;
  } catch (error) {
    return false;
  }
}

async function getSvnBasicInfo(root: string) {
  try {
    const output = await execSync('svn info', root);
    const lines = output.split('\n');
    const info: Record<string, string> = {};

    for (const line of lines) {
      const match = line.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        const key = toCamelCase(match[1].trim());
        info[key] = match[2].trim();
      }
    }

    return {
      url: info['URL'],
      repositoryRoot: info['Repository Root'],
      repositoryUuid: info['Repository UUID'],
      revision: info['Revision'],
      nodeKind: info['Node Kind'],
      lastChangedRev: info['Last Changed Rev'],
      lastChangedDate: info['Last Changed Date'],
      lastChangedAuthor: info['Last Changed Author']
    };
  } catch (error) {
    return {
      url: undefined,
      repositoryRoot: undefined,
      repositoryUuid: undefined,
      revision: undefined,
      nodeKind: undefined,
      lastChangedRev: undefined,
      lastChangedDate: undefined,
      lastChangedAuthor: undefined
    };
  }
}

async function getLastCommit(root: string) {
  try {
    const output = await execSync('svn log -l 1 --xml', root);
    const logEntry = parseSvnXmlLog(output);

    return {
      sha: logEntry?.revision,
      abbreviatedSha: logEntry?.revision,
      commitMessage: logEntry?.msg,
      author: logEntry?.author,
      authorDate: logEntry?.date,
      authorEmail: undefined // SVN 不包含邮箱信息
    };
  } catch (error) {
    return {
      sha: undefined,
      abbreviatedSha: undefined,
      commitMessage: undefined,
      author: undefined,
      authorDate: undefined,
      authorEmail: undefined
    };
  }
}

async function getCommitLog(root: string) {
  try {
    const output = await execSync('svn log -l 10 --xml', root);
    const logs = parseSvnXmlLogs(output);
    const lastTag = await getBranchOrTag(root);

    return {
      branch: lastTag || undefined,
      tag: lastTag || undefined,
      tags: logs.map((log) => log.revision),
      lastTag: lastTag || undefined,
      describe: `r${logs[0]?.revision || ''}`
    };
  } catch (error) {
    return {
      branch: undefined,
      tag: undefined,
      tags: [],
      lastTag: undefined,
      describe: undefined
    };
  }
}

async function getBranchOrTag(root: string) {
  try {
    // 使用兼容旧版本的命令获取URL
    const infoOutput = await execSync('svn info', root);
    const urlMatch = infoOutput.match(/URL:\s+(.*)/);
    const url = urlMatch ? urlMatch[1] : '';

    if (url.includes('/trunk/')) {
      return 'trunk';
    }
    if (url.includes('/branches/')) {
      const match = url.match(/\/branches\/([^\/]+)/);
      return match ? match[1] : undefined;
    }
    if (url.includes('/tags/')) {
      const match = url.match(/\/tags\/([^\/]+)/);
      return match ? match[1] : undefined;
    }
    return undefined;
  } catch (error) {
    return undefined;
  }
}

interface SvnLogEntry {
  revision: string;
  author: string;
  date: string;
  msg: string;
}

function parseSvnXmlLog(xml: string): SvnLogEntry | null {
  try {
    const entryMatch = xml.match(/<logentry[^>]*revision="(\d+)"[^>]*>/);
    if (!entryMatch) return null;

    const authorMatch = xml.match(/<author>([^<]+)<\/author>/);
    const dateMatch = xml.match(/<date>([^<]+)<\/date>/);
    const msgMatch = xml.match(/<msg>([^<]*)<\/msg>/);

    return {
      revision: entryMatch[1],
      author: authorMatch?.[1] || '',
      date: dateMatch?.[1] || '',
      msg: msgMatch?.[1] || ''
    };
  } catch (error) {
    return null;
  }
}

function parseSvnXmlLogs(xml: string): SvnLogEntry[] {
  try {
    const entries: SvnLogEntry[] = [];
    const regex =
      /<logentry[^>]*revision="(\d+)"[^>]*>[\s\S]*?<author>([^<]+)<\/author>[\s\S]*?<date>([^<]+)<\/date>[\s\S]*?<msg>([^<]*)<\/msg>[\s\S]*?<\/logentry>/g;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
      entries.push({
        revision: match[1],
        author: match[2],
        date: match[3],
        msg: match[4]
      });
    }

    return entries;
  } catch (error) {
    return [];
  }
}

function toCamelCase(str: string) {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => {
      return index === 0 ? word.toLowerCase() : word.toUpperCase();
    })
    .replace(/\s+/g, '');
}

function execSync(command: string, cwd: string): Promise<string> {
  return execAsync(command, { cwd, encoding: 'utf-8' })
    .then((res) => res.stdout.trim())
    .catch((err) => {
      // 添加调试信息
      console.debug(`SVN command failed: ${command}`, err.message);
      return '';
    });
}