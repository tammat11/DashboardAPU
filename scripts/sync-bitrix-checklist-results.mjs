#!/usr/bin/env node

import {readFile} from 'node:fs/promises';

const webhook = String(process.env.BITRIX_WEBHOOK_URL || '').replace(/\/+$/, '') + '/';
const projectId = Number(process.env.BITRIX_PROJECT_ID || 51);
const sourceFile = process.env.BITRIX_RESULT_FORMS_FILE || '';
const apply = process.argv.includes('--apply');

if (!process.env.BITRIX_WEBHOOK_URL) throw new Error('Set BITRIX_WEBHOOK_URL');
if (!sourceFile) throw new Error('Set BITRIX_RESULT_FORMS_FILE');

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

function checklistNumber(title) {
  const match = String(title || '').match(/^\s*(\d+(?:\.\d+){3})\b/u);
  return match ? match[1] : '';
}

function resultTitle(currentTitle, resultForm) {
  const suffix = /(?:исполнитель|результат)\s*:\s*.*$/iu;
  const replacement = `результат: ${resultForm}`;
  return suffix.test(currentTitle)
    ? currentTitle.replace(suffix, replacement)
    : `${currentTitle.trim()} · ${replacement}`;
}

const sourceRows = JSON.parse(await readFile(sourceFile, 'utf8'));
const resultForms = new Map(
  sourceRows.map((row) => [
    String(row.tacticalNumber || '').trim(),
    String(row.resultForm || '').trim(),
  ]),
);
const tasks = await paged(
  'tasks.task.list',
  {filter: {GROUP_ID: projectId}, select: ['ID', 'TITLE']},
  (json) => json.result?.tasks || [],
);

const audit = {
  projectId,
  sourceRows: resultForms.size,
  tasks: tasks.length,
  checklistItems: 0,
  matched: 0,
  alreadyCorrect: 0,
  plannedUpdates: 0,
  updated: 0,
  missingSource: [],
  emptyResults: [],
  unusedSourceNumbers: [],
  failures: [],
};
const usedNumbers = new Set();

for (const task of tasks) {
  const taskId = String(task.id || task.ID);
  const checklist = (await call('task.checklistitem.getlist', {TASKID: taskId})).result || [];
  audit.checklistItems += checklist.length;

  for (const item of checklist) {
    const number = checklistNumber(item.TITLE);
    if (!number) continue;
    if (!resultForms.has(number)) {
      audit.missingSource.push({taskId, itemId: String(item.ID), number, title: item.TITLE});
      continue;
    }
    usedNumbers.add(number);
    audit.matched += 1;

    const resultForm = resultForms.get(number);
    if (!resultForm) {
      audit.emptyResults.push({taskId, itemId: String(item.ID), number});
      continue;
    }
    const desiredTitle = resultTitle(item.TITLE, resultForm);
    if (desiredTitle === item.TITLE) {
      audit.alreadyCorrect += 1;
      continue;
    }
    audit.plannedUpdates += 1;
    if (!apply) continue;

    try {
      const beforeMembers = (item.MEMBERS || [])
        .map((member) => `${member.ID}:${member.TYPE}`)
        .sort();
      await call('task.checklistitem.update', {
        TASKID: taskId,
        ITEMID: item.ID,
        FIELDS: {TITLE: desiredTitle},
      });
      const reread = await call('task.checklistitem.get', {
        TASKID: taskId,
        ITEMID: item.ID,
      });
      const afterMembers = (reread.result?.MEMBERS || [])
        .map((member) => `${member.ID}:${member.TYPE}`)
        .sort();
      if (reread.result?.TITLE !== desiredTitle) {
        throw new Error('title mismatch after reread');
      }
      if (JSON.stringify(beforeMembers) !== JSON.stringify(afterMembers)) {
        throw new Error('members changed while updating title');
      }
      audit.updated += 1;
      await sleep(80);
    } catch (error) {
      audit.failures.push({
        taskId,
        itemId: String(item.ID),
        number,
        error: error.message,
      });
    }
  }
}

audit.unusedSourceNumbers = [...resultForms.keys()]
  .filter((number) => !usedNumbers.has(number));

console.log(JSON.stringify(audit, null, 2));
