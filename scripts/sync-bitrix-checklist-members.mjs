#!/usr/bin/env node

import {readFile} from 'node:fs/promises';

const webhook = String(process.env.BITRIX_WEBHOOK_URL || '').replace(/\/+$/, '') + '/';
const apply = process.argv.includes('--apply');
const projectId = Number(process.env.BITRIX_PROJECT_ID || 51);
const workingGroupsFile = process.env.BITRIX_WORKING_GROUPS_FILE || '';
const userAliasesFile = process.env.BITRIX_USER_ALIASES_FILE || '';
const mode = workingGroupsFile ? 'working-group-observers' : 'title-executors';
const targetMemberType = workingGroupsFile ? 'U' : 'A';

if (!process.env.BITRIX_WEBHOOK_URL) {
  throw new Error('Set BITRIX_WEBHOOK_URL');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, params = {}) {
  const body = new URLSearchParams();
  const append = (key, value) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => append(`${key}[${index}]`, item));
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([childKey, childValue]) =>
        append(`${key}[${childKey}]`, childValue),
      );
    } else if (value !== undefined && value !== null) {
      body.append(key, String(value));
    }
  };
  Object.entries(params).forEach(([key, value]) => append(key, value));

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(`${webhook}${method}.json`, {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body,
    });
    const json = await response.json();
    if (response.ok && !json.error) return json;
    if (json.error === 'QUERY_LIMIT_EXCEEDED' && attempt < 5) {
      await sleep(attempt * 500);
      continue;
    }
    throw new Error(`${method}: ${json.error_description || json.error || response.status}`);
  }
  throw new Error(`${method}: retry limit exceeded`);
}

async function paged(method, params, extract) {
  const rows = [];
  let start = 0;
  do {
    const json = await call(method, {...params, start});
    rows.push(...extract(json));
    start = json.next;
    if (start !== undefined) await sleep(80);
  } while (start !== undefined);
  return rows;
}

function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function executorLabel(title) {
  const match = String(title || '').match(/исполнитель\s*:\s*(.+?)\s*$/iu);
  return match ? match[1].trim() : '';
}

function checklistNumber(title) {
  const match = String(title || '').match(/^\s*(\d+(?:\.\d+){3})\b/u);
  return match ? match[1] : '';
}

function levenshtein(a, b) {
  const row = Array.from({length: b.length + 1}, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = saved;
    }
  }
  return row[b.length];
}

function buildUserIndex(users) {
  return users
    .filter((user) => user.ACTIVE !== false && user.ACTIVE !== 'N')
    .map((user) => {
      const first = normalize(user.NAME);
      const last = normalize(user.LAST_NAME);
      const middle = normalize(user.SECOND_NAME);
      return {
        id: String(user.ID),
        name: [user.NAME, user.SECOND_NAME, user.LAST_NAME].filter(Boolean).join(' '),
        first,
        last,
        middle,
        fullVariants: new Set([
          normalize(`${user.LAST_NAME || ''} ${user.NAME || ''} ${user.SECOND_NAME || ''}`),
          normalize(`${user.NAME || ''} ${user.SECOND_NAME || ''} ${user.LAST_NAME || ''}`),
          normalize(`${user.NAME || ''} ${user.LAST_NAME || ''}`),
          normalize(`${user.LAST_NAME || ''} ${user.NAME || ''}`),
        ]),
      };
    });
}

function resolveUser(label, users) {
  const value = normalize(label);
  const parts = value.split(' ').filter(Boolean);
  const exact = users.filter((user) => user.fullVariants.has(value));
  if (exact.length === 1) return {user: exact[0], reason: 'exact'};

  const last = parts[0] || '';
  const initials = parts.slice(1).map((part) => part[0]).filter(Boolean);
  const abbreviated = users.filter((user) => {
    if (user.last !== last) return false;
    if (!initials.length) return true;
    if (initials[0] !== user.first[0]) return false;
    return !initials[1] || !user.middle || initials[1] === user.middle[0];
  });
  if (abbreviated.length === 1) return {user: abbreviated[0], reason: 'abbreviated'};

  const fuzzy = users.filter((user) => {
    if (!last || levenshtein(user.last, last) > 1) return false;
    if (!initials.length) return true;
    return initials[0] === user.first[0];
  });
  if (fuzzy.length === 1) return {user: fuzzy[0], reason: 'fuzzy'};

  const surnameOnly = users.filter((user) => user.last === last);
  if (surnameOnly.length === 1) return {user: surnameOnly[0], reason: 'surname-only'};

  return {
    user: null,
    reason: abbreviated.length > 1 || exact.length > 1 || fuzzy.length > 1
      ? 'ambiguous'
      : 'not-found',
    candidates: [...new Set([...exact, ...abbreviated, ...fuzzy].map((user) => user.name))],
  };
}

async function loadUsers() {
  if (process.env.BITRIX_USERS_FILE) {
    const report = JSON.parse(await readFile(process.env.BITRIX_USERS_FILE, 'utf8'));
    const directory = new Map();
    const add = (id, name) => {
      if (!id || !name || directory.has(String(id))) return;
      const parts = String(name || '').trim().split(/\s+/);
      directory.set(String(id), {
        ID: String(id),
        NAME: parts[0] || '',
        LAST_NAME: parts.slice(1).join(' '),
        ACTIVE: true,
      });
    };
    for (const user of report.allEmployees || []) add(user.id, user.name);
    for (const row of report.rows || []) {
      add(row['ID исполнителя'], row['Исполнитель']);
      add(row['ID постановщика'], row['Постановщик']);
      for (const field of ['Соисполнители', 'Наблюдатели']) {
        try {
          const participants = JSON.parse(row[field] || '[]');
          for (const participant of participants) {
            add(participant.id || participant.ID, participant.name || participant.NAME);
          }
        } catch {
          // Ignore malformed legacy participant data.
        }
      }
    }
    return [...directory.values()];
  }
  return paged('user.get', {filter: {ACTIVE: true}}, (json) => json.result || []);
}

const usersRaw = await loadUsers();
const users = buildUserIndex(usersRaw);
const userAliases = userAliasesFile
  ? new Map(
      JSON.parse(await readFile(userAliasesFile, 'utf8'))
        .map((alias) => [normalize(alias.label), {
          id: String(alias.id),
          name: String(alias.name || alias.label),
        }]),
    )
  : new Map();
const workingGroups = workingGroupsFile
  ? new Map(
      JSON.parse(await readFile(workingGroupsFile, 'utf8'))
        .map((row) => [String(row.tacticalNumber || '').trim(), row]),
    )
  : new Map();
const tasks = await paged(
  'tasks.task.list',
  {filter: {GROUP_ID: projectId}, select: ['ID', 'TITLE']},
  (json) => json.result?.tasks || [],
);

const audit = {
  mode,
  projectId,
  sourceRows: workingGroups.size,
  tasks: tasks.length,
  checklistItems: 0,
  withExecutorText: 0,
  matchedSourceItems: 0,
  alreadyAssigned: 0,
  plannedUpdates: 0,
  updated: 0,
  unmatchedChecklistNumbers: [],
  unusedSourceNumbers: [],
  unresolved: [],
  failures: [],
};
const usedSourceNumbers = new Set();

for (const task of tasks) {
  const taskId = String(task.id || task.ID);
  const checklist = (await call('task.checklistitem.getlist', {TASKID: taskId})).result || [];
  audit.checklistItems += checklist.length;

  for (const item of checklist) {
    const number = checklistNumber(item.TITLE);
    const sourceRow = workingGroupsFile && number ? workingGroups.get(number) : null;
    const label = workingGroupsFile ? String(sourceRow?.workingGroup || '').trim() : executorLabel(item.TITLE);
    if (workingGroupsFile && number && !sourceRow) {
      audit.unmatchedChecklistNumbers.push({
        taskId,
        itemId: String(item.ID),
        number,
        title: item.TITLE,
      });
    }
    if (!label) continue;
    if (workingGroupsFile) {
      audit.matchedSourceItems += 1;
      usedSourceNumbers.add(number);
    }
    audit.withExecutorText += 1;

    const labels = label.split(/\s*,\s*/).filter(Boolean);
    const resolvedUsers = [];
    for (const part of labels) {
      const aliasUser = userAliases.get(normalize(part));
      const resolved = aliasUser
        ? {user: aliasUser, reason: 'alias'}
        : resolveUser(part, users);
      if (resolved.user) {
        if (!resolvedUsers.some((user) => user.id === resolved.user.id)) {
          resolvedUsers.push(resolved.user);
        }
      } else {
        audit.unresolved.push({
          taskId,
          itemId: String(item.ID),
          label: part,
          fullLabel: label,
          title: item.TITLE,
          reason: resolved.reason,
          candidates: resolved.candidates || [],
        });
      }
    }
    if (!resolvedUsers.length) continue;

    const memberIds = (item.MEMBERS || []).map((member) => String(member.ID));
    const missingUsers = resolvedUsers.filter((user) => !memberIds.includes(user.id));
    if (!missingUsers.length) {
      audit.alreadyAssigned += 1;
      continue;
    }

    audit.plannedUpdates += 1;
    if (!apply) continue;

    try {
      await call('task.checklistitem.update', {
        TASKID: taskId,
        ITEMID: item.ID,
        FIELDS: {
          MEMBERS: [
            ...(item.MEMBERS || []).map((member) => ({ID: member.ID, TYPE: member.TYPE || 'A'})),
            ...missingUsers.map((user) => ({ID: user.id, TYPE: targetMemberType})),
          ],
        },
      });
      const reread = await call('task.checklistitem.get', {
        TASKID: taskId,
        ITEMID: item.ID,
      });
      const rereadMembers = reread.result?.MEMBERS || [];
      const verified = missingUsers.every((user) =>
        rereadMembers.some(
          (member) =>
            String(member.ID) === user.id &&
            String(member.TYPE || '') === targetMemberType,
        ),
      );
      if (!verified) throw new Error('member missing after reread');
      audit.updated += 1;
      await sleep(80);
    } catch (error) {
      audit.failures.push({
        taskId,
        itemId: String(item.ID),
        label,
        userIds: missingUsers.map((user) => user.id),
        error: error.message,
      });
    }
  }
}

if (workingGroupsFile) {
  audit.unusedSourceNumbers = [...workingGroups.keys()]
    .filter((number) => !usedSourceNumbers.has(number));
}

console.log(JSON.stringify(audit, null, 2));
