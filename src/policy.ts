import type { Config } from './config.js';
import { Stop } from './errors.js';

export function checkCommand(command: string, config: Config, authorization: string) {
  for (const rule of config.denylist) if (new RegExp(rule.pattern).test(command)) throw new Stop('blocked', 'command_denied', `Command blocked by ${rule.id}: ${rule.reason}\n${command}`);
  const unquoted = command.replace(/["']/g, '');
  for (const part of unquoted.split(/[;&|\n]/)) {
    const rm = part.match(/(?:^|\s)(?:\S*\/)?rm\s+(.+)/);
    if (rm && /(?:^|\s)(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(?:\s|$)/.test(rm[1]) && /(?:^|\s)(?:[^\s]*\*[^\s]*|\/(?:\s|$)|~(?:\/|\s|$)|\$HOME(?:\/|\s|$)|\/Users\/[^/\s]+\/?(?:\s|$))/.test(rm[1])) {
      throw new Stop('blocked', 'command_denied', `Command blocked by destructive-rm: recursive wildcard/root/home deletion\n${command}`);
    }
    if (/\bgit\b.*\b(?:reset\s+--hard|clean\s+-\w*f)/.test(part)) throw new Stop('blocked', 'command_denied', `Command blocked by destructive-git\n${command}`);
    for (const verb of ['commit', 'push']) {
      if (new RegExp(`\\bgit\\b.*\\b${verb}\\b`).test(part)) {
        const allowed = authorization.split(/[\n.;]/).some(sentence => new RegExp(`\\b${verb}(?:s|ted|ting)?\\b`, 'i').test(sentence) && !/\b(?:no|not|never|without|uncommitted)\b/i.test(sentence));
        if (!allowed) throw new Stop('blocked', 'delivery_not_authorized', `git ${verb} requires an explicit instruction in the plan or resume amendment.`);
      }
    }
  }
}
