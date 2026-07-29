#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const webhook = String(process.env.BITRIX_WEBHOOK_URL || '').replace(/\/+$/, '') + '/';
const projectId = Number(process.env.BITRIX_PROJECT_ID || 51);
const portalUrl = String(process.env.BITRIX_PORTAL_URL || 'https://tootopbrass.bitrix24.kz')
  .replace(/\/+$/, '');
const stateFile = process.env.CHECKLIST_REMINDER_STATE_FILE ||
  path.join(process.cwd(), 'checklist-reminder-state.json');
const timezone = process.env.CHECKLIST_REMINDER_TIMEZONE || 'Asia/Almaty';
const apply = process.argv.includes('--apply') || process.argv.includes('--send-one');
const sendOne = process.argv.includes('--send-one');
const dateArg = process.argv.find((arg) => arg.startsWith('--date='));

if (!process.env.BITRIX_WEBHOOK_URL) throw new Error('Set BITRIX_WEBHOOK_URL');

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

function localIsoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}

function itemDeadline(title) {
  const match = String(title || '').match(/\bдо\s+(\d{2})\.(\d{2})\.(\d{4})\b/u);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

function compactTitle(title) {
  return String(title || '')
    .replace(/\s*·\s*до\s+\d{2}\.\d{2}\.\d{4}\b.*$/u, '')
    .trim();
}

function displayDate(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {sent: {}};
    throw error;
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(stateFile), {recursive: true});
  const temporary = `${stateFile}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await fs.rename(temporary, stateFile);
}

const runDate = dateArg ? dateArg.slice('--date='.length) : localIsoDate();
const targetDate = addDays(runDate, 1);
const state = await readState();
state.sent ||= {};

const tasks = await paged(
  'tasks.task.list',
  {filter: {GROUP_ID: projectId}, select: ['ID', 'TITLE']},
  (json) => json.result?.tasks || [],
);
const audit = {
  projectId,
  runDate,
  targetDate,
  tasks: tasks.length,
  checklistItems: 0,
  completedSkipped: 0,
  alreadySentSkipped: 0,
  noRecipientsSkipped: 0,
  candidates: [],
  sent: [],
  failures: [],
};

for (const task of tasks) {
  const taskId = String(task.id || task.ID);
  const checklist = (await call('task.checklistitem.getlist', {TASKID: taskId})).result || [];
  audit.checklistItems += checklist.length;

  for (const item of checklist) {
    if (item.PARENT_ID === 0 || String(item.PARENT_ID) === '0') continue;
    if (item.IS_COMPLETE === 'Y') {
      audit.completedSkipped += 1;
      continue;
    }
    const deadline = itemDeadline(item.TITLE);
    if (deadline !== targetDate) continue;

    const key = `${taskId}:${item.ID}:${deadline}`;
    if (state.sent[key]) {
      audit.alreadySentSkipped += 1;
      continue;
    }
    const members = (item.MEMBERS || [])
      .filter((member) => member.ID)
      .filter((member, index, list) =>
        list.findIndex((candidate) => String(candidate.ID) === String(member.ID)) === index,
      );
    if (!members.length) {
      audit.noRecipientsSkipped += 1;
      continue;
    }

    const candidate = {
      key,
      taskId,
      itemId: String(item.ID),
      deadline,
      title: compactTitle(item.TITLE),
      recipients: members.map((member) => ({
        id: String(member.ID),
        name: member.NAME,
        type: member.TYPE,
      })),
    };
    audit.candidates.push(candidate);
  }
}

const toSend = sendOne ? audit.candidates.slice(0, 1) : audit.candidates;
if (apply) {
  for (const candidate of toSend) {
    const mentions = candidate.recipients
      .map((recipient) => `[USER=${recipient.id}]${recipient.name}[/USER]`)
      .join(', ');
    const taskLink = `${portalUrl}/workgroups/group/${projectId}/tasks/task/view/${candidate.taskId}/`;
    const message = [
      '🔔 Напоминание по пункту чек-листа',
      mentions,
      `Завтра срок — ${displayDate(candidate.deadline)}`,
      `[URL=${taskLink}]${candidate.title}[/URL]`,
    ].join('\n');

    try {
      const response = await call('task.commentitem.add', {
        0: candidate.taskId,
        1: {POST_MESSAGE: message},
      });
      if (!response.result) throw new Error('comment ID missing');
      state.sent[candidate.key] = {
        sentAt: new Date().toISOString(),
        commentId: String(response.result),
        taskId: candidate.taskId,
        itemId: candidate.itemId,
        deadline: candidate.deadline,
      };
      await writeState(state);
      audit.sent.push({...candidate, commentId: String(response.result)});
      await sleep(100);
    } catch (error) {
      audit.failures.push({...candidate, error: error.message});
    }
  }
}

console.log(JSON.stringify(audit, null, 2));
